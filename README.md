# Matrix CMS Prototype

A greenfield React + TypeScript SPA that uses the **Matrix protocol** as a fully end-to-end-encrypted backend for a contacts CRM. Contacts, edits, per-contact comment feeds, and file attachments are stored in encrypted Matrix rooms. Real-time sync and sharing between Matrix users is built-in.

**No backend server.** Vite builds static files. All server concerns are handled by the Matrix homeserver (defaults to `matrix.org`).

---

## Tech Stack

| Concern | Library |
|---|---|
| Framework | React 18 + TypeScript (Vite 8) |
| Matrix SDK | matrix-js-sdk (Rust/WASM crypto via `@matrix-org/matrix-sdk-crypto-wasm`) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) |
| State | Zustand + Immer |
| Routing | React Router v6 |
| Forms | React Hook Form + Zod |
| Table | TanStack Table v8 |

---

## Architecture

```
Login → createMatrixClient → initRustCrypto → bootstrapSecretStorage
      → bootstrapCrossSigning → startClient → attachSyncListeners
                                                     ↓
                                          Zustand stores hydrated
                                          from Matrix account_data index
                                          + room timelines
```

### Data model

- Each contact gets **two encrypted Matrix rooms**: a `data` room and a `comments` room.
- Contact data is written as **full snapshots** in regular timeline events (`org.demo-e2e-app.contact.update`). The most recent event is the current state. This is required because Matrix state events cannot be E2E encrypted.
- Comments are regular timeline events (`org.demo-e2e-app.contact.comment`) in the comments room.
- File attachments are stored as timeline events (`org.demo-e2e-app.contact.file`) in the **data room**. Each event records the filename, MIME type, size, and an `mxc://` URI pointing to the uploaded bytes on the homeserver media repository. The event content is Megolm-encrypted; the raw file bytes are uploaded unencrypted (acceptable for this prototype).
- The **contact index** is stored in `account_data` (`org.demo-e2e-app.contact_index`) — syncs across devices automatically. Not E2E encrypted (stores only room IDs and display names, not sensitive contact data).

### Directory layout

```
src/
├── lib/          constants.ts, utils.ts
├── schemas/      contact, comment, file, index (Zod)
├── matrix/       client, auth, rooms, events, index-room, sync
├── stores/       auth, contacts, sync (Zustand)
├── hooks/        useMatrixClient, useContactSync, useShareContact
├── components/   layout/ (AppLayout, ContactsLayout, Sidebar, Header), contacts/ (incl. ContactsList, FileDropZone), comments/
└── pages/        LoginPage, ContactsPage, NewContactPage, ContactDetailPage
```

