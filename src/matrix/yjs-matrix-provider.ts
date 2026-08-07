import * as Y from "yjs";
import { v4 as uuidv4 } from "uuid";
import { Awareness } from "y-protocols/awareness";
import { ClientEvent, RoomEvent, RoomMemberEvent } from "matrix-js-sdk";
import type { MatrixClient, MatrixEvent, Room, RoomMember } from "matrix-js-sdk";

export const DOC_YJS_UPDATE_EVENT = "org.demo-e2e-app.doc.yjs.update";
export const DOC_YJS_SNAPSHOT_EVENT = "org.demo-e2e-app.doc.yjs.snapshot";
// Broadcast by a client that detected hasDecryptionErrors, asking any other
// currently-open client with a healthy copy to push a fresh snapshot — see
// requestResync() and the handler branch in handleMatrixEvent().
export const DOC_YJS_RESYNC_REQUEST_EVENT = "org.demo-e2e-app.doc.yjs.resync-request";

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

// Matrix's max PDU size is a hard, server-enforced 65536 bytes for the
// *whole* serialized event — not something we can raise. In an encrypted
// room that budget has to survive two layers of base64 inflation: our own
// encoding of the raw Yjs bytes, then Megolm's encoding of the encrypted
// blob of the JSON event (which embeds our already-base64'd string) — worst
// case close to 1.8x the raw byte count, before event/room/sender metadata
// overhead. Chunking raw payloads at 24KB keeps the inflated result under
// ~44KB, leaving comfortable headroom.
const MAX_CHUNK_BYTES = 24 * 1024;

function splitIntoChunks(bytes: Uint8Array, maxBytes: number): Uint8Array[] {
  if (bytes.byteLength <= maxBytes) return [bytes];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += maxBytes) {
    chunks.push(bytes.subarray(offset, offset + maxBytes));
  }
  return chunks;
}

interface ChunkedEventContent {
  update?: string;
  state?: string;
  chunkId?: string;
  chunkIndex?: number;
  chunkCount?: number;
}

/**
 * Reassembles chunked update/snapshot events (see sendChunkedEvent below)
 * back into the complete byte array they were split from. A single instance
 * can track multiple in-flight chunk groups (keyed by chunkId) concurrently.
 */
class ChunkReassembler {
  private groups = new Map<string, (Uint8Array | undefined)[]>();

