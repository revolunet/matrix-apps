import type { ICreateRoomOpts, MatrixClient, Room } from "matrix-js-sdk";
import { calculateRetryBackoff, EventType, Preset, RoomType } from "matrix-js-sdk";
import { generateKeyBetween } from "fractional-indexing";
import { APP_PREFIX } from "@/lib/constants";

export const DOCS_INDEX_EVENT_TYPE = "org.demo-e2e-app.docs_index";
export const DOC_META_STATE_TYPE = "org.demo-e2e-app.doc.meta";
export const ROOT_SPACE_EVENT_TYPE = "org.demo-e2e-app.root_space";

export interface DocIndexEntry {
  docId: string;
  roomId: string | null; // null while the Matrix room is still being created
  title: string;
  createdAt: string;
}

interface DocsIndex {
  version: 1;
  docs: DocIndexEntry[];
}

/** Shape of m.space.child content (matrix-js-sdk's SpaceChildEventContent
 * isn't part of its public export surface, so this is declared locally). */
interface SpaceChildContent {
  order?: string;
  suggested?: boolean;
  via?: string[];
}

/** Order key that sorts between `before` and `after` (either end may be omitted).
 * Empty strings (this module's "no order assigned yet" placeholder) are
 * treated the same as null/undefined — generateKeyBetween throws on "" since
 * it isn't a well-formed key. */
export function orderBetween(before?: string | null, after?: string | null): string {
  return generateKeyBetween(before || null, after || null);
}

export function loadDocsIndex(client: MatrixClient): DocIndexEntry[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = (client as any).getAccountData(DOCS_INDEX_EVENT_TYPE);
  if (!event) return [];
  const content = event.getContent() as Partial<DocsIndex>;
  if (content.version !== 1 || !Array.isArray(content.docs)) return [];
  return content.docs;
}

export async function saveDocsIndex(
  client: MatrixClient,
  docs: DocIndexEntry[],
): Promise<void> {
  const index: DocsIndex = { version: 1, docs };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).setAccountData(DOCS_INDEX_EVENT_TYPE, index);
}

export interface RoomCreationRetry {
  attempt: number;
  retryAfterMs: number;
}

/**
 * matrix.org (and any homeserver enforcing rate limits) can reject room
 * creation with M_LIMIT_EXCEEDED when several docs are created in quick
 * succession — e.g. a root doc, then a child, then a grandchild, each
 * spawning its own room (see README's "matrix.org rate limits" warning).
 * Without a retry, that surfaces to the user as the new doc briefly
 * appearing as "Untitled" and then vanishing (see the .catch() in
 * docs.store.ts's createDoc, which drops the optimistic entry on failure).
 * calculateRetryBackoff reads the server's recommended retry_after_ms for
 * rate-limit errors and returns -1 for anything else not worth retrying —
 * that wait can run to tens of minutes under real matrix.org throttling, so
 * `onRetry` lets callers surface it instead of leaving the UI looking hung.
 */
