# Limitations

Trackable list of known bugs and missing features. Items are tagged BUG-xx (code defects) or LIMIT-xx (missing functionality or scaling constraints). Cross-references to source files are line-level where possible.

---

## Known Bugs

### BUG-01 — `EVENT_TYPE_COMMENT` undefined in `onDecrypted`, async-decrypted comments silently dropped

**File:** `src/matrix/sync.ts:90`

```typescript
if (type === EVENT_TYPE_COMMENT) {
  // ← ReferenceError at runtime
  const contactId = roomToContact[roomId];
  if (contactId) refreshComments(client, roomId);
}
```

`EVENT_TYPE_COMMENT` is used in the `onDecrypted` handler but is never imported and does not exist in `src/lib/constants.ts`. The constant file defines `EVENT_TYPE_CONTACT_UPDATE` and `EVENT_TYPE_CONTACT_FILE` but has no comment-related constant.

**Effect:** Comments that arrive still-encrypted (e.g. when the Megolm session key is fetched after the event) and later decrypt via `MatrixEventEvent.Decrypted` are silently ignored. The `onTimeline` handler catches `m.room.message` synchronously, so comments that arrive pre-decrypted work correctly — only async-decrypted comments are affected.

**Fix:** Either add `export const EVENT_TYPE_COMMENT = "m.room.message"` to `src/lib/constants.ts` and import it, or replace the `if (type === EVENT_TYPE_COMMENT)` check with `if (type === "m.room.message")` inline.

---

### BUG-02 — React StrictMode double-attachment of sync listeners (dev only)

**File:** `src/App.tsx:16` — `SessionLoader` effect

React StrictMode double-invokes effects in development. `useContactSync` (called from `AppLayout`, `src/components/layout/AppLayout.tsx:10`) attaches sync listeners via `attachSyncListeners`. In dev mode this can attach two sets of listeners before the first cleanup runs, causing duplicate store updates per event.

**Effect:** Dev-only. Each contact update or timeline event triggers two refresh calls. No data corruption; cosmetic double-render only.

**Fix:** Ensure the `useContactSync` hook's `useEffect` cleanup function is always returned and that the Matrix client emitter is not left in a dirty state across StrictMode double-invocations.

---

### BUG-03 — `bootstrapCrossSigning` fails silently on matrix.org

**File:** `src/matrix/client.ts:124`

```typescript
} catch (err) {
  console.warn("[matrix] bootstrapCrossSigning failed (non-fatal):", err);
}
```

On matrix.org, uploading device signing keys requires UIA. The UIA flow uses the login password from `sessionStorage["matrix_login_password"]`. If the password is wrong, missing, or if matrix.org requires a more complex UIA flow (e.g. reCAPTCHA), `bootstrapCrossSigning` silently fails and cross-signing is never established.

**Effect:** Encrypted messages still work (Megolm is unaffected). But device verification is not possible and the user's device is not cross-signed, which means other clients (Element, etc.) will show the device as unverified.

**Fix:** Surface cross-signing failure to the user and provide a retry flow with explicit UIA handling.

---

## Missing — Auth & Sessions

### LIMIT-01 — Key backup restore not implemented

On first login, `bootstrapSecretStorage` generates a new recovery key stored only in `sessionStorage`. When the user opens the app on a new device (or after clearing storage), historical Megolm session keys are locked in the key backup and cannot be recovered because `crypto.restoreKeyBackupWithRecoveryKey()` is never called.

**Effect:** All messages from previous sessions are undecryptable on new devices. The user sees empty contacts and empty comments.

**Fix:** Add a key backup restore UI that prompts for the recovery key when `isSecretStorageReady()` returns true but local crypto keys are absent.

---

### LIMIT-03 — Logout only invalidates current device

**File:** `src/matrix/auth.ts:100`

```typescript
await client.logout(true);
```

`client.logout(true)` invalidates only the current device's access token. Other active sessions remain authenticated. There is no "log out all devices" option.

**Fix:** Add a separate "Log out all devices" action that calls the appropriate Matrix logout endpoint with all-devices scope.

---

## Missing — Contacts

### LIMIT-04 — No contact deletion UI

There is no delete button or flow in the UI. Deleting a contact requires:

1. Removing its entry from the `account_data` index (`removeContactFromIndex`, `src/matrix/index-room.ts:42`).
2. Calling `client.leave()` + `client.forget()` on both rooms.
3. Removing the contact from the Zustand store (`removeContact`, `src/stores/contacts.store.ts:175`).

Steps 2 and 3 are not wired to any UI action (though `removeContact` in the store and `removeContactFromIndex` in `index-room.ts` are implemented and used by the kick/ban membership handler).

---

### LIMIT-05 — No search or filter

The contact list (`src/components/contacts/ContactsList.tsx`) renders all contacts with no search input, filter, or sort controls.

---

### LIMIT-06 — No bulk operations, tags, or export (partial)

There is a JSON export button in `ContactsLayout` (`src/components/layout/ContactsLayout.tsx:12`) that calls `exportContactsJson`. However, there are no tags, labels, group operations, or CSV export.

---

## Missing — Real-Time Sync

### LIMIT-07 — Invitee auto-join pairing fragile; no live invite listener

**File:** `src/stores/contacts.store.ts:68` (auto-join) and `src/matrix/sync.ts:35` (listener set)

Two problems:

1. **Fragile pairing:** `hydrateFromMatrix` pairs data + comments rooms by the `-comments` suffix in the room name. If the room name is ever malformed or the invitee joins rooms in a session before both rooms exist, pairing fails silently.

2. **No live invite listener:** Invites received while a session is active are only detected on the next `SYNCING` poll (approximately every 30 seconds). The `onMembership` handler does schedule `hydrateFromMatrix` when the **current user** receives an invite (`src/matrix/sync.ts:148`), but this relies on `RoomMemberEvent.Membership` firing for the current user — which requires the event to arrive in a sync response first. There is no push path.

**Fix for 1:** Add a check that both rooms exist before writing the `IndexEntry`. **Fix for 2:** The existing `onMembership` handler does trigger `scheduleHydrate` on self-invite, so live detection works if the membership event arrives in the current sync response. Ensure this path is tested.

---

### LIMIT-08 — Timeline pagination missing (only 20 events per room)

**File:** `src/matrix/client.ts:185`

```typescript
await client.startClient({ initialSyncLimit: 20 });
```

Initial sync fetches only the last 20 events per room. A contact with many edits may not have its latest `contact.update` event in the first 20. `extractLatestContact` would then return an older snapshot or null.

**Fix:** Call `client.scrollback(room)` for data rooms during hydration to fetch more timeline events until a `contact.update` event is found.

---

## Performance & Build

### LIMIT-09 — No code splitting; large initial bundle

The main JS bundle is approximately 1.35 MB (391 KB gzipped). The `@matrix-org/matrix-sdk-crypto-wasm` WASM blob is 5.5 MB (1.9 MB gzipped). There is no dynamic `import()` for routes or lazy-loading of crypto initialization. All code loads on every page visit regardless of whether the user is authenticated.

**Fix:** Use React lazy + Suspense for route-level code splitting. Lazy-load the Matrix SDK and WASM blob behind the auth check.

---

### LIMIT-10 — Rate limiting on matrix.org

matrix.org enforces strict rate limits on room creation (`M_LIMIT_EXCEEDED`). Creating multiple contacts in quick succession will fail after the first few. A 500 ms delay between room creation calls exists in `src/matrix/rooms.ts:32` but does not help when the user creates multiple contacts rapidly.

**Fix:** Use a self-hosted Synapse instance for development and production. Add retry logic with exponential backoff for `M_LIMIT_EXCEEDED` errors.

---

### LIMIT-11 — Full-snapshot event growth without compaction

Every contact edit appends a new full-snapshot `contact.update` event to the room timeline. There is no pruning, compaction, or redaction of old snapshots. A contact with 1000 edits has 1000 events in its data room, all of which are fetched on initial sync (up to the `initialSyncLimit`).

**Fix:** Implement event redaction for superseded snapshots, or store contact data as a Matrix state event on a non-sensitive field (see ADR-1 in [architecture.md](architecture.md) for why this is not straightforward).

---

## Quality

### LIMIT-12 — Zero test coverage

There are no unit tests, integration tests, or end-to-end tests in the repository.

---

### LIMIT-13 — Zero error boundaries

No React `<ErrorBoundary>` components exist anywhere in the tree. See [security.md](security.md) — Silent Failures for detail.

---