  /** Returns the reassembled bytes once every chunk of this group has arrived, else null. */
  addChunk(chunkId: string, index: number, count: number, bytes: Uint8Array): Uint8Array | null {
    let slots = this.groups.get(chunkId);
    if (!slots) {
      // .fill(undefined) matters: a bare `new Array(count)` leaves holes,
      // which Array#some/#reduce silently skip over (unlike the `for...of`
      // below, which does visit them) — that mismatch let an incomplete
      // group look "complete" as soon as the first chunk arrived.
      slots = new Array(count).fill(undefined);
      this.groups.set(chunkId, slots);
    }
    slots[index] = bytes;
    if (slots.some((s) => s === undefined)) return null;

    this.groups.delete(chunkId);
    const total = slots.reduce((n, s) => n + s!.byteLength, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const s of slots) {
      combined.set(s!, offset);
      offset += s!.byteLength;
    }
    return combined;
  }
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
 * True if `event` was sent by this exact device (same user AND same
 * deviceId) — knowable even when decryption failed, since the sending
 * device's ID travels as plaintext wire metadata alongside the ciphertext
 * (a recipient needs it to know which of the sender's sessions to expect,
 * so it can't itself be encrypted). Used to exclude a specific class of
 * false positive from the decryption-error signal: decrypting your OWN
 * just-sent message requires your own outbound Megolm session to have
 * been imported as an inbound one first (standard practice, so you can
 * read your own history back) — if that self-import hasn't finished by
 * the time the echo arrives via sync (most likely right after creating a
 * brand-new room and sending its first-ever event), the one-time decrypt
 * attempt can fail with no retry queued. That's a transient local race,
 * never a sign that some OTHER device's content is missing — the actual
 * thing hasDecryptionErrors exists to detect.
 */
function isOwnDeviceEvent(client: MatrixClient, event: MatrixEvent): boolean {
  return (
    event.getSender() === client.getUserId() &&
    event.getWireContent()?.device_id === client.getDeviceId()
  );
}

/**
 * Sends `bytes` as one or more `eventType` room events, splitting into
 * MAX_CHUNK_BYTES pieces (tagged with a shared chunkId/index/count) when
 * it's too large for a single event — see the reassembly logic in
 * replayDocHistory() and MatrixYjsProvider.handleMatrixEvent(). Chunks are
 * sent sequentially so a failure partway through doesn't race a later
 * chunk ahead of an earlier one. Standalone rather than a class method so
 * both MatrixYjsProvider.flush() and sendDocSnapshot() can share it — the
 * latter is also called from the background resync responder for
 * documents that aren't currently open in any editor (see
 * global-doc-resync.ts).
 */
async function sendChunkedEvent(
  client: MatrixClient,
  roomId: string,
  eventType: string,
  field: "update" | "state",
  bytes: Uint8Array,
): Promise<void> {
  const chunks = splitIntoChunks(bytes, MAX_CHUNK_BYTES);
  if (chunks.length === 1) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).sendEvent(roomId, eventType, {
      [field]: toBase64(chunks[0]),
    });
    return;
  }
  const chunkId = uuidv4();
  for (let i = 0; i < chunks.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).sendEvent(roomId, eventType, {
      [field]: toBase64(chunks[i]),
      chunkId,
      chunkIndex: i,
      chunkCount: chunks.length,
    });
  }
}

/**
 * Encodes `doc`'s full state and sends it as a DOC_YJS_SNAPSHOT_EVENT,
 * unless it's empty (never persist an empty snapshot as authoritative over
 * real prior content — see isEmptyState). Standalone so it works both for
 * an already-mounted MatrixYjsProvider (its private sendSnapshot()) and for
 * the background resync responder, which builds a throwaway Y.Doc on
 * demand for a document that isn't open anywhere right now
 * (global-doc-resync.ts).
 */
export async function sendDocSnapshot(client: MatrixClient, roomId: string, doc: Y.Doc): Promise<void> {
  const state = Y.encodeStateAsUpdate(doc);
  if (isEmptyState(state)) {
    console.debug("[yjs-resync-debug] sendDocSnapshot() skipped: isEmptyState", roomId); // TEMP DEBUG
    return;
  }
  console.debug("[yjs-resync-debug] sendDocSnapshot() sending, bytes=", state.byteLength, roomId); // TEMP DEBUG
  await sendChunkedEvent(client, roomId, DOC_YJS_SNAPSHOT_EVENT, "state", state);
  console.debug("[yjs-resync-debug] sendDocSnapshot() sent", roomId); // TEMP DEBUG
}

/**
 * Replays a room's yjs update/snapshot history into `doc` — the same logic
 * an already-mounted MatrixYjsProvider uses on load, extracted so the
 * background resync responder (global-doc-resync.ts) can build a throwaway
 * Y.Doc for a document that isn't open anywhere right now. Assumes `room`
 * is already resolved — callers handle that however fits their situation
 * (MatrixYjsProvider waits for it via waitForRoom(); the background
 * responder just uses client.getRoom() and skips if it's null).
 */
