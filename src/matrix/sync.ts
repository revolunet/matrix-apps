import type { MatrixClient, MatrixEvent, Room, RoomMember } from "matrix-js-sdk";
import { ClientEvent, MatrixEventEvent, RoomEvent, RoomMemberEvent } from "matrix-js-sdk";
import {
  EVENT_TYPE_COMMENT,
  EVENT_TYPE_CONTACT_FILE,
  EVENT_TYPE_CONTACT_UPDATE,
} from "@/lib/constants";
import { INDEX_EVENT_TYPE } from "@/schemas/index.schema";
import { useSyncStore } from "@/stores/sync.store";
import { useContactsStore } from "@/stores/contacts.store";
import { sendContactUpdate } from "@/matrix/events";
import { removeContactFromIndex } from "@/matrix/index-room";

let hydrateTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleHydrate = (client: MatrixClient) => {
  if (hydrateTimer) clearTimeout(hydrateTimer);
  hydrateTimer = setTimeout(() => {
    hydrateTimer = null;
    useContactsStore.getState().hydrateFromMatrix(client);
  }, 400);
};

function markReady(client: MatrixClient, state: string) {
  useSyncStore.getState().setSyncState(state);
  if (!useSyncStore.getState().isReady) {
    useSyncStore.getState().setReady(true);
  }
  // Always (re)schedule hydration — it is idempotent and debounced, so
  // running it again on every SYNCING event (~30 s) is harmless. This
  // ensures we recover if the first attempt ran before decryption finished
  // or if isReady was already true from a previous session in the same tab.
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
    const { roomToContact, refreshContact, refreshComments, refreshFiles } =
      useContactsStore.getState();

    if (type === EVENT_TYPE_CONTACT_UPDATE) {
      const contactId = roomToContact[room.roomId];
      if (contactId) refreshContact(client, room.roomId);
    }

    if (type === EVENT_TYPE_COMMENT) {
      const contactId = roomToContact[room.roomId];
      if (contactId) refreshComments(client, room.roomId);
    }

    if (type === EVENT_TYPE_CONTACT_FILE) {
      const contactId = roomToContact[room.roomId];
      if (contactId) refreshFiles(client, room.roomId);
    }
  };

  const onDecrypted = (event: MatrixEvent) => {
    const type = event.getType();
    const roomId = event.getRoomId();
    if (!roomId) return;

    const { roomToContact, refreshContact, refreshComments, refreshFiles } =
      useContactsStore.getState();

    if (type === EVENT_TYPE_CONTACT_UPDATE) {
      const contactId = roomToContact[roomId];
      if (contactId) {
        refreshContact(client, roomId);
      } else {
        // Decryption finished before hydrateFromMatrix populated roomToContact.
        // Schedule hydration so this event is not permanently missed.
        scheduleHydrate(client);
      }
    }

    if (type === EVENT_TYPE_COMMENT) {
      const contactId = roomToContact[roomId];
      if (contactId) refreshComments(client, roomId);
    }

    if (type === EVENT_TYPE_CONTACT_FILE) {
      const contactId = roomToContact[roomId];
      if (contactId) refreshFiles(client, roomId);
    }
  };

  const onAccountData = (event: MatrixEvent) => {
    if (event.getType() === INDEX_EVENT_TYPE) {
      scheduleHydrate(client);
    }
  };

  // ─── Re-send contact snapshot when a new member joins the data room ───────
  //
  // WHY THIS IS NEEDED:
  // Contact data is stored as encrypted Megolm events in the room timeline.
  // When a new member joins, they receive the historical ciphertext from the
  // homeserver but *cannot decrypt it* — they don't have the Megolm session
  // keys that were in use before they joined.
  //
  // Sending a fresh contact.update event immediately after they join solves
  // this: the new event uses a new Megolm session that includes the new
  // member's device, so they can decrypt it right away.
  //
  // Debounced 2s per room:member pair to avoid bursts on rapid membership
  // events (e.g. invite → join sequences).
  const pendingResends = new Map<string, ReturnType<typeof setTimeout>>();

  const onMembership = (
    _event: MatrixEvent,
    member: RoomMember,
  ) => {
    // Handle current user being kicked or banned from a contact room
    if (
      member.userId === client.getUserId() &&
      (member.membership === "leave" || member.membership === "ban")
    ) {
      const { indexEntries, removeContact } = useContactsStore.getState();
      const entry = indexEntries.find(
        (e) => e.dataRoomId === member.roomId || e.commentsRoomId === member.roomId,
      );
      if (entry) {
        removeContact(entry.contactId);
        removeContactFromIndex(client, entry.contactId).catch(() => {});
      }
      return;
    }

    // Only act on join events from other users
    if (member.membership !== "join") return;
    if (member.userId === client.getUserId()) return;

    const { indexEntries } = useContactsStore.getState();

    // Only trigger for data rooms (not comment rooms)
    const entry = indexEntries.find((e) => e.dataRoomId === member.roomId);
    if (!entry) return;

    const key = `${member.roomId}:${member.userId}`;
    const existing = pendingResends.get(key);
    if (existing) clearTimeout(existing);

    pendingResends.set(key, setTimeout(async () => {
      pendingResends.delete(key);
      const contact = useContactsStore.getState().contacts[entry.contactId];
      if (!contact) return;
      try {
        await sendContactUpdate(client, entry.dataRoomId, contact);
      } catch (err) {
        console.warn("[matrix] re-send contact on member join failed:", err);
      }
    }, 2000));
  };

  client.on(ClientEvent.Sync, onSync);
  client.on(RoomEvent.Timeline, onTimeline);
  client.on(MatrixEventEvent.Decrypted, onDecrypted);
  client.on(ClientEvent.AccountData, onAccountData);
  client.on(RoomMemberEvent.Membership, onMembership);

  // ─── Catch-up for missed PREPARED event ──────────────────────────────────
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
