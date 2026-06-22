# Security

> **Prototype disclaimer.** This codebase is explicitly not production-ready. It was built to validate the Matrix-as-backend architecture, not to protect real user data. The issues documented here are known and intentional trade-offs for a prototype. Do not store real data or deploy publicly without addressing every item in this document.

---

## Threat Model

**In-scope (what the prototype attempts to protect against):**
- Homeserver operator reading entity data, comments, or file metadata.
- A passive network observer reading messages in transit (TLS + Megolm cover this).

**Out-of-scope (what the prototype does not protect against):**
- XSS on the same origin.
- Malicious browser extensions.
- A compromised homeserver replaying or injecting encrypted events.
- An attacker who can read the browser's storage.

---

## What Is and Is Not Encrypted

| Data | Encrypted | Mechanism | Accessible to homeserver? |
|---|---|---|---|
| Entity fields (contact, company, training data) | Yes | Megolm (E2E) | No — ciphertext only |
| Comments (message body) | Yes | Megolm (E2E) | No — ciphertext only |
| File metadata (filename, size, mimetype, mxc URI) | Yes | Megolm (E2E) in `<prefix>.file` event | No — ciphertext only |
| **File bytes** | **No** | `client.uploadContent()` sends raw bytes | **Yes — plaintext on media server** |
| Entity indices (room IDs, display names) | No | `account_data` — Matrix spec does not encrypt this | **Yes — plaintext** |
| Access token | No | Stored in `sessionStorage` under `matrix_session` key | Exposed to any JS on origin (XSS risk) |
| Recovery key | No | Stored in `sessionStorage["matrix_recovery_key"]` as base64 | Exposed to any JS on origin; lost on tab close |
| Login password | No | Stored in `sessionStorage["matrix_login_password"]` for UIA | Exposed to any JS on origin; lingers after bootstrap |

---

## Credential Storage Vulnerabilities

All credentials are stored in `sessionStorage`. This is scoped to the browser tab and cleared on close, but it is fully readable by any JavaScript running on the same origin. A single XSS vulnerability would expose all of the following simultaneously.

### Access token in `sessionStorage`

**File:** `src/matrix/auth.ts:30`

```typescript
sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
// SESSION_KEY = "matrix_session"
// session = { accessToken, userId, deviceId }
```

The access token authenticates all Matrix API calls. An attacker who reads it can impersonate the user on the homeserver indefinitely (until the token is revoked). The token is also re-read on every page load by `initializeSession()` (`src/matrix/auth.ts:110`).

**Fix:** Use `HttpOnly` cookies for the access token (requires a same-origin proxy for the Matrix API). There is no browser-native solution for SPA-based Matrix clients that prevents XSS from reading the access token; the architecture inherits this limitation from the Matrix Client-Server spec.

### Password in `sessionStorage`

**File:** `src/matrix/auth.ts:23` (login), `src/matrix/auth.ts:85` (register)

```typescript
sessionStorage.setItem("matrix_login_password", password);
```

The password is stored to supply the User-Interactive Authentication (UIA) credential inside `bootstrapCrossSigning` (`src/matrix/client.ts:116`). It is not cleared after use — it lingers for the entire session. The `logout()` function clears all `sessionStorage` (`src/matrix/auth.ts:107`), which is the only cleanup path.

**Fix:** Clear `"matrix_login_password"` immediately after `bootstrapCrossSigning` completes or fails.

### Recovery key in `sessionStorage`

**File:** `src/matrix/client.ts:103`

```typescript
sessionStorage.setItem("matrix_recovery_key", encoded); // base64 Uint8Array
```

The recovery key protects the key backup. If an attacker reads it, they can decrypt the key backup and recover all historical Megolm session keys. If the user closes the tab without the attacker reading it, the key is gone permanently — and so is the ability to decrypt older messages on new devices.

**Fix:** Prompt the user to save the recovery key to a password manager or physical backup, then clear it from `sessionStorage`.

### Homeserver URL in `localStorage`

**File:** `src/lib/constants.ts:5`

```typescript
return localStorage.getItem(HOMESERVER_STORAGE_KEY) ?? DEFAULT_HOMESERVER;
```

The homeserver URL is stored in `localStorage` without validation. A malicious script or URL manipulation could redirect API calls to an attacker-controlled homeserver that harvests credentials.

**Fix:** Validate the URL on write (HTTPS required, known-good domain allowlist or user confirmation).

---

## Cross-Signing and Device Verification

Cross-signing is bootstrapped silently in `bootstrapCrypto` (`src/matrix/client.ts:85`). Errors are suppressed with `console.warn`:

```typescript
} catch (err) {
  console.warn("[matrix] bootstrapCrossSigning failed (non-fatal):", err);
}
```

**There is no outgoing verification UI.** Users cannot initiate a verification of another user's device from within this application. The `VerificationBanner` (`src/components/verification/VerificationBanner.tsx`) only handles *incoming* SAS verification requests — it shows the emoji comparison and accept/decline buttons when another device initiates verification toward this device.

**Consequence:** Even if both parties use this app, there is no way to establish mutual trust via device verification. Megolm encryption still works (messages are encrypted to known device keys), but there is no protection against an unverified device being added to the session by a malicious homeserver operator.

See BUG-03 in [limitations.md](limitations.md) for the silent failure on matrix.org.

---

## File Upload Security

**File:** `src/matrix/entity-events.ts:94` — `sendEntityFile()`

```typescript
const { content_uri: mxcUri } = await client.uploadContent(file);
await (client as any).sendEvent(dataRoomId, fileEventType, {
  entity_id: entityId,
  filename: file.name,
  mxc_uri: mxcUri,
  mimetype: file.type || "application/octet-stream",
  size: file.size,
});
```

`client.uploadContent()` sends the raw file bytes to the homeserver media repository (`/_matrix/media/v3/upload`) without client-side encryption. The homeserver stores the file in plaintext and serves it via the media API to any client that knows the `mxc://` URI.

The `<prefix>.file` event that records the URI is Megolm-encrypted (only room members can read the URI), but once the URI is known, the file bytes are accessible to the homeserver operator and to any Matrix client that has the URI.

**Fix:** Use the Matrix encrypted attachment spec: encrypt the file bytes client-side with AES-CTR, upload the ciphertext, and store the decryption key inside the encrypted event content as an `EncryptedFile` object. This is what Element and other production Matrix clients do.

---

## React StrictMode and Duplicate Listeners

React StrictMode (enabled in `main.tsx`) double-invokes effects in development. `attachSyncListeners` is called once per effect execution, so in dev mode it may register duplicate listeners on the Matrix client during HMR cycles.

The cleanup function returned by `attachSyncListeners` removes all registered listeners, so this is harmless in production. In development, it can cause duplicate store updates (an entity update triggers two refresh calls for the same room).

See BUG-02 in [limitations.md](limitations.md).

---

## Error Boundaries and Silent Failures

There are zero React error boundaries in the codebase. Errors thrown during rendering (e.g. a decryption failure that propagates into the UI, a null dereference in a component that expects an entity to exist) will crash the entire component tree without any user-visible message.

Additionally, several decryption failures are silently dropped:

- `extractLatestEntity` (`src/matrix/entity-events.ts:25`) skips events where `event.isDecryptionFailure()` is true — no error is surfaced.
- `extractComments` (`src/matrix/entity-events.ts:64`) does the same.
- `extractFiles` (`src/matrix/entity-events.ts:113`) does the same.

A user who cannot decrypt messages receives empty entity data, empty comments, and an empty file list — with no indication that decryption failed.
