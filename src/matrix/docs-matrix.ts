import type { MatrixClient } from "matrix-js-sdk";
import { Preset } from "matrix-js-sdk";
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
  const resp = await client.createRoom({
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
 * a member of that contain a DOC_META_STATE_TYPE state event but are NOT in
 * the user's own docs index (those belong to someone else).
 */
export function loadSharedDocs(client: MatrixClient): DocIndexEntry[] {
  const ownDocs = loadDocsIndex(client);
  const ownRoomIds = new Set(ownDocs.map((d) => d.roomId).filter(Boolean));

  const shared: DocIndexEntry[] = [];

  for (const room of client.getRooms()) {
    if (ownRoomIds.has(room.roomId)) continue;
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
