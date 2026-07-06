import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { ClientEvent, RoomMemberEvent } from "matrix-js-sdk";
import type { MatrixClient, MatrixEvent, Room, RoomMember } from "matrix-js-sdk";

export const DOC_YJS_UPDATE_EVENT = "org.demo-e2e-app.doc.yjs.update";
export const DOC_YJS_SNAPSHOT_EVENT = "org.demo-e2e-app.doc.yjs.snapshot";

// After this many incremental updates have been sent since the last
// snapshot, collapse them into a single full-state snapshot event. A reload
// then only needs to decrypt the latest snapshot plus whatever updates came
// after it, instead of the entire history — so it depends on far fewer
// distinct Megolm sessions, shrinking the odds that a lost/never-received
// key makes the document appear empty.
const SNAPSHOT_INTERVAL = 20;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Must match the fragment key BlockNote's collaboration config binds to
// (see useMatrixCollaboration.ts: ydoc.getXmlFragment("document-store")).
const DOCUMENT_FRAGMENT_KEY = "document-store";

/**
 * True if applying `update` produces a document with no top-level content.
 * Used to stop an empty state from ever being treated as authoritative over
 * real content — see the guards in sendSnapshot() and loadInternal() below.
 */
function isEmptyState(update: Uint8Array): boolean {
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, update);
    return probe.getXmlFragment(DOCUMENT_FRAGMENT_KEY).length === 0;
  } finally {
    probe.destroy();
  }
}

/**
 * A Yjs provider that persists updates via Matrix room events.
 *
 * Each incremental Yjs update is sent as an `org.demo-e2e-app.doc.yjs.update`
 * room message. Every SNAPSHOT_INTERVAL updates, the full merged state is
 * also sent as a single `org.demo-e2e-app.doc.yjs.snapshot` event. On load,
 * the latest snapshot (if any) plus updates newer than it are replayed into
 * the Y.Doc to restore the full document state.
 */