export async function replayDocHistory(
  client: MatrixClient,
  room: Room,
  doc: Y.Doc,
): Promise<{ hasDecryptionErrors: boolean; updatesSinceSnapshot: number }> {
  // Paginate backwards so we have the full event history — the initial sync
  // only loads the last N events, which would give an incomplete Yjs state
  // for any document with more edits than that window.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).scrollback(room, 500);
  } catch {
    // Non-fatal — apply whatever is already in the timeline
  }

  // scrollback() prepends events into the live timeline, so reading it
  // afterwards gives us the full history without iterating extra windows.
  const allEvents = room.getLiveTimeline().getEvents().slice();
  allEvents.sort((a, b) => a.getTs() - b.getTs());

  // Force-decrypt any events that are still encrypted. The initial sync and
  // scrollback deliver encrypted blobs — the SDK decrypts them asynchronously.
  await Promise.allSettled(
    allEvents
      .filter((e) => e.getType() === "m.room.encrypted")
      .map((e) => client.decryptEventIfNeeded(e)),
  );

  // Once decryption has been attempted above, any event still flagged as a
  // failure gave up for good (no retry queued) — see isDecryptionFailure().
  // We can't know which of these were doc content vs. comments (the type
  // is only recoverable on successful decryption), so any failure here is
  // reason to warn that this copy may be incomplete — except our own
  // device's own failures, which are never that (see isOwnDeviceEvent).
  const hasDecryptionErrors = allEvents.some(
    (e) => e.isDecryptionFailure() && !isOwnDeviceEvent(client, e),
  );

  // allEvents is sorted ascending by ts, so the last snapshot found is the
  // most recent one. Everything it encodes is already folded into its
  // state, so we only need incremental updates newer than it — the older
  // ones (and their Megolm sessions) can be ignored entirely.
  //
  // A large update/snapshot may be split across several chunked events
  // (see sendChunkedEvent) — reassemble those before anything else. A chunk
  // group that never completes (a chunk missing/undecryptable) is treated
  // as if none of its chunks were there at all, rather than partially
  // applying a truncated byte stream.
  const snapshotChunks = new ChunkReassembler();
  const updateChunks = new ChunkReassembler();
  let latestSnapshotState: Uint8Array | null = null;
  let latestSnapshotTs = -Infinity;
  const updateRecords: { ts: number; bytes: Uint8Array }[] = [];
  for (const event of allEvents) {
    const type = event.getType();
    if (type !== DOC_YJS_UPDATE_EVENT && type !== DOC_YJS_SNAPSHOT_EVENT) continue;
    if (event.isDecryptionFailure()) continue;

    const content = event.getContent() as ChunkedEventContent;
    const encoded = type === DOC_YJS_SNAPSHOT_EVENT ? content.state : content.update;
    if (!encoded) continue;
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(encoded);
    } catch {
      continue;
    }
    if (
      content.chunkId !== undefined &&
      content.chunkIndex !== undefined &&
      content.chunkCount !== undefined
    ) {
      const reassembler = type === DOC_YJS_SNAPSHOT_EVENT ? snapshotChunks : updateChunks;
      const complete = reassembler.addChunk(
        content.chunkId,
        content.chunkIndex,
        content.chunkCount,
        bytes,
      );
      if (!complete) continue;
      bytes = complete;
    }

    if (type === DOC_YJS_SNAPSHOT_EVENT) {
      latestSnapshotState = bytes;
      latestSnapshotTs = event.getTs();
    } else {
      updateRecords.push({ ts: event.getTs(), bytes });
    }
  }

  // A snapshot that decodes to an empty document can never legitimately
  // supersede real prior content — if it did, whoever sent it would have
  // had nothing to encode in the first place. Treat it as if it weren't
  // there rather than let it silently hide everything before it (this is
  // a read-time backstop for snapshots persisted before sendDocSnapshot()
  // gained the equivalent write-time guard).
  const snapshotIsEmpty = latestSnapshotState !== null && isEmptyState(latestSnapshotState);
  const updates: Uint8Array[] = [];
  if (latestSnapshotState && !snapshotIsEmpty) {
    updates.push(latestSnapshotState);
  }
  const effectiveSnapshotTs = snapshotIsEmpty ? -Infinity : latestSnapshotTs;
  const relevantUpdates = updateRecords.filter((r) => r.ts > effectiveSnapshotTs);
  for (const r of relevantUpdates) {
    updates.push(r.bytes);
  }

  if (updates.length > 0) {
    Y.transact(
      doc,
      () => {
        for (const update of updates) {
          Y.applyUpdate(doc, update, "load");
        }
      },
      "load",
    );
  }

  return { hasDecryptionErrors, updatesSinceSnapshot: relevantUpdates.length };
}

