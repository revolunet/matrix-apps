import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { MatrixClient } from "matrix-js-sdk";
import type { EntityConfig } from "@/entities/types";
import type { Comment } from "@/schemas/comment.schema";
import type { EntityFile } from "@/schemas/entity-file.schema";
import {
  loadEntityIndex,
  addEntityToIndex,
  removeEntityFromIndex,
  type EntityIndexEntry,
} from "@/matrix/entity-index";
import {
  extractComments,
  extractFiles,
  extractLatestEntity,
} from "@/matrix/entity-events";
import { APP_PREFIX } from "@/lib/constants";

interface EntityState {
  // entityType → entityId → data
  entities: Record<string, Record<string, unknown>>;
  // entityType → entityId → comments
  comments: Record<string, Record<string, Comment[]>>;
  // entityType → entityId → files
  files: Record<string, Record<string, EntityFile[]>>;
  // entityType → entries
  indices: Record<string, EntityIndexEntry[]>;
  // roomId → { type, id }
  roomToEntity: Record<string, { type: string; id: string }>;

  hydrateFromMatrix: (
    client: MatrixClient,
    configs: EntityConfig[],
  ) => Promise<void>;
  refreshEntity: (
    client: MatrixClient,
    config: EntityConfig,
    dataRoomId: string,
  ) => void;
  refreshComments: (
    client: MatrixClient,
    commentsRoomId: string,
  ) => void;
  refreshFiles: (
    client: MatrixClient,
    config: EntityConfig,
    dataRoomId: string,
  ) => void;
  upsertEntity: (type: string, id: string, data: unknown) => void;
  removeEntity: (type: string, entityId: string) => void;
  addIndexEntry: (type: string, entry: EntityIndexEntry) => void;
  getEntities: (type: string) => unknown[];
  getEntity: (type: string, id: string) => unknown | undefined;
  getIndexEntries: (type: string) => EntityIndexEntry[];
}

export const useEntityStore = create<EntityState>()(
  immer((set, get) => ({
    entities: {},
    comments: {},
    files: {},
    indices: {},
    roomToEntity: {},

    hydrateFromMatrix: async (client, configs) => {
      for (const config of configs) {
        const rawEntries = loadEntityIndex(client, config);

        // Filter stale entries where user is no longer a member
        const stale: EntityIndexEntry[] = [];
        const activeEntries = rawEntries.filter((entry) => {
          const membership = client
            .getRoom(entry.dataRoomId)
            ?.getMyMembership();
          if (membership === "join" || membership === "invite") return true;
          stale.push(entry);
          return false;
        });
        for (const entry of stale) {
          await removeEntityFromIndex(client, config, entry.entityId).catch(
            () => {},
          );
        }

        set((state) => {
          state.indices[config.type] = activeEntries;
          for (const entry of activeEntries) {
            state.roomToEntity[entry.dataRoomId] = {
              type: config.type,
              id: entry.entityId,
            };
            state.roomToEntity[entry.commentsRoomId] = {
              type: config.type,
              id: entry.entityId,
            };
          }
        });
      }

      // Auto-join invite rooms matching our app prefix
      const roomsToJoin = client
        .getRooms()
        .filter(
          (r) =>
            r.getMyMembership() === "invite" &&
            r.name?.startsWith(APP_PREFIX),
        )
        .map((r) => r.roomId);

      for (const roomId of roomsToJoin) {
        await client.joinRoom(roomId).catch(() => {});
        await new Promise((r) => setTimeout(r, 300));
      }

      // Pair joined app-prefix rooms not yet in any index (shared entities)
      for (const config of configs) {
        const knownEntityIds = new Set(
          (get().indices[config.type] ?? []).map((e) => e.entityId),
        );

        const dataRooms = new Map<string, string>(); // entityId → roomId
        const commentsRooms = new Map<string, string>(); // entityId → roomId

        for (const room of client.getRooms()) {
          if (room.getMyMembership() !== "join") continue;
          const name = room.name ?? "";
          const match = config.matchRoomName(name);
          if (!match) continue;
          if (match.isComments) {
            commentsRooms.set(match.entityId, room.roomId);
          } else {
            dataRooms.set(match.entityId, room.roomId);
          }
        }

        for (const [entityId, dataRoomId] of dataRooms) {
          if (knownEntityIds.has(entityId)) continue;
          const commentsRoomId = commentsRooms.get(entityId);
          if (!commentsRoomId) continue;

          const entityData = extractLatestEntity(client, config, dataRoomId);
          const displayName = entityData
            ? config.displayNameFn(entityData)
            : entityId;

          const entry: EntityIndexEntry = {
            entityId,
            dataRoomId,
            commentsRoomId,
            displayName,
            addedAt: new Date().toISOString(),
          };

          get().addIndexEntry(config.type, entry);
          await addEntityToIndex(client, config, entry).catch(() => {});
        }
      }

      // Refresh all entities
      for (const config of configs) {
        const entries = get().getIndexEntries(config.type);
        for (const entry of entries) {
          get().refreshEntity(client, config, entry.dataRoomId);
          get().refreshComments(client, entry.commentsRoomId);
          get().refreshFiles(client, config, entry.dataRoomId);
        }
      }
    },

    refreshEntity: (client, config, dataRoomId) => {
      const ref = get().roomToEntity[dataRoomId];
      if (!ref) return;
      const data = extractLatestEntity(client, config, dataRoomId);
      if (!data) return;
      set((state) => {
        if (!state.entities[ref.type]) state.entities[ref.type] = {};
        state.entities[ref.type][ref.id] = data;
      });
    },

    refreshComments: (client, commentsRoomId) => {
      const ref = get().roomToEntity[commentsRoomId];
      if (!ref) return;
      const comments = extractComments(client, commentsRoomId, ref.id);
      set((state) => {
        if (!state.comments[ref.type]) state.comments[ref.type] = {};
        state.comments[ref.type][ref.id] = comments;
      });
    },

    refreshFiles: (client, config, dataRoomId) => {
      const ref = get().roomToEntity[dataRoomId];
      if (!ref) return;
      const files = extractFiles(client, config, dataRoomId);
      set((state) => {
        if (!state.files[ref.type]) state.files[ref.type] = {};
        state.files[ref.type][ref.id] = files;
      });
    },

    upsertEntity: (type, id, data) => {
      set((state) => {
        if (!state.entities[type]) state.entities[type] = {};
        state.entities[type][id] = data;
      });
    },

    removeEntity: (type, entityId) => {
      set((state) => {
        delete state.entities[type]?.[entityId];
        delete state.comments[type]?.[entityId];
        delete state.files[type]?.[entityId];
        if (state.indices[type]) {
          state.indices[type] = state.indices[type].filter(
            (e) => e.entityId !== entityId,
          );
        }
      });
    },

    addIndexEntry: (type, entry) => {
      set((state) => {
        if (!state.indices[type]) state.indices[type] = [];
        const idx = state.indices[type].findIndex(
          (e) => e.entityId === entry.entityId,
        );
        if (idx >= 0) {
          state.indices[type][idx] = entry;
        } else {
          state.indices[type].push(entry);
        }
        state.roomToEntity[entry.dataRoomId] = {
          type,
          id: entry.entityId,
        };
        state.roomToEntity[entry.commentsRoomId] = {
          type,
          id: entry.entityId,
        };
      });
    },

    getEntities: (type) => Object.values(get().entities[type] ?? {}),

    getEntity: (type, id) => get().entities[type]?.[id],

    getIndexEntries: (type) => get().indices[type] ?? [],
  })),
);
