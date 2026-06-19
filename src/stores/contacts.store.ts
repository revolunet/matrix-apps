import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { MatrixClient } from "matrix-js-sdk";
import type { Contact } from "@/schemas/contact.schema";
import type { Comment } from "@/schemas/comment.schema";
import type { ContactFile } from "@/schemas/file.schema";
import type { IndexEntry } from "@/schemas/index.schema";
import { loadContactIndex, addContactToIndex } from "@/matrix/index-room";
import {
  extractComments,
  extractFiles,
  extractLatestContact,
} from "@/matrix/events";
import { APP_PREFIX } from "@/lib/constants";

interface ContactsState {
  indexEntries: IndexEntry[];
  contacts: Record<string, Contact>;
  comments: Record<string, Comment[]>; // keyed by contactId
  files: Record<string, ContactFile[]>; // keyed by contactId
  roomToContact: Record<string, string>; // roomId → contactId

  hydrateFromMatrix: (client: MatrixClient) => Promise<void>;
  refreshContact: (client: MatrixClient, dataRoomId: string) => void;
  refreshComments: (client: MatrixClient, commentsRoomId: string) => void;
  refreshFiles: (client: MatrixClient, dataRoomId: string) => void;
  upsertContact: (contact: Contact) => void;
  removeContact: (contactId: string) => void;
  addIndexEntry: (entry: IndexEntry) => void;
}

export const useContactsStore = create<ContactsState>()(
  immer((set, get) => ({
    indexEntries: [],
    contacts: {},
    comments: {},
    files: {},
    roomToContact: {},

    hydrateFromMatrix: async (client) => {
      const index = loadContactIndex(client);

      set((state) => {
        state.indexEntries = index.contacts;
        // Rebuild roomToContact map
        state.roomToContact = {};
        for (const entry of index.contacts) {
          state.roomToContact[entry.dataRoomId] = entry.contactId;
          state.roomToContact[entry.commentsRoomId] = entry.contactId;
        }
      });

      // Auto-join any invite rooms that match our app prefix.
      // Sequential with 300ms gaps to avoid rate-limit bursts.
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

      // Pair joined app-prefix rooms that are not yet in our index.
      // This surfaces contacts shared with us via room invite — the owner
      // invites us to both the data and comments rooms; we auto-join them
      // above, but they were never written into our account_data index.
      // We also catch rooms joined in a previous session that were missed.
      {
        const knownContactIds = new Set(index.contacts.map((e) => e.contactId));
        const CHANNEL_PREFIX = `${APP_PREFIX}/channels/`;
        const COMMENTS_SUFFIX = "-comments";

        const dataRooms = new Map<string, string>(); // contactId → roomId
        const commentsRooms = new Map<string, string>(); // contactId → roomId

        for (const room of client.getRooms()) {
          if (room.getMyMembership() !== "join") continue;
          const name = room.name ?? "";
          if (!name.startsWith(CHANNEL_PREFIX)) continue;
          const suffix = name.slice(CHANNEL_PREFIX.length);
          if (suffix.endsWith(COMMENTS_SUFFIX)) {
            const contactId = suffix.slice(0, -COMMENTS_SUFFIX.length);
            commentsRooms.set(contactId, room.roomId);
          } else {
            dataRooms.set(suffix, room.roomId);
          }
        }

        for (const [contactId, dataRoomId] of dataRooms) {
          if (knownContactIds.has(contactId)) continue;
          const commentsRoomId = commentsRooms.get(contactId);
          if (!commentsRoomId) continue;

          // Try to read the display name from decrypted room events;
          // fall back to the contactId if the event isn't decrypted yet.
          const contact = extractLatestContact(client, dataRoomId);
          const displayName = contact?.fullname ?? contactId;

          const entry: IndexEntry = {
            contactId,
            dataRoomId,
            commentsRoomId,
            displayName,
            addedAt: new Date().toISOString(),
          };

          get().addIndexEntry(entry);
          // Persist so the shared contact survives the next page load
          // without needing another invite-scan cycle.
          await addContactToIndex(client, entry).catch(() => {});
        }
      }

      // Refresh all contacts, including any newly discovered shared ones
      for (const entry of get().indexEntries) {
        get().refreshContact(client, entry.dataRoomId);
        get().refreshComments(client, entry.commentsRoomId);
        get().refreshFiles(client, entry.dataRoomId);
      }
    },

    refreshContact: (client, dataRoomId) => {
      const contactId = get().roomToContact[dataRoomId];
      if (!contactId) return;
      const contact = extractLatestContact(client, dataRoomId);
      if (!contact) return;
      set((state) => {
        state.contacts[contactId] = contact;
      });
    },

    refreshComments: (client, commentsRoomId) => {
      const contactId = get().roomToContact[commentsRoomId];
      if (!contactId) return;
      const comments = extractComments(client, commentsRoomId);
      set((state) => {
        state.comments[contactId] = comments;
      });
    },

    refreshFiles: (client, dataRoomId) => {
      const contactId = get().roomToContact[dataRoomId];
      if (!contactId) return;
      const files = extractFiles(client, dataRoomId);
      set((state) => {
        state.files[contactId] = files;
      });
    },

    upsertContact: (contact) => {
      set((state) => {
        state.contacts[contact.id] = contact;
      });
    },

    removeContact: (contactId) => {
      set((state) => {
        delete state.contacts[contactId];
        delete state.comments[contactId];
        delete state.files[contactId];
        state.indexEntries = state.indexEntries.filter(
          (e) => e.contactId !== contactId,
        );
      });
    },

    addIndexEntry: (entry) => {
      set((state) => {
        const idx = state.indexEntries.findIndex(
          (e) => e.contactId === entry.contactId,
        );
        if (idx >= 0) {
          state.indexEntries[idx] = entry;
        } else {
          state.indexEntries.push(entry);
        }
        state.roomToContact[entry.dataRoomId] = entry.contactId;
        state.roomToContact[entry.commentsRoomId] = entry.contactId;
      });
    },
  })),
);
