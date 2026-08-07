import * as Y from "yjs";
import { MatrixEventEvent } from "matrix-js-sdk";
import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";
import { DOC_YJS_RESYNC_REQUEST_EVENT, isDocRoomActive, replayDocHistory, sendDocSnapshot } from "./yjs-matrix-provider";

/**
 * Answers DOC_YJS_RESYNC_REQUEST_EVENT for documents this client isn't
 * currently viewing. While a document's editor is open, its own
 * MatrixYjsProvider instance already answers requests using its live,
 * already-loaded Y.Doc (see the DOC_YJS_RESYNC_REQUEST_EVENT branch in
 * handleMatrixEvent()) — this only covers the other case: a collaborator
 * (or this account's other device) asks for a resync on a document that's
 * sitting in the background, e.g. while this tab is on the docs list or
 * viewing something else entirely. Matrix still syncs and decrypts that
 * room's events in the background regardless of which page is open, so
 * the data needed to answer is already there — we just have to replay it
 * into a throwaway Y.Doc on demand instead of reusing an already-loaded one.
 *
 * Mount once for the whole session (see AppLayout) rather than per-document.
 * Returns a cleanup function.
 */
export function startGlobalDocResyncResponder(client: MatrixClient): () => void {
  const onDecrypted = (event: MatrixEvent): void => {
    if (event.getType() !== DOC_YJS_RESYNC_REQUEST_EVENT) return;
    const roomId = event.getRoomId();
    if (!roomId) return;
    // Already handled by that document's own live provider if it's open —
    // answering again here would just be redundant.
    if (isDocRoomActive(roomId)) return;
    void respondInBackground(client, roomId);
  };
  client.on(MatrixEventEvent.Decrypted, onDecrypted);
  return () => client.off(MatrixEventEvent.Decrypted, onDecrypted);
}

async function respondInBackground(client: MatrixClient, roomId: string): Promise<void> {
  const room = client.getRoom(roomId);
  // Not a room we're actually in (or not synced locally yet) — nothing to
  // help with from here; the requester's own manual retry / next load will
  // try again.
  if (!room) return;
  console.debug("[yjs-resync-debug] background responder replaying history for", roomId); // TEMP DEBUG
  const doc = new Y.Doc();
  try {
    // Deliberately ignores hasDecryptionErrors here too, same reasoning as
    // the live-provider resync-response path (see handleMatrixEvent) —
    // sendDocSnapshot()'s own isEmptyState() check is the guard that
    // actually matters.
    await replayDocHistory(client, room, doc);
    await sendDocSnapshot(client, roomId, doc);
  } catch (err) {
    console.warn("[yjs-matrix] background resync response failed:", err);
  } finally {
    doc.destroy();
  }
}