async function createRoomWithRetry(
  client: MatrixClient,
  opts: ICreateRoomOpts,
  onRetry?: (retry: RoomCreationRetry) => void,
): ReturnType<MatrixClient["createRoom"]> {
  for (let attempts = 1; ; attempts++) {
    try {
      return await client.createRoom(opts);
    } catch (err) {
      const delayMs = calculateRetryBackoff(err, attempts, false);
      if (delayMs < 0) throw err;
      onRetry?.({ attempt: attempts, retryAfterMs: delayMs });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** Creates the encrypted Matrix room for a doc and persists the index entry. */
export async function createDocRoom(
  client: MatrixClient,
  docId: string,
  title: string,
  onRetry?: (retry: RoomCreationRetry) => void,
): Promise<string> {
  const roomName = `${APP_PREFIX}/docs/${docId}`;
  const resp = await createRoomWithRetry(
    client,
    {
      name: roomName,
      preset: Preset.PrivateChat,
      initial_state: [
        {
          type: "m.room.encryption",
          state_key: "",
          content: { algorithm: "m.megolm.v1.aes-sha2" },
        },
        {
          type: DOC_META_STATE_TYPE,
          state_key: "",
          content: { title, docId },
        },
      ],
    },
    onRetry,
  );

  // Index persistence is the caller's responsibility — the store saves from
  // its own authoritative state after calling this function, avoiding a
  // stale-read race when account-data echoes haven't arrived yet.
  return resp.room_id;
}

/**
 * Mirrors a title change into the room's own DOC_META_STATE_TYPE state
 * event. Collaborators derive shared-doc titles from this room state (see
 * loadSharedDocs) — they can't read the owner's private account-data index —
 * so renames are invisible to them unless also written here.
 */
export async function setDocMeta(
  client: MatrixClient,
  roomId: string,
  docId: string,
  title: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).sendStateEvent(
    roomId,
    DOC_META_STATE_TYPE,
    { title, docId },
    "",
  );
}

/**
 * Sets/updates the m.space.child linking `childRoomId` under `parentRoomId`
 * at position `order` (a fractional-indexing key — see orderBetween). This is
 * the single source of truth for tree structure and position: both root-level
 * docs (parentRoomId = the per-user root space room) and nested docs
 * (parentRoomId = another doc's own room) use the same real Matrix Space
 * mechanism, so collaborators joined to the parent room see the same order.
 */
export async function setSpaceChild(
  client: MatrixClient,
  parentRoomId: string,
  childRoomId: string,
  order: string,
): Promise<void> {
  const content: SpaceChildContent = {
    via: [client.getDomain() ?? ""],
    order,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).sendStateEvent(
    parentRoomId,
    EventType.SpaceChild,
    content,
    childRoomId,
  );
}

/**
 * Removes the m.space.child link for `childRoomId` on `parentRoomId`. Per
 * the Matrix spec, an empty content object means "not a child anymore" —
 * used when reparenting (clear the old parent's link) or deleting a doc.
 */
export async function removeSpaceChild(
  client: MatrixClient,
  parentRoomId: string,
  childRoomId: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).sendStateEvent(
    parentRoomId,
    EventType.SpaceChild,
    {},
    childRoomId,
  );
}

/**
 * Creates the per-user "root space" room fresh, as a real Matrix Space
 * (m.room.create content.type = "m.space") so it renders correctly in
 * Element and other Space-aware clients, not just this app's own tree UI.
 */
async function createRootSpaceRoom(client: MatrixClient): Promise<string> {
  const resp = await createRoomWithRetry(client, {
    name: `${APP_PREFIX}/docs/root`,
    preset: Preset.PrivateChat,
    creation_content: { type: RoomType.Space },
  });
  return resp.room_id;
}

/**
 * m.room.create content — and therefore a room's Space-ness — is immutable,
 * so a root room created before this app started setting creation_content
 * can't be upgraded in place. Instead: create a fresh Space-typed room,
 * carry over every existing m.space.child link, repoint the account-data
 * pointer at it, and leave the old room (best-effort, mirroring deleteDoc's
 * cleanup-on-leave pattern elsewhere in this file).
 */
async function migrateRootSpaceRoom(client: MatrixClient, oldRoomId: string): Promise<string> {
  const newRoomId = await createRootSpaceRoom(client);

  const oldRoom = client.getRoom(oldRoomId);
  const childEvents = oldRoom?.currentState.getStateEvents(EventType.SpaceChild) ?? [];
  await Promise.all(
    childEvents.map((event) => {
      const content = event.getContent() as SpaceChildContent;
      const childRoomId = event.getStateKey();
      if (!childRoomId || !content || Object.keys(content).length === 0) return Promise.resolve();
      return setSpaceChild(client, newRoomId, childRoomId, content.order ?? "").catch((err) =>
        console.warn("[docs] failed to carry over space-child link during root migration:", err),
      );
    }),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).setAccountData(ROOT_SPACE_EVENT_TYPE, { roomId: newRoomId });
  await client.leave(oldRoomId).catch((err) =>
    console.warn("[docs] failed to leave old (pre-Space) root room after migration:", err),
  );

  return newRoomId;
}

/**
 * Lazily resolves (creating on first use) the per-user "root space" room
 * that hosts m.space.child events for every top-level doc. Root-level docs
 * have no natural parent doc room, so this container plays that role,
 * keeping the whole tree — root included — driven by real Space state
 * rather than mixing in a separate storage mechanism just for root order.
 *
 * The room holds no document content, only state, so it's created
 * unencrypted. The pointer is cached account-data; the in-flight creation
 * promise is cached module-level so concurrent callers (e.g. loadDocs firing
 * from multiple effects) don't race into creating two root rooms.
 */
let rootSpaceRoomPromise: Promise<string> | null = null;

export async function ensureRootSpaceRoomId(client: MatrixClient): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (client as any).getAccountData(ROOT_SPACE_EVENT_TYPE);
  const existingRoomId = existing?.getContent()?.roomId as string | undefined;
  if (existingRoomId) {
    const room = client.getRoom(existingRoomId);
    if (room) {
      if (room.isSpaceRoom()) return existingRoomId;
      if (!rootSpaceRoomPromise) {
        rootSpaceRoomPromise = migrateRootSpaceRoom(client, existingRoomId).finally(() => {
          rootSpaceRoomPromise = null;
        });
      }
      return rootSpaceRoomPromise;
    }
  }

  if (!rootSpaceRoomPromise) {
    rootSpaceRoomPromise = (async () => {
      const roomId = await createRootSpaceRoom(client);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any).setAccountData(ROOT_SPACE_EVENT_TYPE, { roomId });
      return roomId;
    })().finally(() => {
      rootSpaceRoomPromise = null;
    });
  }
  return rootSpaceRoomPromise;
}