// Rooms with a currently-mounted MatrixYjsProvider (i.e. that document's
// editor is open in this tab) — the background resync responder
// (global-doc-resync.ts) skips these, since the live provider already
// answers resync requests itself using its own already-loaded Y.Doc, and
// answering twice would just be redundant (harmless, but wasteful).
const activeRoomRefCounts = new Map<string, number>();

export function isDocRoomActive(roomId: string): boolean {
  return activeRoomRefCounts.has(roomId);
}

function registerActiveRoom(roomId: string): void {
  activeRoomRefCounts.set(roomId, (activeRoomRefCounts.get(roomId) ?? 0) + 1);
}

function unregisterActiveRoom(roomId: string): void {
  const count = activeRoomRefCounts.get(roomId) ?? 0;
  if (count <= 1) activeRoomRefCounts.delete(roomId);
  else activeRoomRefCounts.set(roomId, count - 1);
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
  // True whenever there's local content not yet confirmed persisted to
  // Matrix — either still buffered in pendingUpdates waiting out the
  // debounce, or in the middle of/retrying a flush(). The UI's "Synced"
  // indicator is driven off this rather than off `loaded`, since `loaded`
  // only reflects the *initial* load and says nothing about edits made
  // since.
  private syncing = false;
  onSyncStateChange: ((syncing: boolean) => void) | null = null;
  // Reassemble chunked events arriving live (loadInternal uses its own
  // short-lived reassemblers for the one-off history replay).
  private readonly liveUpdateChunks = new ChunkReassembler();
  private readonly liveSnapshotChunks = new ChunkReassembler();

  // Event ids of live (post-load) events in this room that arrived encrypted
  // and haven't finished decrypting yet — i.e. a revision we know exists but
  // haven't been able to apply. `syncing` alone can't capture this: it only
  // ever flips true for *this client's own* unflushed edits (onYjsUpdate
  // ignores updates applied with origin === this, which is what
  // handleMatrixEvent uses for remote content — see there). Without this,
  // a client with nothing of its own to send always reads "Synced" even
  // while a remote edit is still waiting on decryption/key delivery.
  private readonly pendingReceiveIds = new Set<string>();
  private receiving = false;
  onReceivingStateChange: ((receiving: boolean) => void) | null = null;

  // True once we've seen an event in this room that the SDK gave up trying
  // to decrypt. Megolm only reveals an event's real type on successful
  // decryption — a permanently-failed event could be a yjs update/snapshot
  // or an unrelated comment, and there's no way to tell which after the
  // fact. So we treat any such failure as a sign this document *may* be
  // incomplete on this device, rather than silently rendering whatever did
  // decrypt as if it were the whole document (see loadInternal/handleMatrixEvent).
  private decryptionErrors = false;
  onDecryptionErrorChange: ((hasErrors: boolean) => void) | null = null;

  private setSyncing(value: boolean): void {
    if (this.syncing === value) return;
    this.syncing = value;
    this.onSyncStateChange?.(value);
  }

  isSyncing(): boolean {
    return this.syncing;
  }

  private setReceiving(value: boolean): void {
    if (this.receiving === value) return;
    this.receiving = value;
    this.onReceivingStateChange?.(value);
  }

  isReceiving(): boolean {
    return this.receiving;
  }

  private setDecryptionErrors(value: boolean): void {
    if (this.decryptionErrors === value) return;
    this.decryptionErrors = value;
    this.onDecryptionErrorChange?.(value);
  }

  hasDecryptionErrors(): boolean {
    return this.decryptionErrors;
  }

  /** Stops tracking `eventId` as a pending incoming revision, if it was one. */
  private settleReceive(eventId: string | undefined): void {
    if (eventId === undefined) return;
    if (!this.pendingReceiveIds.delete(eventId)) return;
    if (this.pendingReceiveIds.size === 0) this.setReceiving(false);
  }

  constructor(ydoc: Y.Doc, roomId: string, client: MatrixClient) {
    this.doc = ydoc;
    this.roomId = roomId;
    this.client = client;
    this.awareness = new Awareness(ydoc);
    this.doc.on("update", this.onYjsUpdate);
    this.client.on(RoomMemberEvent.Membership, this.onMembership);
    this.client.on(RoomEvent.Timeline, this.onTimelineEvent);
    registerActiveRoom(this.roomId);
  }

  /**
   * Flags a live incoming event as a pending revision the moment it shows up
   * still encrypted, well before `handleMatrixEvent` gets a chance to apply
   * it (that only runs once MatrixEventEvent.Decrypted fires). Restricted to
   * events after the initial load (`this.loaded`) — history replay is
   * already handled synchronously by loadInternal().
   */
  private onTimelineEvent = (
    event: MatrixEvent,
    room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
    removed: boolean,
  ): void => {
    if (this.destroyed || !this.loaded) return;
    if (removed || toStartOfTimeline) return;
    if (room?.roomId !== this.roomId) return;
    if (!event.isEncrypted() || !event.isBeingDecrypted()) return;
    const id = event.getId();
    if (id === undefined) return;
    this.pendingReceiveIds.add(id);
    this.setReceiving(true);
  };

  async load(): Promise<void> {
    try {
      await this.loadInternal();
    } finally {
      // Open the gate regardless of outcome so a locally-typed edit (or
      // BlockNote's default-empty-paragraph init) after a failed load isn't
      // stuck buffering forever — the UI keeps editing blocked on error anyway.
      this.loaded = true;
    }
    // Only reached on the success path (a throw above skips past this).
    // Ask any other currently-open, healthy client — same user's other
    // device, or another collaborator's, see DocShareDialog/isShared — to
    // push a fresh snapshot. Best-effort: if nobody with a healthy copy is
    // online right now this goes unanswered (loadInternal()'s scrollback
    // replay ignores this event type, so it's never retroactively
    // serviced) — see the manual "Ask another device" button in
    // DocEditorPage for that case, and the DOC_YJS_RESYNC_REQUEST_EVENT
    // branch in handleMatrixEvent() for who answers and when.
    // TEMP DEBUG — remove once resync is confirmed working end-to-end.
    console.debug(
      "[yjs-resync-debug] load() finished for",
      this.roomId,
      "hasDecryptionErrors=", this.hasDecryptionErrors(),
    );
    if (this.hasDecryptionErrors()) {
      void this.requestResync();
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

    const { hasDecryptionErrors, updatesSinceSnapshot } = await replayDocHistory(this.client, room, this.doc);
    this.setDecryptionErrors(hasDecryptionErrors);
    this.updatesSinceSnapshot = updatesSinceSnapshot;
  }

  /** Called by the component's Matrix event listener for new/decrypted events. */
  handleMatrixEvent = (event: MatrixEvent): void => {
    if (this.destroyed) return;
    if (event.getRoomId() !== this.roomId) return;
    // Keep it pending if a retry is queued (isDecryptionFailure() with
    // shouldAttemptDecryption() true) — we'll get another Decrypted
    // notification once that retry lands, whether it succeeds or gives up.
    if (!event.isBeingDecrypted() && !(event.isDecryptionFailure() && event.shouldAttemptDecryption())) {
      this.settleReceive(event.getId());
    }
    // A live event that permanently failed to decrypt (no retry queued) —
    // same reasoning as in replayDocHistory: we can't tell if it was doc
    // content or a comment, so flag it rather than pretend nothing was
    // missed — except our own device's own failures (see isOwnDeviceEvent).
    if (
      event.isDecryptionFailure() &&
      !event.shouldAttemptDecryption() &&
      !isOwnDeviceEvent(this.client, event)
    ) {
      this.setDecryptionErrors(true);
    }
    const type = event.getType();
    if (type === DOC_YJS_RESYNC_REQUEST_EVENT) {
      // TEMP DEBUG — remove once resync is confirmed working end-to-end.
      console.debug(
        "[yjs-resync-debug] received resync-request in",
        this.roomId,
        "loaded=", this.loaded,
        "will respond=", this.loaded,
      );
      // Someone — possibly our own other device, possibly another
      // collaborator's — is missing content and asking for a fresh full
      // snapshot. Deliberately does NOT check hasDecryptionErrors() here:
      // that signal fires on *any* undecryptable event ever seen in this
      // room, including totally unrelated ones (a stray comment, another
      // now-gone device's leftover event) — in any room with real device
      // churn it's near-guaranteed to be true for everyone eventually, which
      // would make every client permanently refuse to ever answer a resync
      // request. The actual risk this would guard against (an empty client
      // publishing itself as authoritative) is already covered by
      // sendSnapshot()'s own isEmptyState() check. `this.loaded` just
      // guards against answering before our own load() has even run.
      if (this.loaded) {
        this.updatesSinceSnapshot = 0;
        void this.sendSnapshot();
      }
      return;
    }
    if (type !== DOC_YJS_UPDATE_EVENT && type !== DOC_YJS_SNAPSHOT_EVENT) return;
    if (event.isBeingDecrypted() || event.isDecryptionFailure()) return;
    if (type === DOC_YJS_SNAPSHOT_EVENT) {
      console.debug("[yjs-resync-debug] handleMatrixEvent received snapshot in", this.roomId); // TEMP DEBUG
    }
    // A snapshot's `state` is a full Y-doc state encoded the same way as an
    // incremental `update` — applying it merges in fine, and is exactly what
    // rescues a new member whose load() already resolved empty just before
    // onMembership's fresh snapshot was sent (see onMembership below).
    const content = event.getContent() as ChunkedEventContent;
    const encoded = type === DOC_YJS_SNAPSHOT_EVENT ? content.state : content.update;
    if (!encoded) return;
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(encoded);
    } catch {
      return;
    }
    if (
      content.chunkId !== undefined &&
      content.chunkIndex !== undefined &&
      content.chunkCount !== undefined
    ) {
      const reassembler = type === DOC_YJS_SNAPSHOT_EVENT ? this.liveSnapshotChunks : this.liveUpdateChunks;
      const complete = reassembler.addChunk(content.chunkId, content.chunkIndex, content.chunkCount, bytes);
      if (!complete) return; // wait for the rest of this chunk group
      bytes = complete;
    }
    try {
      // Yjs deduplicates updates already in the state vector, so applying an
      // update that was also picked up by load() is safe and is a no-op.
      Y.applyUpdate(this.doc, bytes, this);
      // Merging in any non-empty snapshot is our best available signal that
      // we've now caught up — the sender's own hasDecryptionErrors() isn't
      // checked for resync-responses (see handleMatrixEvent's
      // DOC_YJS_RESYNC_REQUEST_EVENT branch), so this isn't an absolute
      // guarantee of completeness, just the best we can do without knowing
      // event types across a decryption failure. Gated on `this.loaded` so
      // a historical snapshot decrypting while loadInternal() is still
      // computing its own answer can't race ahead of it.
      if (type === DOC_YJS_SNAPSHOT_EVENT && this.loaded) {
        console.debug("[yjs-resync-debug] applied snapshot, clearing hasDecryptionErrors"); // TEMP DEBUG
        this.setDecryptionErrors(false);
      }
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
    // Opportunistic/implicit trigger — see the matching comment in flush().
    if (this.hasDecryptionErrors()) return;
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
    this.setSyncing(true);
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
      await sendChunkedEvent(this.client, this.roomId, DOC_YJS_UPDATE_EVENT, "update", merged);
      this.updatesSinceSnapshot++;
      // Opportunistic/implicit trigger — skip while we have known gaps
      // rather than risk quietly baking an incomplete state in as
      // authoritative (unlike the explicit resync-response path, nobody
      // asked for this one, so there's no cost to just waiting).
      if (this.updatesSinceSnapshot >= SNAPSHOT_INTERVAL && !this.hasDecryptionErrors()) {
        this.updatesSinceSnapshot = 0;
        void this.sendSnapshot();
      }
      // Only "synced" if nothing else queued up while this send was in
      // flight (a keystroke mid-flush already pushed a new pendingUpdates
      // entry and armed a fresh sendTimer, so this stays true until that
      // one flushes too).
      if (this.pendingUpdates.length === 0 && !this.sendTimer) {
        this.setSyncing(false);
      }
    } catch (err) {
      console.warn("[yjs-matrix] failed to send update:", err);
      // Re-queue and schedule a retry — without a new timer the update would
      // sit in pendingUpdates forever (until the next user keystroke).
      this.pendingUpdates.unshift(merged);
      if (!this.destroyed) {
        this.sendTimer = setTimeout(() => this.flush(), 3000);
      }
      // Still unsaved — stays true through the retry backoff.
    }
  }

  // Callers that trigger a snapshot opportunistically/implicitly (flush()'s
  // periodic one, onMembership's join-triggered one) should skip it while
  // hasDecryptionErrors() is true — see the checks at those call sites.
  // handleMatrixEvent's resync-response deliberately does NOT check that
  // here: hasDecryptionErrors() fires on *any* undecryptable event ever
  // seen in the room (even a totally unrelated stray one), so gating this
  // shared method on it would let one irrelevant undecryptable event
  // permanently block every explicit resync response too. The one risk
  // that actually matters here — an empty client overwriting real content
  // — is covered by the isEmptyState() check below regardless of caller.
  private async sendSnapshot(): Promise<void> {
    try {
      await sendDocSnapshot(this.client, this.roomId, this.doc);
    } catch (err) {
      console.warn("[yjs-matrix] failed to send snapshot:", err);
      // Non-fatal — the incremental updates already sent are enough to
      // reconstruct state; updatesSinceSnapshot will cross the threshold
      // again after the next batch and retry then.
    }
  }

  /**
   * Best-effort ask to any other currently-open client in this room — the
   * same user's other device, or another collaborator's (rooms can be
   * shared, see DocShareDialog/isShared) — to push a fresh snapshot. Works
   * without interactive device verification: Matrix shares a brand-new
   * Megolm session with every current member's devices regardless of
   * whether they could decrypt older sessions — the same fact onMembership
   * already relies on for newly-joined members. Verification is about
   * trust/cross-signing, not a precondition for the crypto layer handing a
   * new session key to a joined member's device.
   */
  async requestResync(): Promise<void> {
    if (this.destroyed) return;
    console.debug("[yjs-resync-debug] requestResync() sending for", this.roomId); // TEMP DEBUG
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.client as any).sendEvent(this.roomId, DOC_YJS_RESYNC_REQUEST_EVENT, {});
      console.debug("[yjs-resync-debug] requestResync() sent"); // TEMP DEBUG
    } catch (err) {
      console.warn("[yjs-matrix] failed to send resync request:", err);
    }
  }

  destroy(): void {
    // Remove listener first so no new updates are queued after this point
    this.doc.off("update", this.onYjsUpdate);
    this.client.off(RoomMemberEvent.Membership, this.onMembership);
    this.client.off(RoomEvent.Timeline, this.onTimelineEvent);
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
    unregisterActiveRoom(this.roomId);
  }
}
