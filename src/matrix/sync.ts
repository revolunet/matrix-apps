import type { MatrixClient, MatrixEvent, Room, RoomMember } from "matrix-js-sdk";
import { ClientEvent, MatrixEventEvent, RoomEvent, RoomMemberEvent } from "matrix-js-sdk";
import { APP_PREFIX } from "@/lib/constants";
import { useSyncStore } from "@/stores/sync.store";
import { useEntityStore } from "@/stores/entity.store";
import { getAllEntityConfigs, getEntityConfig } from "@/entities/registry";
import { sendEntityUpdate } from "@/matrix/entity-events";
import { removeEntityFromIndex } from "@/matrix/entity-index";

let hydrateTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleHydrate = (client: MatrixClient) => {
  if (hydrateTimer) clearTimeout(hydrateTimer);
  hydrateTimer = setTimeout(() => {
    hydrateTimer = null;
    useEntityStore.getState().hydrateFromMatrix(client, getAllEntityConfigs());
  }, 400);
};

function markReady(client: MatrixClient, state: string) {
  useSyncStore.getState().setSyncState(state);
  if (!useSyncStore.getState().isReady) {
    useSyncStore.getState().setReady(true);
  }
  scheduleHydrate(client);
}

export function attachSyncListeners(client: MatrixClient): () => void {
  const onSync = (state: string) => {
    useSyncStore.getState().setSyncState(state);
    if (state === "PREPARED" || state === "SYNCING") {
      markReady(client, state);
    }
  };

  const onTimeline = (
    event: MatrixEvent,
    room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
  ) => {
    if (toStartOfTimeline) return;
    if (!room) return;

    const type = event.getType();
    const { roomToEntity, refreshEntity, refreshComments, refreshFiles } =
      useEntityStore.getState();

    const ref = roomToEntity[room.roomId];
    if (!ref) return;

    let config;
    try {
      config = getEntityConfig(ref.type);
    } catch {
      return;
    }

    const updateEventType = `${config.eventTypePrefix}.update`;
    const fileEventType = `${config.eventTypePrefix}.file`;

    if (type === updateEventType) {
      refreshEntity(client, config, room.roomId);
    } else if (type === "m.room.message") {
      refreshComments(client, room.roomId);
    } else if (type === fileEventType) {
      refreshFiles(client, config, room.roomId);
    }
  };

  const onDecrypted = (event: MatrixEvent) => {
    const type = event.getType();
    const roomId = event.getRoomId();
    if (!roomId) return;

    const { roomToEntity, refreshEntity, refreshComments, refreshFiles } =
      useEntityStore.getState();

    const ref = roomToEntity[roomId];
    if (!ref) {
      // Decryption finished before hydrateFromMatrix populated roomToEntity.
      scheduleHydrate(client);
      return;
    }

    let config;
    try {
      config = getEntityConfig(ref.type);
    } catch {
      return;
    }

    const updateEventType = `${config.eventTypePrefix}.update`;
    const fileEventType = `${config.eventTypePrefix}.file`;

    if (type === updateEventType) {
      refreshEntity(client, config, roomId);
    } else if (type === "m.room.message") {
      refreshComments(client, roomId);
    } else if (type === fileEventType) {
      refreshFiles(client, config, roomId);
    }
  };

  const onAccountData = (event: MatrixEvent) => {
    const eventType = event.getType();
    // Re-hydrate if any entity index changes
    for (const config of getAllEntityConfigs()) {
      if (eventType === `${config.eventTypePrefix}_index`) {
        scheduleHydrate(client);
        return;
      }
    }
  };

  // Re-send entity snapshot when a new member joins the data room
  const pendingResends = new Map<string, ReturnType<typeof setTimeout>>();

  const onMembership = (_event: MatrixEvent, member: RoomMember) => {
    // Handle current user being kicked or banned
    if (
      member.userId === client.getUserId() &&
      (member.membership === "leave" || member.membership === "ban")
    ) {
      const { indices, removeEntity } = useEntityStore.getState();
      for (const config of getAllEntityConfigs()) {
        const entries = indices[config.type] ?? [];
        const entry = entries.find(
          (e) =>
            e.dataRoomId === member.roomId ||
            e.commentsRoomId === member.roomId,
        );
        if (entry) {
          removeEntity(config.type, entry.entityId);
          removeEntityFromIndex(client, config, entry.entityId).catch(() => {});
          return;
        }
      }
      return;
    }

    // When current user is invited, trigger hydration
    if (
      member.userId === client.getUserId() &&
      member.membership === "invite"
    ) {
      scheduleHydrate(client);
      return;
    }

    // Only act on join events from other users
    if (member.membership !== "join") return;
    if (member.userId === client.getUserId()) return;

    const { indices } = useEntityStore.getState();

    // Find which entity this data room belongs to
    for (const config of getAllEntityConfigs()) {
      const entries = indices[config.type] ?? [];
      const entry = entries.find((e) => e.dataRoomId === member.roomId);
      if (!entry) continue;

      const key = `${member.roomId}:${member.userId}`;
      const existing = pendingResends.get(key);
      if (existing) clearTimeout(existing);

      pendingResends.set(
        key,
        setTimeout(async () => {
          pendingResends.delete(key);
          const entity =
            useEntityStore.getState().entities[config.type]?.[entry.entityId];
          if (!entity) return;
          try {
            await sendEntityUpdate(client, config, entry.dataRoomId, entity);
          } catch (err) {
            console.warn("[matrix] re-send entity on member join failed:", err);
          }
        }, 2000),
      );

      return; // found the room, no need to check other configs
    }

    // If room matches app prefix but not in any index, schedule hydration
    const room = client.getRoom(member.roomId);
    if (room?.name?.startsWith(APP_PREFIX)) {
      scheduleHydrate(client);
    }
  };

  client.on(ClientEvent.Sync, onSync);
  client.on(RoomEvent.Timeline, onTimeline);
  client.on(MatrixEventEvent.Decrypted, onDecrypted);
  client.on(ClientEvent.AccountData, onAccountData);
  client.on(RoomMemberEvent.Membership, onMembership);

  // Catch-up for missed PREPARED event
  const currentState = client.getSyncState();
  if (currentState === "PREPARED" || currentState === "SYNCING") {
    markReady(client, currentState);
  }

  return () => {
    client.off(ClientEvent.Sync, onSync);
    client.off(RoomEvent.Timeline, onTimeline);
    client.off(MatrixEventEvent.Decrypted, onDecrypted);
    client.off(ClientEvent.AccountData, onAccountData);
    client.off(RoomMemberEvent.Membership, onMembership);
    for (const t of pendingResends.values()) clearTimeout(t);
    pendingResends.clear();
    if (hydrateTimer) clearTimeout(hydrateTimer);
  };
}