export interface HierarchyEntry {
  parentDocId: string | null;
  order: string;
}

/**
 * Walks every room the current user is joined to (including the root space
 * room) and inverts their m.space.child state into a docId -> {parentDocId,
 * order} map. This is the single source of truth for tree structure,
 * covering both owned and shared docs: a doc found in no m.space.child
 * listing the user can see (e.g. a shared doc whose parent room they aren't
 * joined to) defaults to a root-level, last-sorting entry.
 *
 * m.space.parent is deliberately not used — since this function already
 * scans every joined room, reading m.space.child on each one recovers parent
 * linkage for both owned and shared docs without a second state event.
 */
export function buildSpaceHierarchy(
  client: MatrixClient,
  docIdByRoomId: ReadonlyMap<string, string>,
  rootSpaceRoomId: string,
): Map<string, HierarchyEntry> {
  const hierarchy = new Map<string, HierarchyEntry>();

  const rooms: Room[] = client.getRooms();
  for (const room of rooms) {
    if (room.getMyMembership() !== "join") continue;

    let parentDocId: string | null;
    if (room.roomId === rootSpaceRoomId) {
      parentDocId = null;
    } else {
      const docId = docIdByRoomId.get(room.roomId);
      // Neither the root space room nor a known doc room — its
      // m.space.child events (if any) don't describe part of this app's tree.
      if (!docId) continue;
      parentDocId = docId;
    }

    const childEvents = room.currentState.getStateEvents(EventType.SpaceChild);
    for (const event of childEvents) {
      const content = event.getContent() as SpaceChildContent;
      if (!content || Object.keys(content).length === 0) continue; // removed link

      const childRoomId = event.getStateKey();
      if (!childRoomId) continue;
      const childDocId = docIdByRoomId.get(childRoomId);
      if (!childDocId) continue;

      hierarchy.set(childDocId, { parentDocId, order: content.order ?? "" });
    }
  }

  return hierarchy;
}

/**
 * Returns documents shared with the current user — i.e. Matrix rooms they're
 * a member of that contain a DOC_META_STATE_TYPE state event but are NOT
 * among `ownRoomIds` (those belong to someone else). Hierarchy (parentDocId,
 * order) is filled in separately by buildSpaceHierarchy — this only resolves
 * identity (docId/roomId/title).
 *
 * `ownRoomIds` is passed in rather than re-derived from account data here:
 * account data is written via an async setAccountData() call, so a room
 * just created by createDoc() may already exist locally (in the docs
 * store's in-memory state) before that write round-trips. Re-reading
 * account data fresh in this function would miss it and misclassify a
 * brand-new own room as "shared with me" for however long that race window
 * lasts. Callers should union the account-data index with whatever they
 * already know locally.
 */
export function loadSharedDocs(
  client: MatrixClient,
  ownRoomIds: ReadonlySet<string> | string[],
): DocIndexEntry[] {
  const ownRoomIdSet = ownRoomIds instanceof Set ? ownRoomIds : new Set(ownRoomIds);

  const shared: DocIndexEntry[] = [];

  for (const room of client.getRooms()) {
    if (ownRoomIdSet.has(room.roomId)) continue;
    if (room.getMyMembership() !== "join") continue;

    const metaEvent = room.currentState.getStateEvents(DOC_META_STATE_TYPE, "");
    if (!metaEvent) continue;

    const content = metaEvent.getContent() as {
      docId?: string;
      title?: string;
    };
    if (!content.docId) continue;

    shared.push({
      docId: content.docId,
      roomId: room.roomId,
      title: content.title ?? room.name ?? "Untitled",
      createdAt: new Date(metaEvent.getTs()).toISOString(),
    });
  }

  return shared;
}
