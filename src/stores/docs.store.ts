import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type { MatrixClient } from "matrix-js-sdk";
import {
  loadDocsIndex,
  loadSharedDocs,
  saveDocsIndex,
  createDocRoom,
  setDocMeta,
  setSpaceChild,
  removeSpaceChild,
  ensureRootSpaceRoomId,
  buildSpaceHierarchy,
  orderBetween,
  type DocIndexEntry,
} from "@/matrix/docs-matrix";

/** Absolute-time version of RoomCreationRetry, for a component to diff
 * against Date.now() on its own ticking interval rather than a duration
 * that goes stale the instant it's read. */
export interface PendingRoomCreation {
  attempt: number;
  retryAt: number;
}

/** A doc's identity fields plus its tree position, derived at load time from
 * m.space.child state (see buildSpaceHierarchy) rather than stored inline. */
export interface DocEntry extends DocIndexEntry {
  parentDocId: string | null;
  order: string;
}

export interface DocTreeNode extends DocEntry {
  children: DocTreeNode[];
}

interface DocsState {
  docs: DocEntry[];
  sharedDocs: DocEntry[];
  rootSpaceRoomId: string | null;
  loading: boolean;
  /** docId -> in-progress rate-limit retry state, for docs whose room
   * creation is currently being throttled by the homeserver. */
  pendingRoomCreations: Record<string, PendingRoomCreation>;

  loadDocs: (client: MatrixClient) => Promise<void>;
  /** Returns optimistic entry immediately; Matrix room is created in the background. */
  createDoc: (
    client: MatrixClient,
    title: string,
    parentDocId?: string | null,
  ) => DocEntry;
  deleteDoc: (client: MatrixClient, docId: string) => Promise<void>;
  /** Leaves the Matrix room(s) for a doc shared with the current user, removing it from "Shared with me". */
  removeSharedDoc: (client: MatrixClient, docId: string) => Promise<void>;
  renameDoc: (client: MatrixClient, docId: string, title: string) => Promise<void>;
  moveDoc: (
    client: MatrixClient,
    docId: string,
    newParentDocId: string | null,
    newOrder: string,
  ) => Promise<void>;
  /** Reorders a single doc among its current siblings (same parent). */
  reorderDoc: (client: MatrixClient, docId: string, newOrder: string) => Promise<void>;

  getDocById: (docId: string) => DocEntry | undefined;
  getTree: () => DocTreeNode[];
  getSharedTree: () => DocTreeNode[];
  /** Room IDs of every descendant of docId, across both owned and shared docs. */
  getDescendantRoomIds: (docId: string) => string[];
}

/**
 * Docs with no m.space.child listing anywhere the user can see (never
 * ordered/moved since this feature shipped) get "" as a sentinel from
 * buildSpaceHierarchy's fallback. That's not a usable fractional-indexing
 * key — dragging one would crash generateKeyBetween — so give every such
 * doc a real key here, synthesized deterministically (sorted by createdAt)
 * so the assignment is stable across reloads without needing to persist
 * anything until the doc is actually created/moved/reordered through the
 * new code path, at which point a real m.space.child write takes over.
 */
function withFallbackOrder(docs: DocEntry[]): DocEntry[] {
  const byParent = new Map<string | null, DocEntry[]>();
  for (const d of docs) {
    const list = byParent.get(d.parentDocId) ?? [];
    list.push(d);
    byParent.set(d.parentDocId, list);
  }

  const resolved = new Map<string, DocEntry>();
  for (const siblings of byParent.values()) {
    const ordered = siblings.filter((d) => d.order !== "");
    const orderless = siblings
      .filter((d) => d.order === "")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    let prevOrder = ordered.reduce<string | undefined>(
      (max, d) => (max === undefined || d.order > max ? d.order : max),
      undefined,
    );
    for (const d of orderless) {
      const newOrder = orderBetween(prevOrder, undefined);
      resolved.set(d.docId, { ...d, order: newOrder });
      prevOrder = newOrder;
    }
  }

  return docs.map((d) => resolved.get(d.docId) ?? d);
}

