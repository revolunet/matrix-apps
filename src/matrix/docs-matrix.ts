import type { ICreateRoomOpts, MatrixClient } from "matrix-js-sdk";
import { calculateRetryBackoff, Preset } from "matrix-js-sdk";
import { APP_PREFIX } from "@/lib/constants";

export const DOCS_INDEX_EVENT_TYPE = "org.demo-e2e-app.docs_index";
export const DOC_META_STATE_TYPE = "org.demo-e2e-app.doc.meta";

export interface DocIndexEntry {
  docId: string;
  roomId: string | null; // null while the Matrix room is still being created
  title: string;
  parentDocId: string | null;
  order: number;
  createdAt: string;
}

interface DocsIndex {
  version: 1;
  docs: DocIndexEntry[];
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

/**
 * matrix.org (and any homeserver enforcing rate limits) can reject room
 * creation with M_LIMIT_EXCEEDED when several docs are created in quick
 * succession — e.g. a root doc, then a child, then a grandchild, each
 * spawning its own room (see README's "matrix.org rate limits" warning).
 * Without a retry, that surfaces to the user as the new doc briefly
 * appearing as "Untitled" and then vanishing (see the .catch() in
 * docs.store.ts's createDoc, which drops the optimistic entry on failure).
 * calculateRetryBackoff reads the server's recommended retry_after_ms for
 * rate-limit errors and returns -1 for anything else not worth retrying.
 */
async function createRoomWithRetry(
  client: MatrixClient,
  opts: ICreateRoomOpts,
): ReturnType<MatrixClient["createRoom"]> {
  for (let attempts = 1; ; attempts++) {
    try {
      return await client.createRoom(opts);
    } catch (err) {
      const delayMs = calculateRetryBackoff(err, attempts, false);
      if (delayMs < 0) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** Creates the encrypted Matrix room for a doc and persists the index entry. */
export async function createDocRoom(
  client: MatrixClient,
  docId: string,
  title: string,
  parentDocId: string | null,
  order: number,
  createdAt: string,
): Promise<string> {
  const roomName = `${APP_PREFIX}/docs/${docId}`;
  const resp = await createRoomWithRetry(client, {
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
        content: { title, parentDocId, docId },
      },
    ],
  });

  // Index persistence is the caller's responsibility — the store saves from
  // its own authoritative state after calling this function, avoiding a
  // stale-read race when account-data echoes haven't arrived yet.
  return resp.room_id;
}

/**
 * Mirrors a title/parent change into the room's own DOC_META_STATE_TYPE
 * state event. Collaborators derive shared-doc titles and hierarchy from
 * this room state (see loadSharedDocs) — they can't read the owner's
 * private account-data index — so renames and moves are invisible to them
 * unless also written here.
 */
export async function setDocMeta(
  client: MatrixClient,
  roomId: string,
  docId: string,
  title: string,
  parentDocId: string | null,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).sendStateEvent(
    roomId,
    DOC_META_STATE_TYPE,
    { title, parentDocId, docId },
    "",
  );
}

export async function deleteDoc(
  client: MatrixClient,
  docId: string,
): Promise<void> {
  const docs = loadDocsIndex(client);
  const toRemove = new Set<string>();
  const queue = [docId];
  while (queue.length) {
    const id = queue.shift()!;
    toRemove.add(id);
    docs.filter((d) => d.parentDocId === id).forEach((d) => queue.push(d.docId));
  }
  await saveDocsIndex(client, docs.filter((d) => !toRemove.has(d.docId)));
}

export async function renameDoc(
  client: MatrixClient,
  docId: string,
  title: string,
): Promise<void> {
  const docs = loadDocsIndex(client);
  const idx = docs.findIndex((d) => d.docId === docId);
  if (idx < 0) return;
  docs[idx] = { ...docs[idx], title };
  await saveDocsIndex(client, docs);
}

export async function moveDoc(
  client: MatrixClient,
  docId: string,
  newParentDocId: string | null,
  newOrder: number,
): Promise<void> {
  const docs = loadDocsIndex(client);
  const idx = docs.findIndex((d) => d.docId === docId);
  if (idx < 0) return;
  docs[idx] = { ...docs[idx], parentDocId: newParentDocId, order: newOrder };
  await saveDocsIndex(client, docs);
}

export async function reorderDocs(
  client: MatrixClient,
  reordered: DocIndexEntry[],
): Promise<void> {
  const all = loadDocsIndex(client);
  const map = new Map(reordered.map((d) => [d.docId, d]));
  const updated = all.map((d) => map.get(d.docId) ?? d);
  await saveDocsIndex(client, updated);
}

/**
 * Returns documents shared with the current user — i.e. Matrix rooms they're
 * a member of that contain a DOC_META_STATE_TYPE state event but are NOT
 * among `ownRoomIds` (those belong to someone else).
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
      parentDocId?: string | null;
    };
    if (!content.docId) continue;

    shared.push({
      docId: content.docId,
      roomId: room.roomId,
      title: content.title ?? room.name ?? "Untitled",
      parentDocId: content.parentDocId ?? null,
      order: metaEvent.getTs(),
      createdAt: new Date(metaEvent.getTs()).toISOString(),
    });
  }

  return shared;
}
