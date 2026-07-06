import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type { MatrixClient } from "matrix-js-sdk";
import {
  loadDocsIndex,
  loadSharedDocs,
  saveDocsIndex,
  createDocRoom,
  setDocMeta,
  type DocIndexEntry,
} from "@/matrix/docs-matrix";

export interface DocTreeNode extends DocIndexEntry {
  children: DocTreeNode[];
}

interface DocsState {
  docs: DocIndexEntry[];
  sharedDocs: DocIndexEntry[];
  loading: boolean;

  loadDocs: (client: MatrixClient) => Promise<void>;
  /** Returns optimistic entry immediately; Matrix room is created in the background. */
  createDoc: (
    client: MatrixClient,
    title: string,
    parentDocId?: string | null,
  ) => DocIndexEntry;
  deleteDoc: (client: MatrixClient, docId: string) => Promise<void>;
  /** Leaves the Matrix room(s) for a doc shared with the current user, removing it from "Shared with me". */
  removeSharedDoc: (client: MatrixClient, docId: string) => Promise<void>;
  renameDoc: (client: MatrixClient, docId: string, title: string) => Promise<void>;
  moveDoc: (
    client: MatrixClient,
    docId: string,
    newParentDocId: string | null,
    newOrder: number,
  ) => Promise<void>;
  reorderDocs: (client: MatrixClient, reordered: DocIndexEntry[]) => Promise<void>;

  getDocById: (docId: string) => DocIndexEntry | undefined;
  getTree: () => DocTreeNode[];
  getSharedTree: () => DocTreeNode[];
  /** Room IDs of every descendant of docId, across both owned and shared docs. */
  getDescendantRoomIds: (docId: string) => string[];
}