function buildTree(docs: DocEntry[]): DocTreeNode[] {
  const sorted = [...docs].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
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

// Persist only identity fields for docs that have a real roomId (skip
// optimistic entries that haven't been assigned a room yet — those are
// in-flight and will be saved once createDocRoom resolves). Hierarchy
// (parentDocId/order) is never persisted here — it lives in m.space.child
// state, not the account-data index.
function persistableDocs(docs: DocEntry[]): DocIndexEntry[] {
  return docs
    .filter((d): d is DocEntry & { roomId: string } => d.roomId !== null)
    .map(({ docId, roomId, title, createdAt }) => ({ docId, roomId, title, createdAt }));
}

/**
 * Waits briefly for a just-created parent doc's roomId to show up in the
 * store. Creating a sub-doc requires the parent's room to exist (its
 * m.space.child link is written on the parent's own room), which is normally
 * already true by the time a user clicks "add child" on a rendered tree
 * item — this only matters for the narrow race of adding a child before the
 * parent's own room-creation round-trip has finished.
 */
async function waitForRoomId(
  get: () => DocsState,
  docId: string,
  timeoutMs = 8000,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const roomId = get().docs.find((d) => d.docId === docId)?.roomId;
    if (roomId) return roomId;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

export const useDocsStore = create<DocsState>((set, get) => ({
  docs: [],
  sharedDocs: [],
  rootSpaceRoomId: null,
  loading: false,
  pendingRoomCreations: {},

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
    const identityDocs: DocIndexEntry[] = [
      ...indexDocs,
      ...pendingLocalDocs.map(({ docId, roomId, title, createdAt }) => ({
        docId,
        roomId,
        title,
        createdAt,
      })),
    ];

    const rootSpaceRoomId = await ensureRootSpaceRoomId(client);

    const ownRoomIds = identityDocs.map((d) => d.roomId).filter((id): id is string => !!id);
    const sharedIdentity = loadSharedDocs(client, ownRoomIds);

    const docIdByRoomId = new Map<string, string>();
    for (const d of identityDocs) if (d.roomId) docIdByRoomId.set(d.roomId, d.docId);
    for (const d of sharedIdentity) if (d.roomId) docIdByRoomId.set(d.roomId, d.docId);

    const hierarchy = buildSpaceHierarchy(client, docIdByRoomId, rootSpaceRoomId);

    // Entries with no m.space.child listing visible to us yet (a doc whose
    // setSpaceChild write hasn't synced back, or a shared doc whose parent
    // room we're not in) fall back to whatever hierarchy we already had
    // locally, then finally to a root-level, last-sorting position.
    const prevByDocId = new Map(get().docs.map((d) => [d.docId, d]));
    const prevSharedByDocId = new Map(get().sharedDocs.map((d) => [d.docId, d]));

    const withHierarchy = (
      list: DocIndexEntry[],
      prev: Map<string, DocEntry>,
    ): DocEntry[] =>
      list.map((d) => {
        const h = hierarchy.get(d.docId);
        if (h) return { ...d, parentDocId: h.parentDocId, order: h.order };
        const fallback = prev.get(d.docId);
        return {
          ...d,
          parentDocId: fallback?.parentDocId ?? null,
          order: fallback?.order ?? "",
        };
      });

    const docs = withFallbackOrder(withHierarchy(identityDocs, prevByDocId));
    const sharedDocs = withFallbackOrder(withHierarchy(sharedIdentity, prevSharedByDocId));

    set({ docs, sharedDocs, rootSpaceRoomId, loading: false });
  },

  createDoc: (client, title, parentDocId = null) => {
    const docId = uuidv4();
    const docs = get().docs;
    const siblings = docs
      .filter((d) => d.parentDocId === (parentDocId ?? null))
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
    const order = orderBetween(siblings.at(-1)?.order, undefined);
    const createdAt = new Date().toISOString();

    // Optimistic entry — visible in the tree, in its final position,
    // immediately; roomId filled in async.
    const optimistic: DocEntry = {
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
    void createDocRoom(client, docId, title, (retry) => {
      set((s) => ({
        pendingRoomCreations: {
          ...s.pendingRoomCreations,
          [docId]: { attempt: retry.attempt, retryAt: Date.now() + retry.retryAfterMs },
        },
      }));
    })
      .then(async (roomId) => {
        set((s) => {
          const updated = s.docs.map((d) => (d.docId === docId ? { ...d, roomId } : d));
          void saveDocsIndex(client, persistableDocs(updated));
          return { docs: updated, pendingRoomCreations: omitKey(s.pendingRoomCreations, docId) };
        });

        // The doc's m.space.child link lives on its parent's own room (or
        // the root space room for a top-level doc) — resolve whichever
        // applies before writing the link.
        const parentRoomId = parentDocId ? await waitForRoomId(get, parentDocId) : null;
        const spaceParentRoomId =
          parentRoomId ?? get().rootSpaceRoomId ?? (await ensureRootSpaceRoomId(client));
        await setSpaceChild(client, spaceParentRoomId, roomId, order).catch((err) =>
          console.warn("[docs] failed to set space-child order:", err),
        );

        // Sub-docs are their own independent Matrix rooms — inherit whoever
        // currently has access to the parent so a doc shared earlier also
        // covers documents created under it later, not just the ones that
        // already existed at share time (see DocShareDialog for the
        // opposite direction: sharing/unsharing an existing doc fanning out
        // to its existing descendants).
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
        set((s) => ({
          docs: s.docs.filter((d) => d.docId !== docId),
          pendingRoomCreations: omitKey(s.pendingRoomCreations, docId),
        }));
      });

    return optimistic;
  },

  deleteDoc: async (client, docId) => {
    const docs = get().docs;
    const target = docs.find((d) => d.docId === docId);
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

    // Clean up the stale m.space.child link on the (still-joined) parent
    // room — best-effort, same as the room-leave calls below.
    if (target?.roomId) {
      const parentRoomId = target.parentDocId
        ? docs.find((d) => d.docId === target.parentDocId)?.roomId
        : get().rootSpaceRoomId;
      if (parentRoomId) {
        await removeSpaceChild(client, parentRoomId, target.roomId).catch((err) =>
          console.warn("[docs] failed to clear space-child link for deleted doc:", err),
        );
      }
    }

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
      await setDocMeta(client, entry.roomId, docId, title).catch(
        (err) => console.warn("[docs] failed to sync title to room state:", err),
      );
    }
  },

  moveDoc: async (client, docId, newParentDocId, newOrder) => {
    const current = get().docs.find((d) => d.docId === docId);
    if (!current) return;
    const oldParentDocId = current.parentDocId;

    const updated = get().docs.map((d) =>
      d.docId === docId ? { ...d, parentDocId: newParentDocId, order: newOrder } : d,
    );
    set({ docs: updated });

    if (!current.roomId) return;

    const resolveParentRoomId = (parentDocId: string | null) =>
      parentDocId ? get().docs.find((d) => d.docId === parentDocId)?.roomId ?? null : get().rootSpaceRoomId;

    const oldParentRoomId = resolveParentRoomId(oldParentDocId);
    const newParentRoomId = resolveParentRoomId(newParentDocId) ?? (await ensureRootSpaceRoomId(client));

    if (oldParentRoomId && oldParentRoomId !== newParentRoomId) {
      await removeSpaceChild(client, oldParentRoomId, current.roomId).catch((err) =>
        console.warn("[docs] failed to clear old space-child link:", err),
      );
    }
    await setSpaceChild(client, newParentRoomId, current.roomId, newOrder).catch((err) =>
      console.warn("[docs] failed to set new space-child link:", err),
    );
  },

  reorderDoc: async (client, docId, newOrder) => {
    const updated = get().docs.map((d) => (d.docId === docId ? { ...d, order: newOrder } : d));
    set({ docs: updated });

    const entry = updated.find((d) => d.docId === docId);
    if (!entry?.roomId) return;
    const parentRoomId = entry.parentDocId
      ? updated.find((d) => d.docId === entry.parentDocId)?.roomId
      : get().rootSpaceRoomId;
    if (!parentRoomId) return;

    // No manual rollback on failure: this doesn't touch the real room
    // state, so the next RoomStateEvent sync naturally reconciles the
    // optimistic position back if the write never lands.
    await setSpaceChild(client, parentRoomId, entry.roomId, newOrder).catch((err) =>
      console.warn("[docs] failed to persist reorder:", err),
    );
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
