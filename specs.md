# matrix CMS application prototype

A web frontend for a contacts CRM that uses the Matrix protocol as a fully end-to-end-encrypted backend. No application server. All persistence is in Matrix rooms and `account_data` on a homeserver.

## Authentication

- Login with Matrix username/password (`m.login.password`)
- Register a new Matrix account (two-step UIA with `m.login.dummy`)
- Session persisted in `sessionStorage` and restored automatically on page reload
- Logout invalidates the current device's access token

## Models

Every model has a Zod validation schema in `src/schemas/`.

### Contact

Fields: `id` (UUID), `fullname`, `email`, `gender` (male/female/other/prefer_not_to_say), `birthdate` (ISO date, optional), `preferred_color` (CSS hex, optional), `avatarMxcUri` (mxc:// URI, optional), `createdAt`, `createdBy`, `updatedAt`.

Each contact instance maps to two dedicated Matrix rooms (see Channels below).

### Comment

Fields: `id` (Matrix event ID), `contactId`, `authorId` (Matrix userId), `body`, `createdAt`.

### File attachment

Fields: `id` (Matrix event ID), `contactId`, `authorId`, `filename`, `mxcUri`, `mimetype`, `size`, `createdAt`.

## Channels

Naming convention: `demo-e2e-app/channels/<contactId>`

- **Data room** — `demo-e2e-app/channels/<contactId>` — stores contact snapshots and file metadata events
- **Comments room** — `demo-e2e-app/channels/<contactId>-comments` — stores comment events

Both rooms use `m.megolm.v1.aes-sha2` encryption.

### Event types

| Event type | Room | Purpose |
|---|---|---|
| `org.demo-e2e-app.contact.update` | Data room | Full contact snapshot (latest wins) |
| `org.demo-e2e-app.contact.file` | Data room | File attachment metadata (mxc URI + filename/size/mimetype) |
| `m.room.message` (msgtype `m.text`) | Comments room | Comment text |

## Indexing

Each user stores an index of all their contacts in Matrix `account_data` under the event type `org.demo-e2e-app.contact_index`. The index maps `contactId → { dataRoomId, commentsRoomId, displayName, addedAt }`. It syncs automatically across all of the user's devices and survives browser storage clears. The index is not E2E encrypted (visible to the homeserver operator).

## Sharing

- Any user can invite another Matrix user (`@user:server`) to both rooms of a contact.
- The invitee auto-joins on the next sync cycle and the contact appears in their list automatically.
- The owner re-sends the latest contact snapshot when the new member joins, so the invitee can decrypt it immediately.
- Both parties can edit the contact and leave comments in real time.

## UI

- **List/detail layout** — scrollable contact list on the left, detail/form panel on the right
- **Create contact** — form with full-name, email, gender, birthdate, preferred color, avatar upload
- **Edit contact** — same form pre-filled; saves a new snapshot event
- **Comments feed** — chronological list, new comment input at bottom
- **File attachments** — drag-and-drop or click-to-browse upload; download via authenticated media endpoint
- **Share dialog** — enter a Matrix user ID to invite to both rooms
- **Device verification** — incoming SAS (emoji) verification requests handled via a fixed overlay banner
- **Export** — download all contacts, comments, and file metadata as JSON

## E2E Encryption

- All contact data, comments, and file metadata are encrypted with Megolm (`m.megolm.v1.aes-sha2`).
- Crypto is handled by the Rust/WASM backend (`@matrix-org/matrix-sdk-crypto-wasm`), initialised via `initRustCrypto`.
- Secret storage and cross-signing are bootstrapped automatically on first login.
- File bytes are uploaded to the homeserver media repository without client-side encryption (known limitation).
