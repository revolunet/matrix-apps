# Architecture

## System Overview

proto-cms-matrix is a serverless SPA. There is no application server, no REST API, and no database. The browser is the only client. All state lives in two places:

1. **Matrix homeserver** — encrypted room timelines + unencrypted `account_data`.
2. **Browser IndexedDB** — the Rust/WASM crypto store (Megolm session keys, cross-signing keys, key backup).

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                          │
│                                                         │
│  React SPA                                              │
│  ┌──────────────┐   Zustand stores                      │
│  │  Components  │ ◄──────────────── entity.store.ts     │
│  │  (pages,     │                   auth.store.ts        │
│  │   layout,    │                   sync.store.ts        │
│  │   forms)     │                                        │
│  └──────┬───────┘                                        │
│         │ calls                                          │
│  ┌──────▼───────────────────────┐                        │
│  │  matrix-js-sdk (JS)          │                        │
│  │  src/matrix/                 │                        │
│  │  ┌─────────────────────────┐ │                        │
│  │  │ @matrix-org/             │ │◄── IndexedDB           │
│  │  │ matrix-sdk-crypto-wasm   │ │    (crypto store)      │
│  │  │ (Rust compiled to WASM) │ │                        │
│  │  └─────────────────────────┘ │                        │
│  └──────────────────────────────┘                        │
│         │ HTTPS (Matrix Client-Server API)               │
└─────────┼───────────────────────────────────────────────┘
          │
┌─────────▼───────────────┐
│   Matrix Homeserver      │
│   (matrix.org or custom) │
│                          │
│  • Encrypted room events │
│  • account_data          │
│  • Media repository      │
│    (unencrypted bytes)   │
└──────────────────────────┘
```

---

## Entity Registry

The app uses an **entity registry pattern** (`src/entities/registry.ts`). Each entity type registers a self-contained `EntityConfig` at startup:

```typescript
registerEntity({
  type: 'contact',
  label: 'Contact',
  pluralLabel: 'Contacts',
  urlSegment: 'contacts',
  schema: ContactSchema,
  formSchema: ContactFormSchema,
  fields: [...],
  eventTypePrefix: 'org.demo-e2e-app.contact',
  roomNameFn: (id, suffix) => `demo-e2e-app/channels/${id}${suffix ? `-${suffix}` : ''}`,
  displayNameFn: (data) => data.fullname ?? data.id,
  matchRoomName: (name) => { /* reverse-parse name → { entityId, isComments } */ },
})
```

All UI (routing, sidebar, forms, list views, detail pages), Matrix helpers (room creation, event types, index keys), and store operations are driven generically from these configs. Adding a new entity type requires only a schema file, a config file, and one import in `src/App.tsx`.

Entity configs are registered by importing the config module at the top of `src/App.tsx`:

```typescript
import "@/entities/contact/config";
import "@/entities/company/config";
import "@/entities/training/config";
```

---

## Startup Sequence

```
User submits login form
        │
        ▼
login()                              src/matrix/auth.ts:14
  POST /login → access_token, userId, deviceId
  sessionStorage["matrix_session"] = { accessToken, userId, deviceId }
  sessionStorage["matrix_login_password"] = password   ← used for UIA later
        │
        ▼
createMatrixClient()                 src/matrix/client.ts:131
  sdk.createClient({ accessToken, userId, deviceId,
    cryptoCallbacks: { getSecretStorageKey } })
        │
        ▼
initRustCrypto({ storeName })        src/matrix/client.ts:161
  storeName = `${userId}:${deviceId}`
  Opens/creates IndexedDB store for this device.
  On "account doesn't match" error: deletes stale stores → retries.
        │
        ▼
startMatrixClient()                  src/matrix/client.ts:184
  client.startClient({ initialSyncLimit: 20 })
  Waits for first PREPARED or SYNCING sync state.
        │
        ▼
bootstrapCrypto()   [background]     src/matrix/client.ts:85
  isSecretStorageReady()?
    No  → bootstrapSecretStorage({ createSecretStorageKey })
           generates recovery key → stores in sessionStorage
    Yes → skip (don't overwrite another client's key)
  bootstrapCrossSigning({ authUploadDeviceSigningKeys })
    reads password from sessionStorage for UIA
  errors suppressed as console.warn (non-fatal prototype choice)
        │
        ▼