---

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` and log in with a **matrix.org account** (or any Matrix account — change `HOMESERVER_URL` in `src/lib/constants.ts`).

### Build

```bash
npm run build
```

Output is in `dist/` — deploy to any static host (Netlify, GitHub Pages, Cloudflare Pages, etc.).

---

## Features

- Login with Matrix username/password
- List/detail layout — persistent contact list on the left, detail panel on the right; selecting a contact navigates without leaving the list
- Create contact — auto-creates two encrypted rooms, writes first snapshot event
- Edit contact — sends a new full snapshot event (history preserved in room timeline)
- Comments feed — real-time via Matrix timeline events, auto-scrolls to bottom
- Documents — drag-and-drop (or click-to-browse) file uploads per contact; files are uploaded to the Matrix media repo and metadata stored as encrypted timeline events in the data room; clickable download links restored from room timeline on reload
- Share contact — invite another Matrix user to both rooms; invitee auto-joins on next sync and sees the full file list
- Real-time sync — open two tabs, changes propagate via Matrix sync loop
- E2E encryption — all contact data and comments encrypted via Megolm

---

## TODO

Missing pieces needed before real-world use:

- [ ] **Key backup restore** — a new recovery key is generated on every login and stored in `sessionStorage`. Returning users on a new device cannot decrypt older messages until `crypto.restoreKeyBackupWithRecoveryKey()` is implemented with a UI to enter their recovery key.
- [ ] **Session persistence / re-bootstrapping guard** — on page reload, `initRustCrypto` may open a fresh IndexedDB store on a new device or after clearing storage, making historical messages unreadable. Needs a proper "existing device" check that skips re-bootstrapping when the crypto store already exists.
- [ ] **Invitee auto-join room pairing** — `hydrateFromMatrix` auto-joins rooms matching the app name prefix but does not robustly pair `data` + `comments` rooms into a combined index entry on the invitee side. Needs matching by name suffix (`-comments`) to build a complete `IndexEntry`.
- [ ] **`RoomEvent.MyMembership` listener for live invites** — auto-joining invites is only triggered during `hydrateFromMatrix` (sync PREPARED). A dedicated `RoomEvent.MyMembership` listener in `attachSyncListeners` is needed so invites received during an active session are joined immediately.
- [ ] **Timeline pagination / backfill** — only the live timeline (last 20 events via `initialSyncLimit`) is read. Contacts in rooms with many events may not surface the latest snapshot. Implement `client.scrollback()` or a dedicated fetch to ensure the most recent `contact.update` event is found.
- [ ] **Contact deletion** — no delete flow. Needs: remove entry from index (`saveContactIndex`), leave/forget both rooms (`client.leave()` + `client.forget()`), and remove from Zustand store.
- [ ] **Loading state interstitial** — `AppLayout` redirects to `/login` while `loginState === "idle"` (session still loading). Replace with a loading spinner so the page doesn't flash to login on refresh.
- [ ] **Error boundaries** — zero React error boundaries. A crypto failure or network error will silently crash the component tree. Add at least a top-level `<ErrorBoundary>`.
- [ ] **Cross-signing verification UX** — cross-signing is bootstrapped silently. Users should be prompted to verify new devices to maintain end-to-end trust chains.
- [ ] **Unit / integration tests** — zero test coverage.
- [ ] **Logout from all devices** — the current `logout(true)` call logs out only the current device. Add an explicit "log out all devices" option calling `client.logout()` with appropriate flags.
- [ ] **Code splitting** — the main JS bundle is ~1.35 MB (391 KB gzipped) and the WASM blob is 5.5 MB. Add dynamic `import()` for pages and lazy-load crypto initialization.

---

## WARNING

**Read before deploying or storing real data.**

- **matrix.org rate limits** — `matrix.org` enforces strict rate limits on room creation and message sending. Creating many contacts quickly will trigger `M_LIMIT_EXCEEDED` errors. For development, use a self-hosted Synapse instance.

- **Recovery key is ephemeral** — the Rust crypto bootstrap generates a new secret storage key on every login and stores it only in `sessionStorage`. If the tab is closed or the session ends, the key is gone. Encrypted messages from previous sessions may become permanently unreadable without a proper key backup restore flow.

- **`account_data` is server-visible** — the contact index is stored in Matrix `account_data`, which is visible to the homeserver operator. Do not store sensitive contact fields (email, phone, address) in the index. Contact data itself is in encrypted room events and is not server-readable.

- **Full snapshot growth** — every contact edit appends a new full-snapshot event to the room timeline. In rooms with many edits, the timeline grows linearly. There is no event pruning, compaction, or archiving.

- **WASM bundle size** — the `@matrix-org/matrix-sdk-crypto-wasm` WASM blob is ~5.5 MB (1.9 MB gzipped). This is unavoidable with the Rust crypto backend. Serve with long-lived cache headers and consider a CDN.

- **`localStorage` token storage** — Matrix access tokens are stored in `localStorage`, accessible to any JS on the same origin. Do not co-host this app with untrusted third-party scripts.

- **File uploads are not E2E encrypted** — `client.uploadContent()` sends raw bytes to the homeserver media repository without client-side encryption. The file metadata (filename, size, `mxc://` URI) is stored in an encrypted room event, but the file content itself is accessible to the homeserver operator via the media API. Use Matrix's encrypted attachment spec (`EncryptedFile` content) if confidentiality of file bytes is required.

- **`vite-plugin-top-level-await` not used** — the original plan included this plugin, but it is incompatible with Vite 8 (peer-requires a CJS-accessible `rollup`/`esbuild`, which Vite 8 no longer exposes this way). Vite 8 with `build.target: "esnext"` handles top-level await natively; the plugin is not needed.

- **`bootstrapCrossSigning` may fail silently on matrix.org** — if the server requires UIA (interactive auth) for uploading device signing keys and the 401 flow is not fully handled, cross-signing will not be established. The prototype suppresses this error. Encrypted messages will still work (Megolm), but device verification will not.

- **StrictMode double-invocation** — React StrictMode (enabled in `main.tsx`) invokes effects twice in development. The `attachSyncListeners` call in `App.tsx`'s `SessionLoader` may attach duplicate listeners during HMR. This is harmless in production but can cause duplicate store updates in dev.
