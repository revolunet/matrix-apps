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
│  │  Components  │ ◄──────────────── contacts.store.ts   │
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
attachSyncListeners()                src/matrix/sync.ts:35
  Registers 5 Matrix SDK event listeners.
  If PREPARED/SYNCING already reached: calls markReady() immediately.
        │
        ▼
hydrateFromMatrix()   [debounced]    src/stores/contacts.store.ts:40
  Reads account_data index → filters stale rooms → rebuilds roomToContact map
  Auto-joins pending invites → pairs data+comments rooms for shared contacts
  Calls refreshContact / refreshComments / refreshFiles for each entry
```

On page reload, `initializeSession()` (`src/matrix/auth.ts:110`) reads the stored session from `sessionStorage` and runs the same chain from `createMatrixClient` onward, bypassing the login form.

---

## Architecture Decision Records

### ADR-1: Full-snapshot events instead of state events

**Decision:** Contact data is stored as regular Megolm-encrypted timeline events of type `org.demo-e2e-app.contact.update`. Every edit appends a new full snapshot. The reader (`extractLatestContact`) scans from the newest event backward and returns the first successfully decrypted snapshot.

**Why not Matrix state events?** Matrix state events (`m.room.member`, `m.room.name`, etc.) cannot be E2E encrypted. A state event's `content` is transmitted in plaintext between homeserver and clients. Using state events for contact data would expose all fields to the homeserver operator.

**Trade-off:** The room timeline grows linearly with edits. There is no compaction. See LIMIT-11 in [limitations.md](limitations.md).

**Code reference:** `src/matrix/events.ts:35` — `extractLatestContact()` iterates `room.getLiveTimeline().getEvents()` in reverse, skipping events that are still being decrypted or have failed decryption.

---

### ADR-2: Two rooms per contact (data room + comments room)

**Decision:** Each contact gets two separate Matrix rooms created in `src/matrix/rooms.ts:27` (`createContactRooms`):

- **Data room** — stores `contact.update` events and `contact.file` events.
- **Comments room** — stores `m.room.message` events (plain text comments).

**Why two rooms?** Room membership is per-room. Using two rooms allows fine-grained sharing: the contact owner can later grant read-only access to the data room while keeping comments private (or vice versa). With a single room, every invitee would see everything.

**Naming convention:** Room names follow the pattern defined in `src/lib/constants.ts:22`:
- Data room: `demo-e2e-app/channels/<contactId>`
- Comments room: `demo-e2e-app/channels/<contactId>-comments`

The `-comments` suffix is the pairing signal used by `hydrateFromMatrix` to match shared rooms into a single `IndexEntry`.

Both rooms use `m.megolm.v1.aes-sha2` encryption (`src/matrix/rooms.ts:17`).

---

### ADR-3: Contact index in `account_data`

**Decision:** A contact index (`org.demo-e2e-app.contact_index`) is stored in Matrix `account_data` via `client.setAccountData()` (`src/matrix/index-room.ts:24`). The index maps `contactId → { dataRoomId, commentsRoomId, displayName }`.

**Why `account_data`?**
- Syncs automatically across all of the user's devices without any extra infrastructure.
- Survives browser storage clears (unlike IndexedDB or localStorage).
- No extra Matrix room is needed.

**Trade-off:** `account_data` events are not E2E encrypted. They are visible to the homeserver operator. The index stores only room IDs and a display name — not sensitive contact fields. The actual contact data lives in encrypted room events. See the security table in [security.md](security.md).

**Schema:** `src/schemas/index.schema.ts` — `IndexEntrySchema` (contactId, dataRoomId, commentsRoomId, displayName, addedAt).

---

## Event Type Registry

| Event type constant | SDK event type string | Room | Content schema | Encrypted |
|---|---|---|---|---|
| `EVENT_TYPE_CONTACT_UPDATE` | `org.demo-e2e-app.contact.update` | Data room | `ContactSchema` (`src/schemas/contact.schema.ts`) | Yes (Megolm) |
| `EVENT_TYPE_CONTACT_FILE` | `org.demo-e2e-app.contact.file` | Data room | `ContactFileSchema` (`src/schemas/file.schema.ts`) | Yes (Megolm) — metadata only; file bytes are unencrypted |
| *(no constant)* | `m.room.message` (msgtype `m.text`) | Comments room | `CommentSchema` (`src/schemas/comment.schema.ts`) | Yes (Megolm) |
| `INDEX_EVENT_TYPE` | `org.demo-e2e-app.contact_index` | `account_data` | `ContactIndexSchema` (`src/schemas/index.schema.ts`) | No |

Constants are defined in `src/lib/constants.ts:19`. Note that `EVENT_TYPE_COMMENT` is **absent** from constants — see BUG-01 in [limitations.md](limitations.md).

---

## State Management

Three Zustand stores manage all runtime state:

| Store file | State held | Key actions |
|---|---|---|
| `src/stores/auth.store.ts` | `client`, `userId`, `deviceId`, `loginState` | `setClient`, `setLoginState`, `clearAuth` |
| `src/stores/contacts.store.ts` | `contacts`, `comments`, `files`, `indexEntries`, `roomToContact` | `hydrateFromMatrix`, `refreshContact`, `refreshComments`, `refreshFiles`, `upsertContact`, `removeContact` |
| `src/stores/sync.store.ts` | `syncState`, `isReady` | `setSyncState`, `setReady`, `reset` |

### `roomToContact` lookup map

`src/stores/contacts.store.ts:22` declares `roomToContact: Record<string, string>` — a flat map from any room ID (data or comments) to its `contactId`. This enables O(1) dispatch inside the sync listeners: when a timeline event arrives in a room, the listener does a single map lookup to find which contact to refresh.

The map is rebuilt from scratch on every call to `hydrateFromMatrix` (`src/stores/contacts.store.ts:59`).

### `hydrateFromMatrix` lifecycle

`hydrateFromMatrix` is called:
1. When the sync reaches `PREPARED` or `SYNCING` (via `markReady` → `scheduleHydrate` in `src/matrix/sync.ts:33`).
2. On every subsequent `SYNCING` event (ensuring recovery after decryption delays).
3. When a new `account_data` event of type `INDEX_EVENT_TYPE` arrives.
4. When the current user receives a room invite.

All calls are debounced with a 400 ms timer (`src/matrix/sync.ts:15`).

---

## Sync Architecture

`attachSyncListeners` (`src/matrix/sync.ts:35`) registers five listeners on the Matrix client and returns a cleanup function:

| Listener | SDK event | What it does |
|---|---|---|
| `onSync` | `ClientEvent.Sync` | Updates `syncState`; calls `markReady` (→ `scheduleHydrate`) on `PREPARED`/`SYNCING` |
| `onTimeline` | `RoomEvent.Timeline` | Dispatches `refreshContact`, `refreshComments`, or `refreshFiles` based on event type and `roomToContact` lookup |
| `onDecrypted` | `MatrixEventEvent.Decrypted` | Same as `onTimeline` but fires after async decryption completes — handles events that arrive encrypted and decrypt later |
| `onAccountData` | `ClientEvent.AccountData` | Schedules `hydrateFromMatrix` when the index `account_data` event changes |
| `onMembership` | `RoomMemberEvent.Membership` | Handles kick/ban (remove from store), self-invite (schedule hydrate), and other-user join (re-send contact snapshot) |

### Debounce strategy

`scheduleHydrate` uses a single shared 400 ms `setTimeout`. Every call resets the timer, so bursts of sync events (e.g. initial sync with 10 rooms) result in a single hydration pass.

### Re-send on member join

When a new member joins the data room, the sender's `onMembership` handler waits 2 seconds then calls `sendContactUpdate` with the current contact snapshot (`src/matrix/sync.ts:169`). This is necessary because the new member cannot decrypt historical Megolm ciphertexts — they were encrypted before the new member's device was added to the session. The fresh event is encrypted with a new Megolm session that includes the new device.

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
3. `crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys })` — reads the login password from `sessionStorage["matrix_login_password"]` for UIA. Errors suppressed. See BUG-03 and LIMIT-02 in [limitations.md](limitations.md).

A per-session guard key (`matrix_crypto_bootstrapped:${userId}:${deviceId}`) in `sessionStorage` prevents re-running bootstrap within the same tab session.

---

## Sharing Flow

1. User opens the Share modal and enters a Matrix user ID (`@alice:matrix.org`).
2. `useShareContact.shareWith()` (`src/hooks/useShareContact.ts:11`) calls `client.invite()` on both the data room and comments room in parallel.
3. On the invitee's side, the next `SYNCING` event triggers `hydrateFromMatrix`.
4. `hydrateFromMatrix` (`src/stores/contacts.store.ts:68`) finds rooms with `invite` membership and an `APP_PREFIX` name, auto-joins them.
5. It then scans all joined rooms for the `demo-e2e-app/channels/` prefix and pairs data + comments rooms by the `-comments` suffix (`src/stores/contacts.store.ts:100`).
6. Newly discovered `IndexEntry` objects are written into both the in-memory store and `account_data` index.
7. On the owner's side, `onMembership` detects the new join and fires the re-send logic (see Sync Architecture above) so the invitee can decrypt the contact immediately.

**Known fragility:** There is no real-time listener for incoming invites during an active session. Sharing is only detected on the next `SYNCING` poll (~30 s) or on a tab reload. See LIMIT-07 in [limitations.md](limitations.md).
