import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { MatrixClient } from "matrix-js-sdk";
import type { Contact } from "@/schemas/contact.schema";
import type { Comment } from "@/schemas/comment.schema";
import type { IndexEntry } from "@/schemas/index.schema";
import { loadContactIndex } from "@/matrix/index-room";
import {
  extractComments,
  extractLatestContact,
} from "@/matrix/events";
import { APP_PREFIX } from "@/lib/constants";

interface ContactsState {
  indexEntries: IndexEntry[];
  contacts: Record<string, Contact>;
  comments: Record<string, Comment[]>; // keyed by contactId
  roomToContact: Record<string, string>; // roomId → contactId

  hydrateFromMatrix: (client: MatrixClient) => void;
  refreshContact: (client: MatrixClient, dataRoomId: string) => void;
  refreshComments: (client: MatrixClient, commentsRoomId: string) => void;
  upsertContact: (contact: Contact) => void;
  removeContact: (contactId: string) => void;
  addIndexEntry: (entry: IndexEntry) => void;
}

export const useContactsStore = create<ContactsState>()(
  immer((set, get) => ({
    indexEntries: [],
    contacts: {},
    comments: {},
    roomToContact: {},

    hydrateFromMatrix: (client) => {
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

      // Also auto-join any invite rooms that match our app prefix.
      // Sequential with 300ms gaps to avoid rate-limit bursts.
      const rooms = client.getRooms();
      const roomsToJoin = rooms
        .filter(
          (r) =>
            r.getMyMembership() === "invite" &&
            r.name?.startsWith(APP_PREFIX),
        )
        .map((r) => r.roomId);

      (async () => {
        for (const roomId of roomsToJoin) {
          await client.joinRoom(roomId).catch(() => {});
          await new Promise((r) => setTimeout(r, 300));
        }
      })();

      // Refresh all known contacts
      for (const entry of index.contacts) {
        get().refreshContact(client, entry.dataRoomId);
        get().refreshComments(client, entry.commentsRoomId);
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

    upsertContact: (contact) => {
      set((state) => {
        state.contacts[contact.id] = contact;
      });
    },

    removeContact: (contactId) => {
      set((state) => {
        delete state.contacts[contactId];
        delete state.comments[contactId];
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
