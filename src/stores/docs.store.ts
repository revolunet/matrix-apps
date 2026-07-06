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
    const docs = loadDocsIndex(client);
    const sharedDocs = loadSharedDocs(client);
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
      .then((roomId) => {
        set((s) => {
          const updated = s.docs.map((d) => (d.docId === docId ? { ...d, roomId } : d));
          void saveDocsIndex(client, persistableDocs(updated));
          return { docs: updated };
        });
      })
      .catch((err) => {
        console.error("[docs] failed to create Matrix room:", err);
        set((s) => ({ docs: s.docs.filter((d) => d.docId !== docId) }));
      });

    return optimistic;
  },

  deleteDoc: async (client, docId) => {
    // Compute the new docs list first, then persist it — avoids re-reading
    // potentially stale account data from the client.
    set((s) => {
      const toRemove = new Set<string>();
      const queue = [docId];
      while (queue.length) {
        const id = queue.shift()!;
        toRemove.add(id);
        s.docs.filter((d) => d.parentDocId === id).forEach((d) => queue.push(d.docId));
      }
      const updated = s.docs.filter((d) => !toRemove.has(d.docId));
      void saveDocsIndex(client, persistableDocs(updated));
      return { docs: updated };
    });
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
}));