attachSyncListeners()                src/matrix/sync.ts:28
  Registers 5 Matrix SDK event listeners.
  If PREPARED/SYNCING already reached: calls markReady() immediately.
        │
        ▼
hydrateFromMatrix()   [debounced]    src/stores/entity.store.ts
  Reads all registered entity types via getAllEntityConfigs()
  For each type: reads account_data index → auto-joins pending invites
  Pairs data+comments rooms using config.matchRoomName()
  Calls refreshEntity / refreshComments / refreshFiles for each entry
  Builds roomToEntity: Record<roomId, { type, id }> for O(1) dispatch
```

On page reload, `initializeSession()` (`src/matrix/auth.ts:110`) reads the stored session from `sessionStorage` and runs the same chain from `createMatrixClient` onward, bypassing the login form.

---

## Architecture Decision Records

### ADR-1: Full-snapshot events instead of state events

**Decision:** Entity data is stored as regular Megolm-encrypted timeline events of type `<eventTypePrefix>.update`. Every edit appends a new full snapshot. The reader (`extractLatestEntity`) scans from the newest event backward and returns the first successfully decrypted snapshot.

**Why not Matrix state events?** Matrix state events (`m.room.member`, `m.room.name`, etc.) cannot be E2E encrypted. A state event's `content` is transmitted in plaintext between homeserver and clients. Using state events for entity data would expose all fields to the homeserver operator.

**Trade-off:** The room timeline grows linearly with edits. There is no compaction. See LIMIT-11 in [limitations.md](limitations.md).

**Code reference:** `src/matrix/entity-events.ts:25` — `extractLatestEntity()` iterates `room.getLiveTimeline().getEvents()` in reverse, skipping events that are still being decrypted or have failed decryption. Supports both new `content.entity` format and legacy `content.contact` format for backward compatibility.

---

### ADR-2: Two rooms per entity (data room + comments room)

**Decision:** Each entity gets two separate Matrix rooms created in `src/matrix/entity-rooms.ts` (`createEntityRooms`):

- **Data room** — stores `<prefix>.update` events and `<prefix>.file` events.
- **Comments room** — stores `m.room.message` events (plain text comments).

**Why two rooms?** Room membership is per-room. Using two rooms allows fine-grained sharing: the entity owner can later grant read-only access to the data room while keeping comments private (or vice versa). With a single room, every invitee would see everything.

**Naming convention:** Room names are derived by each entity config's `roomNameFn`. The `-comments` suffix is the pairing signal used by `matchRoomName` to distinguish the two rooms. Example for Contact:
- Data room: `demo-e2e-app/channels/<id>`
- Comments room: `demo-e2e-app/channels/<id>-comments`

Both rooms use `m.megolm.v1.aes-sha2` encryption (`src/matrix/entity-rooms.ts`).

---

### ADR-3: Per-entity-type index in `account_data`

**Decision:** Each entity type stores its own index in Matrix `account_data` under the key `<eventTypePrefix>_index` (e.g. `org.demo-e2e-app.contact_index`). The index maps `entityId → { dataRoomId, commentsRoomId, displayName, addedAt }`. Managed by `src/matrix/entity-index.ts`.

**Why `account_data`?**
- Syncs automatically across all of the user's devices without any extra infrastructure.
- Survives browser storage clears (unlike IndexedDB or localStorage).
- No extra Matrix room is needed.

**Trade-off:** `account_data` events are not E2E encrypted. They are visible to the homeserver operator. The index stores only room IDs and a display name — not sensitive entity fields. The actual entity data lives in encrypted room events. See the security table in [security.md](security.md).

**Backward compatibility:** The contact index key `org.demo-e2e-app.contact_index` is identical to the legacy `INDEX_EVENT_TYPE` value, so pre-existing contacts remain discoverable after the migration.

---

### ADR-4: Entity Registry Pattern

**Decision:** All entity type definitions (schema, fields, event type prefix, room naming, display name) are encapsulated in self-contained `EntityConfig` objects registered at startup via `registerEntity()`. All UI, routing, Matrix helpers, and store operations are driven generically from the registry — there are no entity-specific pages, store methods, or matrix helpers.

**Why not per-entity pages/stores?** The prototype needed to support multiple entity types (Contact, Company, Training) without duplicating pages, stores, and Matrix helpers for each. A registry pattern allows O(1) addition of new entity types.

**Trade-off:** The generic layer adds indirection. TypeScript types use `unknown` for entity data payloads, which requires explicit casts at access points. Per-entity customization (e.g., a special list view for one entity type) cannot be expressed through the generic `EntityConfig` interface without extending it.

---

## Event Type Registry

Event types are derived at runtime from each entity config's `eventTypePrefix`. There are no static constant definitions for custom event types.

| Pattern | Example | Room | Purpose | Encrypted |
|---|---|---|---|---|
| `<prefix>.update` | `org.demo-e2e-app.contact.update` | Data room | Full entity snapshot (latest wins) | Yes (Megolm) |
| `<prefix>.file` | `org.demo-e2e-app.contact.file` | Data room | File attachment metadata | Yes (Megolm) — metadata only; file bytes are separately AES-256-CTR encrypted (`attachment-crypto.ts`) |
| `m.room.message` | `m.room.message` | Comments room | Comment text | Yes (Megolm) |
| `<prefix>_index` | `org.demo-e2e-app.contact_index` | `account_data` | Entity index (room IDs, display names) | No |

All custom event types are sent using `(client as any).sendEvent(...)` to bypass Matrix SDK v41's strict `TimelineEvents` union type constraint. See `src/matrix/entity-events.ts`.

Docs uses its own, separately-defined event types — see [Docs Architecture](#docs-architecture) below for the full table.

---

## Docs Architecture

Docs is the second app built on top of the same login/crypto layer as the CRM, but it makes different structural choices — one room per document (not two), a CRDT (Yjs) instead of latest-write-wins snapshots, and a hybrid ownership model where hierarchy is private but mirrored into room state for collaborators. `docs/index.md`'s Quick Source Links table lists every file referenced below.

### One room per document

**Decision:** Each document is a single encrypted Matrix room (`createDocRoom`, `src/matrix/docs-matrix.ts`), created with `m.room.encryption` and a `DOC_META_STATE_TYPE` state event carrying `{ title, parentDocId, docId }`. That one room carries three kinds of content:

- Yjs CRDT updates/snapshots (`DOC_YJS_UPDATE_EVENT` / `DOC_YJS_SNAPSHOT_EVENT`) — the document body.
- Comments (`m.room.message` with `content.doc_comment: true` and `content.doc_id`) — sent directly by `DocCommentsSidebar`, no dedicated comments room.
- The `DOC_META_STATE_TYPE` state event — title/parent, kept in sync by `setDocMeta` whenever the owner renames or moves the doc.

**Why one room, unlike the CRM's data+comments split (ADR-2)?** The CRM splits rooms so an entity's comments can be shared independently of its data. Docs doesn't offer that distinction — sharing a document always shares its discussion — so a single room avoids double room-creation latency and rate-limit exposure for every new doc (see `createRoomWithRetry` below).

**Trade-off:** Comments cannot be shared or restricted separately from content, and both share the same Megolm session/timeline growth profile.

### Hierarchy: private index + mirrored room state

Document hierarchy (nesting, ordering, titles) is authoritative in the owner's `account_data` under `DOCS_INDEX_EVENT_TYPE` (`org.demo-e2e-app.docs_index`) — a flat array of `DocIndexEntry { docId, roomId, title, parentDocId, order, createdAt }`, turned into a tree client-side by `buildTree` (`src/stores/docs.store.ts`).

Collaborators a document is shared with cannot read the owner's private `account_data`, so they'd otherwise see no title and no place in the hierarchy. `loadSharedDocs` (`src/matrix/docs-matrix.ts`) works around this by scanning every joined room for a `DOC_META_STATE_TYPE` state event and reconstructing a `DocIndexEntry` from it — using the state event's own timestamp as a synthetic `order`. Every mutation that touches title or parent (`renameDoc`, `moveDoc` in `docs.store.ts`) therefore writes twice: once to the owner's private index, once via `setDocMeta` into the room's state, so collaborators' view stays consistent with the owner's.

**Consequence:** A document's position in *your own* tree and its position in a *collaborator's* "Shared with me" tree are derived from two different sources of truth that happen to be kept in sync by convention, not by a single write path. See LIMIT-16 in [limitations.md](limitations.md).

### CRDT sync over chunked Matrix events

`MatrixYjsProvider` (`src/matrix/yjs-matrix-provider.ts`) bridges a Yjs `Y.Doc` to the doc's Matrix room:

- Every local edit batches into `pendingUpdates`, debounced 300 ms, then merged (`Y.mergeUpdates`) and sent as one `DOC_YJS_UPDATE_EVENT`.
- Every `SNAPSHOT_INTERVAL` (20) updates, the full merged Yjs state is also sent as a `DOC_YJS_SNAPSHOT_EVENT`, so a fresh load only has to decrypt the latest snapshot plus updates newer than it — not the entire room history. This depends on fewer distinct Megolm sessions, which shrinks the odds that one lost/undelivered session key makes the whole document appear empty.
- **Chunking:** Matrix enforces a hard 65536-byte limit on the whole serialized event (PDU), and in an encrypted room that budget has to survive two layers of base64 inflation (our own encoding of the raw Yjs bytes, then Megolm's encoding of the ciphertext). `splitIntoChunks` caps raw payloads at 24 KB per chunk — comfortably under the ~44 KB worst-case inflated size — tagging each chunk with a shared `chunkId`/`chunkIndex`/`chunkCount` so `ChunkReassembler` can reconstitute them on the reading side (used both by live sync in `handleMatrixEvent` and by history replay in `loadInternal`). An incomplete chunk group (one chunk missing or undecryptable) is treated as if none of it arrived, rather than applying a truncated byte stream.
- **Empty-state guards:** `isEmptyState()` probes a candidate update against a scratch `Y.Doc` before treating it as authoritative. `sendSnapshot()` refuses to publish an empty snapshot (a real document's latest snapshot should never look wiped out), and `loadInternal()` independently discards an empty snapshot read from history as a read-time backstop for snapshots persisted before that write-time guard existed.
- **New-member resnapshot:** A newly-joined room member has none of the room's historical Megolm sessions and cannot benefit from key backup (which only recovers keys a device once had, not ones it was never given). `onMembership` responds to a join by resetting `updatesSinceSnapshot` and immediately sending a fresh snapshot, encrypted to a Megolm session that includes the new member — giving them something decryptable instead of an empty document.
- **Load path:** `loadInternal()` calls `scrollback(room, 500)` to pull full room history (the initial sync's `initialSyncLimit: 20` would otherwise truncate it), force-decrypts any still-encrypted events, then replays the latest usable snapshot plus subsequent updates into the `Y.Doc`.
- **Sync state UI:** Two independently-tracked booleans back the "Synced / Saving… / Updating… / Failed to sync" indicator in `DocEditorPage`: `isSyncing` (local edits not yet confirmed persisted — set from `onYjsUpdate` through `flush()`) and `isReceiving` (a live remote event has arrived but not finished decrypting — set from `onTimelineEvent`, cleared once `handleMatrixEvent` or a decryption-failure settles it). A client with nothing local to send can still correctly show "Updating…" while catching up on someone else's edit.
- **Retry on send failure:** `flush()` re-queues the merged update and retries on a 3 s timer if the `sendEvent` call fails, rather than dropping the edit.

### Sharing and sub-document fan-out

Since sub-documents are independent Matrix rooms (not nested within a parent room), sharing a parent doesn't implicitly grant access to its children. Two code paths keep access consistent:

1. **At share time** — `DocShareDialog.handleShare` invites the target user to the doc's own room, then fans the invite out to every existing descendant (`getDescendantRoomIds`), skipping rooms the target is already in/invited to. `handleRemove` mirrors this for kicks, so removing someone from a parent also removes them from its sub-docs — otherwise it would silently leave them with access. Both fan-outs use `Promise.allSettled` and surface a warning if any individual sub-doc invite/kick fails, rather than failing the whole action.
2. **At creation time** — `createDoc` (`src/stores/docs.store.ts`), after the new sub-doc's room exists, looks up the parent doc's room and invites everyone who's currently a member (join or invite) of it. This covers documents created *after* a share, which the share-time fan-out above can't reach since it only runs once, at share time.

**Known fragility:** There is no single source of truth for "who has access to this doc tree" — it's the union of whatever fan-outs have run correctly since the tree was created. A sub-doc moved to a different parent after creation does not retroactively adjust its membership. See LIMIT-17 in [limitations.md](limitations.md).

### Retry on room-creation rate limits

`createRoomWithRetry` (`src/matrix/docs-matrix.ts`) wraps `client.createRoom` in a loop that calls `calculateRetryBackoff` (a `matrix-js-sdk` helper) on failure: it reads the server's recommended `retry_after_ms` for `M_LIMIT_EXCEEDED` errors and returns `-1` for anything else, which is rethrown immediately without retrying. Without this, creating several documents in quick succession (a root doc, then a child, then a grandchild — each its own room) surfaces to the user as the new doc briefly appearing as "Untitled" in the tree and then vanishing, since `createDoc`'s `.catch()` drops the optimistic entry on any room-creation failure.

### Docs Event Type Registry

| Event | Room | Purpose | Encrypted |
|---|---|---|---|
| `org.demo-e2e-app.doc.yjs.update` | Doc room | Incremental Yjs CRDT update (base64, possibly chunked) | Yes (Megolm) |
| `org.demo-e2e-app.doc.yjs.snapshot` | Doc room | Full merged Yjs state, sent every 20 updates and on new-member join | Yes (Megolm) |
| `org.demo-e2e-app.doc.meta` (state event) | Doc room | `{ title, parentDocId, docId }` — lets collaborators derive title/hierarchy without the owner's private index | No (Matrix state events cannot be encrypted) |
| `m.room.message` (`doc_comment: true`) | Doc room | Comment text | Yes (Megolm) |
| `org.demo-e2e-app.docs_index` | `account_data` | Owner's private hierarchy index (`DocIndexEntry[]`) | No |

---

## State Management

Three Zustand stores manage all runtime state:

| Store file | State held | Key actions |
|---|---|---|
| `src/stores/auth.store.ts` | `client`, `userId`, `deviceId`, `loginState` | `setClient`, `setLoginState`, `clearAuth` |
| `src/stores/entity.store.ts` | `entities`, `comments`, `files`, `indices`, `roomToEntity` | `hydrateFromMatrix`, `refreshEntity`, `refreshComments`, `refreshFiles`, `upsertEntity`, `removeEntity` |
| `src/stores/sync.store.ts` | `syncState`, `isReady` | `setSyncState`, `setReady`, `reset` |

### `entity.store.ts` shape

```typescript
{
  entities:    Record<type, Record<id, unknown>>   // all entity data
  comments:    Record<type, Record<id, Comment[]>>
  files:       Record<type, Record<id, EntityFile[]>>
  indices:     Record<type, IndexEntry[]>          // account_data index entries
  roomToEntity: Record<roomId, { type: string; id: string }>  // O(1) dispatch map
}
```

### `roomToEntity` lookup map

`roomToEntity: Record<string, { type: string; id: string }>` is a flat map from any room ID (data or comments) to its entity type key and entity ID. This enables O(1) dispatch inside the sync listeners: when a timeline event arrives in a room, the listener does a single map lookup to find which entity to refresh.

The map is rebuilt from scratch on every call to `hydrateFromMatrix`.

### Zustand selector stability

Selectors must return stable references to avoid Zustand's snapshot comparison triggering infinite re-render loops. Immer-managed nested objects return the same reference when unchanged, so selectors should return raw Immer refs without `?? {}` / `?? []` fallbacks inside the selector. Fallbacks belong in the component body after the hook call.

### `hydrateFromMatrix` lifecycle

`hydrateFromMatrix` is called:
1. When the sync reaches `PREPARED` or `SYNCING` (via `markReady` → `scheduleHydrate` in `src/matrix/sync.ts:20`).
2. On every subsequent `SYNCING` event (ensuring recovery after decryption delays).
3. When a new `account_data` event matching any entity type's index key arrives.
4. When the current user receives a room invite.
5. When an `onDecrypted` event fires before `roomToEntity` is populated (race condition guard).

All calls are debounced with a 400 ms timer (`src/matrix/sync.ts:12`).

---

## Sync Architecture

`attachSyncListeners` (`src/matrix/sync.ts:28`) registers five listeners on the Matrix client and returns a cleanup function:

| Listener | SDK event | What it does |
|---|---|---|
| `onSync` | `ClientEvent.Sync` | Updates `syncState`; calls `markReady` (→ `scheduleHydrate`) on `PREPARED`/`SYNCING` |
| `onTimeline` | `RoomEvent.Timeline` | Looks up `roomToEntity[roomId]` → dispatches `refreshEntity`, `refreshComments`, or `refreshFiles` based on event type; event type strings built from `config.eventTypePrefix` |
| `onDecrypted` | `MatrixEventEvent.Decrypted` | Same as `onTimeline` but fires after async decryption completes; schedules hydrate if room not yet in `roomToEntity` |
| `onAccountData` | `ClientEvent.AccountData` | Schedules `hydrateFromMatrix` when any entity index `account_data` event changes |
| `onMembership` | `RoomMemberEvent.Membership` | Handles kick/ban (remove from store + index for all entity types), self-invite (schedule hydrate), other-user join (re-send entity snapshot) |

### Debounce strategy

`scheduleHydrate` uses a single shared 400 ms `setTimeout`. Every call resets the timer, so bursts of sync events (e.g. initial sync with many rooms) result in a single hydration pass.

### Re-send on member join

When a new member joins a data room, the `onMembership` handler iterates all entity indices to find which entity owns that room. It then waits 2 seconds and calls `sendEntityUpdate` with the current entity snapshot (`src/matrix/sync.ts:166`). This is necessary because the new member cannot decrypt historical Megolm ciphertexts — they were encrypted before the new member's device was added to the session. The fresh event is encrypted with a new Megolm session that includes the new device.

Debounced per `roomId:userId` pair to avoid bursts.

---

## Crypto Layer

### WASM pre-warm

`src/matrix/client.ts:8` — at module load time, before any user action, the module fires:

```typescript
import("@matrix-org/matrix-sdk-crypto-wasm").then((m) => m.initAsync().catch(() => {}));
```

This starts the WASM download and compilation in parallel with the login form rendering, so `initRustCrypto` completes faster after the user submits credentials.

### IndexedDB store naming

`src/matrix/client.ts:159` — each device gets its own IndexedDB store:

```typescript
const storeName = `${userId}:${deviceId}`;
await client.initRustCrypto({ storeName });
```

Without per-device naming, a second login (which gets a new `deviceId`) would conflict with the store written for the previous device, causing "account in the store doesn't match" errors. The code detects this error and deletes stale stores before retrying.

### `cryptoCallbacks.getSecretStorageKey`

`src/matrix/client.ts:150` — the `getSecretStorageKey` callback is registered when the client is created. The SDK calls it whenever it needs to access secret storage (key backup restore, cross-signing key retrieval). The implementation reads the recovery key from `sessionStorage["matrix_recovery_key"]` (where it was stored by `bootstrapSecretStorage`) and returns it as a `Uint8Array`.

Without this callback, `bootstrapSecretStorage` throws "No getSecretStorageKey callback supplied" on accounts that already have secret storage configured.

### `bootstrapCrypto` flow

Runs fire-and-forget after `startMatrixClient` resolves. Errors are `console.warn`-suppressed — they do not abort the login flow.

1. `crypto.isSecretStorageReady()` — if already set up (e.g., existing account with Element), skip creation.
2. `crypto.bootstrapSecretStorage({ createSecretStorageKey })` — creates a new recovery key, encodes it as base64, stores in `sessionStorage`.
3. `crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys })` — reads the login password from `sessionStorage["matrix_login_password"]` for UIA. Errors suppressed. See BUG-03 in [limitations.md](limitations.md).

A per-session guard key (`matrix_crypto_bootstrapped:${userId}:${deviceId}`) in `sessionStorage` prevents re-running bootstrap within the same tab session.

---

## Sharing Flow

1. User opens the Share modal and enters a Matrix user ID (`@alice:matrix.org`).
2. `useShareContact.shareWith()` (`src/hooks/useShareContact.ts`) calls `client.invite()` on both the data room and comments room in parallel.
3. On the invitee's side, the next `SYNCING` event triggers `hydrateFromMatrix`.
4. `hydrateFromMatrix` (`src/stores/entity.store.ts`) finds rooms with `invite` membership and an `APP_PREFIX` name, auto-joins them.
5. It then calls each entity config's `matchRoomName()` to identify entity type and whether the room is a data or comments room.
6. Data + comments rooms are paired into `IndexEntry` objects written into both the in-memory store and `account_data` index.
7. On the owner's side, `onMembership` detects the new join and fires the re-send logic so the invitee can decrypt the entity immediately.

**Known fragility:** There is no real-time listener for incoming invites during an active session. Sharing is only detected on the next `SYNCING` poll (~30 s) or on a tab reload. See LIMIT-07 in [limitations.md](limitations.md).