export class MatrixYjsProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;

  private readonly roomId: string;
  private readonly client: MatrixClient;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingUpdates: Uint8Array[] = [];
  private destroyed = false;
  // Count of incremental updates sent since the last snapshot (seeded from
  // load() so a long-unsnapshotted document compacts itself on the next edit).
  private updatesSinceSnapshot = 0;
  // Suppress outgoing updates until load() has finished replaying history.
  // BlockNote initialises the Y.Doc with a default empty paragraph when the
  // fragment is empty. Without this gate that empty-state event would be sent
  // to Matrix before load() runs, polluting the room with a stale snapshot
  // that then conflicts with the real content on the next reload.
  private loaded = false;

  constructor(ydoc: Y.Doc, roomId: string, client: MatrixClient) {
    this.doc = ydoc;
    this.roomId = roomId;
    this.client = client;
    this.awareness = new Awareness(ydoc);
    this.doc.on("update", this.onYjsUpdate);
    this.client.on(RoomMemberEvent.Membership, this.onMembership);
  }

  async load(): Promise<void> {
    try {
      await this.loadInternal();
    } finally {
      // Open the gate regardless of outcome so a locally-typed edit (or
      // BlockNote's default-empty-paragraph init) after a failed load isn't
      // stuck buffering forever — the UI keeps editing blocked on error anyway.
      this.loaded = true;
    }
  }

  /**
   * Waits for the room to appear in the client's local store. Right after
   * accepting a share (or on a fresh login), the client may not have synced
   * this particular room into its store yet even though it's a real,
   * populated room — `getRoom` returning null here does NOT mean there is no
   * history to load, so we must not treat it as such (see loadInternal).
   */
  private waitForRoom(timeoutMs = 15000): Promise<Room | null> {
    const existing = this.client.getRoom(this.roomId);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.client.off(ClientEvent.Room, onRoom);
      };
      const onRoom = (room: Room) => {
        if (room.roomId !== this.roomId) return;
        cleanup();
        resolve(room);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);
      this.client.on(ClientEvent.Room, onRoom);
    });
  }

  private async loadInternal(): Promise<void> {
    const room = await this.waitForRoom();
    if (!room) {
      // Genuinely never showed up (bad roomId, revoked access, sync stuck) —
      // surface this as a load failure rather than silently reporting the
      // document as loaded/synced with content we never actually fetched.
      throw new Error(`Room ${this.roomId} did not sync locally in time`);
    }

    // Paginate backwards so we have the full event history — the initial sync
    // only loads the last N events, which would give an incomplete Yjs state
    // for any document with more edits than that window.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.client as any).scrollback(room, 500);
    } catch {
      // Non-fatal — apply whatever is already in the timeline
    }

    // scrollback() prepends events into the live timeline, so reading it
    // afterwards gives us the full history without iterating extra windows.
    const allEvents = room.getLiveTimeline().getEvents().slice();
    allEvents.sort((a, b) => a.getTs() - b.getTs());

    // Force-decrypt any events that are still encrypted. The initial sync and
    // scrollback deliver encrypted blobs — the SDK decrypts them asynchronously.
    // Because our useEffect fires very shortly after sync, many events may not
    // have been decrypted yet and would appear as type "m.room.encrypted",
    // causing them to be silently skipped below. Waiting for decryption here
    // prevents that race.
    await Promise.allSettled(
      allEvents
        .filter((e) => e.getType() === "m.room.encrypted")
        .map((e) => this.client.decryptEventIfNeeded(e)),
    );

    // allEvents is sorted ascending by ts, so the last snapshot found is the
    // most recent one. Everything it encodes is already folded into its
    // state, so we only need incremental updates newer than it — the older
    // ones (and their Megolm sessions) can be ignored entirely.
    let latestSnapshotContent: { state?: string } | null = null;
    let latestSnapshotTs = -Infinity;
    const updateEvents: MatrixEvent[] = [];
    for (const event of allEvents) {
      const type = event.getType();
      if (type !== DOC_YJS_UPDATE_EVENT && type !== DOC_YJS_SNAPSHOT_EVENT) continue;
      if (event.isDecryptionFailure()) continue;
      if (type === DOC_YJS_SNAPSHOT_EVENT) {
        latestSnapshotContent = event.getContent() as { state?: string };
        latestSnapshotTs = event.getTs();
      } else {
        updateEvents.push(event);
      }
    }

    let snapshotState: Uint8Array | null = null;
    if (latestSnapshotContent?.state) {
      try {
        snapshotState = fromBase64(latestSnapshotContent.state);
      } catch {
        // skip malformed snapshot
      }
    }

    // A snapshot that decodes to an empty document can never legitimately
    // supersede real prior content — if it did, whoever sent it would have
    // had nothing to encode in the first place. Treat it as if it weren't
    // there rather than let it silently hide everything before it (this is
    // a read-time backstop for snapshots persisted before sendSnapshot()
    // gained the equivalent write-time guard).
    const snapshotIsEmpty = snapshotState !== null && isEmptyState(snapshotState);
    const updates: Uint8Array[] = [];
    if (snapshotState && !snapshotIsEmpty) {
      updates.push(snapshotState);
    }
    const effectiveSnapshotTs = snapshotIsEmpty ? -Infinity : latestSnapshotTs;
    const relevantUpdates = updateEvents.filter((e) => e.getTs() > effectiveSnapshotTs);
    for (const event of relevantUpdates) {
      const content = event.getContent() as { update?: string };
      if (!content.update) continue;
      try {
        updates.push(fromBase64(content.update));
      } catch {
        // skip malformed events
      }
    }
    this.updatesSinceSnapshot = relevantUpdates.length;

    if (updates.length > 0) {
      Y.transact(
        this.doc,
        () => {
          for (const update of updates) {
            Y.applyUpdate(this.doc, update, "load");
          }
        },
        "load",
      );
    }

  }

  /** Called by the component's Matrix event listener for new/decrypted events. */
  handleMatrixEvent = (event: MatrixEvent): void => {
    if (this.destroyed) return;
    if (event.getRoomId() !== this.roomId) return;
    const type = event.getType();
    if (type !== DOC_YJS_UPDATE_EVENT && type !== DOC_YJS_SNAPSHOT_EVENT) return;
    if (event.isBeingDecrypted() || event.isDecryptionFailure()) return;
    // A snapshot's `state` is a full Y-doc state encoded the same way as an
    // incremental `update` — applying it merges in fine, and is exactly what
    // rescues a new member whose load() already resolved empty just before
    // onMembership's fresh snapshot was sent (see onMembership below).
    const content = event.getContent() as { update?: string; state?: string };
    const encoded = type === DOC_YJS_SNAPSHOT_EVENT ? content.state : content.update;
    if (!encoded) return;
    try {
      const update = fromBase64(encoded);
      // Yjs deduplicates updates already in the state vector, so applying an
      // update that was also picked up by load() is safe and is a no-op.
      Y.applyUpdate(this.doc, update, this);
    } catch {
      // ignore
    }
  };

  /**
   * A member who just joined has none of this room's historical Megolm
   * sessions — Matrix doesn't retroactively share old session keys with new
   * joiners, and key backup can't help either (it only recovers a key a
   * device once had and lost, not one it was never given). Pushing a fresh
   * full-state snapshot right after they join gives them something they
   * *can* decrypt (its key is shared to current members, them included),
   * instead of an empty document.
   */
  private onMembership = (
    _event: MatrixEvent,
    member: RoomMember,
    oldMembership?: string,
  ): void => {
    if (this.destroyed || !this.loaded) return;
    if (member.roomId !== this.roomId) return;
    if (member.membership !== "join" || oldMembership === "join") return;
    this.updatesSinceSnapshot = 0;
    void this.sendSnapshot();
  };

  private onYjsUpdate = (update: Uint8Array, origin: unknown): void => {
    // Don't echo our own sends or the load batch back to Matrix
    if (origin === this || origin === "load") return;
    if (this.destroyed) return;
    // Ignore updates that fire before load() completes (BlockNote's default
    // empty-paragraph initialisation happens here and must not be persisted).
    if (!this.loaded) return;
    this.pendingUpdates.push(update);
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.sendTimer = setTimeout(() => this.flush(), 300);
  };

  private async flush(): Promise<void> {
    this.sendTimer = null;
    if (this.pendingUpdates.length === 0) return;
    const updates = this.pendingUpdates.splice(0);
    const merged =
      updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.client as any).sendEvent(
        this.roomId,
        DOC_YJS_UPDATE_EVENT,
        { update: toBase64(merged) },
      );
      this.updatesSinceSnapshot++;
      if (this.updatesSinceSnapshot >= SNAPSHOT_INTERVAL) {
        this.updatesSinceSnapshot = 0;
        void this.sendSnapshot();
      }
    } catch (err) {
      console.warn("[yjs-matrix] failed to send update:", err);
      // Re-queue and schedule a retry — without a new timer the update would
      // sit in pendingUpdates forever (until the next user keystroke).
      this.pendingUpdates.unshift(merged);
      if (!this.destroyed) {
        this.sendTimer = setTimeout(() => this.flush(), 3000);
      }
    }
  }

  private async sendSnapshot(): Promise<void> {
    try {
      const state = Y.encodeStateAsUpdate(this.doc);
      // Never persist an empty snapshot: loadInternal() (and, before this
      // fix, older clients still trusting a stale snapshot) treats the
      // latest snapshot as authoritative and discards all updates before
      // it — an empty one here would make a real document look wiped out
      // to anyone loading it fresh. A doc with genuinely nothing in it has
      // nothing worth snapshotting anyway.
      if (isEmptyState(state)) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.client as any).sendEvent(
        this.roomId,
        DOC_YJS_SNAPSHOT_EVENT,
        { state: toBase64(state) },
      );
    } catch (err) {
      console.warn("[yjs-matrix] failed to send snapshot:", err);
      // Non-fatal — the incremental updates already sent are enough to
      // reconstruct state; updatesSinceSnapshot will cross the threshold
      // again after the next batch and retry then.
    }
  }

  destroy(): void {
    // Remove listener first so no new updates are queued after this point
    this.doc.off("update", this.onYjsUpdate);
    this.client.off(RoomMemberEvent.Membership, this.onMembership);
    if (this.sendTimer) {
      clearTimeout(this.sendTimer);
      this.sendTimer = null;
    }
    // Flush BEFORE setting destroyed — flush() checks this.destroyed and would
    // return early otherwise, silently dropping edits made within the debounce
    // window (e.g. when the user navigates away quickly after typing).
    if (this.pendingUpdates.length > 0) {
      void this.flush();
    }
    this.destroyed = true;
    this.awareness.destroy();
  }
}