function buildTree(docs: DocIndexEntry[]): DocTreeNode[] {
  const sorted = [...docs].sort((a, b) => a.order - b.order);
  const map = new Map<string, DocTreeNode>(
    sorted.map((d) => [d.docId, { ...d, children: [] }]),
  );
  const roots: DocTreeNode[] = [];
  for (const node of map.values()) {
    if (!node.parentDocId) {
      roots.push(node);
    } else {
      const parent = map.get(node.parentDocId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }
  return roots;
}

// Persist only docs that have a real roomId (skip optimistic entries that
// haven't been assigned a room yet — those are in-flight and will be saved
// by createDocRoom once the room is created).
function persistableDocs(docs: DocIndexEntry[]): DocIndexEntry[] {
  return docs.filter((d) => d.roomId !== null) as DocIndexEntry[];
}

export const useDocsStore = create<DocsState>((set, get) => ({
  docs: [],
  sharedDocs: [],
  loading: false,

  loadDocs: async (client) => {
    set({ loading: true });
    const indexDocs = loadDocsIndex(client);

    // account data is written async (setAccountData) — a doc just created
    // by createDoc() may already be known locally, with its roomId set,
    // before that write round-trips. Keep any such pending local entry the
    // fresh index doesn't have yet, so it doesn't flicker out of the tree
    // and so its room isn't wrongly counted as "shared" below.
    const indexDocIds = new Set(indexDocs.map((d) => d.docId));
    const pendingLocalDocs = get().docs.filter((d) => !indexDocIds.has(d.docId));
    const docs = [...indexDocs, ...pendingLocalDocs];

    const ownRoomIds = docs.map((d) => d.roomId).filter((id): id is string => !!id);
    const sharedDocs = loadSharedDocs(client, ownRoomIds);
    set({ docs, sharedDocs, loading: false });
  },

  createDoc: (client, title, parentDocId = null) => {
    const docId = uuidv4();
    const docs = get().docs;
    const siblings = docs.filter((d) => d.parentDocId === (parentDocId ?? null));
    const order = siblings.reduce((m, d) => Math.max(m, d.order), -1) + 1;
    const createdAt = new Date().toISOString();

    // Optimistic entry — visible in the tree immediately, roomId filled in async
    const optimistic: DocIndexEntry = {
      docId,
      roomId: null,
      title,
      parentDocId: parentDocId ?? null,
      order,
      createdAt,
    };

    set((s) => ({ docs: [...s.docs, optimistic] }));

    // Create the Matrix room in the background, then persist using the store's
    // current state (not stale account-data) to avoid overwriting concurrent renames.
    void createDocRoom(client, docId, title, parentDocId ?? null, order, createdAt)
      .then(async (roomId) => {
        set((s) => {
          const updated = s.docs.map((d) => (d.docId === docId ? { ...d, roomId } : d));
          void saveDocsIndex(client, persistableDocs(updated));
          return { docs: updated };
        });

        // Sub-docs are their own independent Matrix rooms — inherit whoever
        // currently has access to the parent so a doc shared earlier also
        // covers documents created under it later, not just the ones that
        // already existed at share time (see DocShareDialog for the
        // opposite direction: sharing/unsharing an existing doc fanning out
        // to its existing descendants).
        const parentRoomId = parentDocId
          ? get().docs.find((d) => d.docId === parentDocId)?.roomId
          : null;
        const parentRoom = parentRoomId ? client.getRoom(parentRoomId) : null;
        if (parentRoom) {
          const invitees = parentRoom
            .getMembers()
            .filter(
              (m) =>
                m.userId !== client.getUserId() &&
                (m.membership === "join" || m.membership === "invite"),
            );
          await Promise.allSettled(
            invitees.map((m) => client.invite(roomId, m.userId)),
          ).then((results) => {
            const failed = results.filter((r) => r.status === "rejected").length;
            if (failed > 0) {
              console.warn(`[docs] failed to inherit ${failed} of ${invitees.length} parent member(s) into new sub-doc`);
            }
          });
        }
      })
      .catch((err) => {
        console.error("[docs] failed to create Matrix room:", err);
        set((s) => ({ docs: s.docs.filter((d) => d.docId !== docId) }));
      });

    return optimistic;
  },

  deleteDoc: async (client, docId) => {
    const docs = get().docs;
    const toRemove = new Set<string>();
    const queue = [docId];
    while (queue.length) {
      const id = queue.shift()!;
      toRemove.add(id);
      docs.filter((d) => d.parentDocId === id).forEach((d) => queue.push(d.docId));
    }
    const roomIds = docs
      .filter((d) => toRemove.has(d.docId) && d.roomId)
      .map((d) => d.roomId as string);

    const updated = docs.filter((d) => !toRemove.has(d.docId));
    set({ docs: updated });
    await saveDocsIndex(client, persistableDocs(updated));

    // Also leave the rooms — otherwise we stay a joined member with no
    // index entry, so loadSharedDocs() misclassifies the deleted doc as
    // "shared with me" on the very next sync.
    await Promise.all(
      roomIds.map((roomId) =>
        client.leave(roomId).catch((err) =>
          console.warn("[docs] failed to leave deleted doc's room:", err),
        ),
      ),
    );
  },

  removeSharedDoc: async (client, docId) => {
    const shared = get().sharedDocs;
    const toRemove = new Set<string>();
    const queue = [docId];
    while (queue.length) {
      const id = queue.shift()!;
      toRemove.add(id);
      shared.filter((d) => d.parentDocId === id).forEach((d) => queue.push(d.docId));
    }
    const roomIds = shared
      .filter((d) => toRemove.has(d.docId) && d.roomId)
      .map((d) => d.roomId as string);

    set((s) => ({
      sharedDocs: s.sharedDocs.filter((d) => !toRemove.has(d.docId)),
    }));

    await Promise.all(
      roomIds.map((roomId) =>
        client.leave(roomId).catch((err) =>
          console.warn("[docs] failed to leave shared room:", err),
        ),
      ),
    );
  },

  renameDoc: async (client, docId, title) => {
    // Update local state and persist the store's authoritative list in one step.
    // Reading back from client.getAccountData() would be stale if the last
    // setAccountData hasn't been echoed back via /sync yet (common for new docs).
    const updated = get().docs.map((d) => (d.docId === docId ? { ...d, title } : d));
    set({ docs: updated });
    await saveDocsIndex(client, persistableDocs(updated));

    // Account data is private to the owner — collaborators read the title
    // from the room's own state event, which won't reflect this rename
    // unless we push it there too.
    const entry = updated.find((d) => d.docId === docId);
    if (entry?.roomId) {
      await setDocMeta(client, entry.roomId, docId, title, entry.parentDocId).catch(
        (err) => console.warn("[docs] failed to sync title to room state:", err),
      );
    }
  },

  moveDoc: async (client, docId, newParentDocId, newOrder) => {
    const updated = get().docs.map((d) =>
      d.docId === docId ? { ...d, parentDocId: newParentDocId, order: newOrder } : d,
    );
    set({ docs: updated });
    await saveDocsIndex(client, persistableDocs(updated));

    // Same reasoning as renameDoc — collaborators derive hierarchy from the
    // room's state event, not our private index.
    const entry = updated.find((d) => d.docId === docId);
    if (entry?.roomId) {
      await setDocMeta(client, entry.roomId, docId, entry.title, newParentDocId).catch(
        (err) => console.warn("[docs] failed to sync parent to room state:", err),
      );
    }
  },

  reorderDocs: async (client, reordered) => {
    const map = new Map(reordered.map((d) => [d.docId, d]));
    const updated = get().docs.map((d) => map.get(d.docId) ?? d);
    set({ docs: updated });
    await saveDocsIndex(client, persistableDocs(updated));
  },

  getDocById: (docId) =>
    get().docs.find((d) => d.docId === docId) ??
    get().sharedDocs.find((d) => d.docId === docId),

  getTree: () => buildTree(get().docs),

  getSharedTree: () => buildTree(get().sharedDocs),

  getDescendantRoomIds: (docId) => {
    // A doc's children can show up in either index depending on who's
    // asking (owner vs. collaborator), so search both rather than picking one.
    const all = [...get().docs, ...get().sharedDocs];
    const roomIds: string[] = [];
    const queue = [docId];
    while (queue.length) {
      const id = queue.shift()!;
      for (const d of all) {
        if (d.parentDocId !== id) continue;
        if (d.roomId) roomIds.push(d.roomId);
        queue.push(d.docId);
      }
    }
    return roomIds;
  },
}));
