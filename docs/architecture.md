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
| `<prefix>.file` | `org.demo-e2e-app.contact.file` | Data room | File attachment metadata | Yes (Megolm) — metadata only; file bytes are unencrypted |
| `m.room.message` | `m.room.message` | Comments room | Comment text | Yes (Megolm) |
| `<prefix>_index` | `org.demo-e2e-app.contact_index` | `account_data` | Entity index (room IDs, display names) | No |

All custom event types are sent using `(client as any).sendEvent(...)` to bypass Matrix SDK v41's strict `TimelineEvents` union type constraint. See `src/matrix/entity-events.ts`.

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
