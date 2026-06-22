# Matrix CMS Prototype

A greenfield React + TypeScript SPA that uses the **Matrix protocol** as a fully end-to-end-encrypted backend for a multi-entity CRM. Entity data, edits, per-entity comment feeds, and file attachments are stored in encrypted Matrix rooms. Real-time sync and sharing between Matrix users is built-in.

**No backend server.** Vite builds static files. All server concerns are handled by the Matrix homeserver (defaults to `matrix.org`).

For deeper technical detail see [`docs/`](docs/index.md) — architecture decisions, security threat model, tracked limitations, and UX/frontend reference.

---

## Tech Stack

| Concern | Library |
|---|---|
| Framework | React 19 + TypeScript (Vite 8) |
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
                                          from Matrix account_data indices
                                          + room timelines (all entity types)
```

### Entity Registry

The app uses an **entity registry pattern**. Each entity type (Contact, Company, Training, …) is defined once as a self-contained config object and registered at startup. All UI, routing, storage, and Matrix integration is driven generically from these configs — adding a new entity type requires only:

1. A Zod schema (`src/entities/<type>/schema.ts`)
2. A config registration (`src/entities/<type>/config.ts`)
3. One import line in `src/App.tsx`

### Data model

- Each entity instance gets **two encrypted Matrix rooms**: a `data` room and a `comments` room.
- Entity data is written as **full snapshots** in regular timeline events (type `<eventTypePrefix>.update`). The most recent event is the current state. This is required because Matrix state events cannot be E2E encrypted.
- Comments are regular `m.room.message` (msgtype `m.text`) timeline events in the comments room.
- File attachments are stored as timeline events (`<eventTypePrefix>.file`) in the **data room**. Each event records the filename, MIME type, size, and an `mxc://` URI pointing to the uploaded bytes on the homeserver media repository. The event content is Megolm-encrypted; the raw file bytes are uploaded unencrypted (acceptable for this prototype).
- Each entity type stores a **per-type index** in `account_data` (key `<eventTypePrefix>_index`) — syncs across devices automatically. Not E2E encrypted (stores only room IDs and display names, not sensitive entity data).

### Directory layout

```
src/
├── entities/
│   ├── types.ts          EntityConfig, FieldDefinition type definitions
│   ├── registry.ts       registerEntity(), getEntityConfig(), getAllEntityConfigs()
│   ├── contact/          schema.ts + config.ts
│   ├── company/          schema.ts + config.ts
│   └── training/         schema.ts + config.ts
├── lib/                  constants.ts, utils.ts
├── matrix/               client, auth, entity-rooms, entity-events, entity-index, sync
├── stores/               auth, entity (generic), sync (Zustand)
├── hooks/                useMatrixClient, useEntitySync, useShareContact
├── components/
│   ├── entity/           EntityForm, EntityFormField, RelationField, EntityList
│   ├── layout/           AppLayout, EntityLayout, Sidebar, Header
│   ├── contacts/         FileDropZone, ShareDialog, SharedWithList
│   ├── comments/         CommentsFeed
│   └── verification/     VerificationBanner
└── pages/                LoginPage, EntityListPage, NewEntityPage, EntityDetailPage
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
- **Multiple entity types** — Contacts, Companies, Trainings; adding more requires only a schema + config file
- List/detail layout — entity list on the left, detail panel on the right; selecting an item navigates without leaving the list
- Create entity — auto-creates two encrypted rooms, writes first snapshot event
- Edit entity — sends a new full snapshot event (history preserved in room timeline)
- **Relation fields** — many-to-many links between entity types (e.g., a Company's `contactIds` field links to Contacts); selected items are clickable links to the related entity's detail page
- Comments feed — real-time via Matrix timeline events, auto-scrolls to bottom
- Documents — drag-and-drop (or click-to-browse) file uploads per entity; files are uploaded to the Matrix media repo and metadata stored as encrypted timeline events in the data room; clickable download links restored from room timeline on reload
- Share entity — invite another Matrix user to both rooms; invitee auto-joins on next sync and sees the full file list
- Real-time sync — open two tabs, changes propagate via Matrix sync loop
- E2E encryption — all entity data and comments encrypted via Megolm

---

## TODO

Missing pieces needed before real-world use:

- [ ] **Key backup restore** — a new recovery key is generated on every login and stored in `sessionStorage`. Returning users on a new device cannot decrypt older messages until `crypto.restoreKeyBackupWithRecoveryKey()` is implemented with a UI to enter their recovery key.
- [x] **Session persistence / re-bootstrapping guard** — the bootstrap guard is now stored in `localStorage` (keyed by `userId:deviceId`) so it survives tab close. Bootstrap is skipped on all subsequent sessions for the same device and cleared on logout.
- [ ] **Invitee auto-join room pairing** — `hydrateFromMatrix` auto-joins rooms matching the app name prefix but uses per-entity `matchRoomName()` to pair data + comments rooms. Pairing may fail if rooms arrive in an unexpected order.
- [ ] **Timeline pagination / backfill** — only the live timeline (last 20 events via `initialSyncLimit`) is read. Entities in rooms with many events may not surface the latest snapshot. Implement `client.scrollback()` or a dedicated fetch to ensure the most recent update event is found.
- [ ] **Entity deletion** — no delete flow for any entity type. Needs: remove entry from index, leave/forget both rooms, remove from entity store.
- [x] **Loading state interstitial** — `loginState` is now initialised synchronously from `sessionStorage` before the first render. Users with no saved session go straight to `/login` with no spinner flash; users with a saved session see the "Connecting to Matrix..." spinner while the async restore runs.
- [ ] **Error boundaries** — zero React error boundaries. A crypto failure or network error will silently crash the component tree. Add at least a top-level `<ErrorBoundary>`.
- [ ] **Cross-signing verification UX** — cross-signing is bootstrapped silently. Users should be prompted to verify new devices to maintain end-to-end trust chains.
- [ ] **Unit / integration tests** — zero test coverage.
- [ ] **Logout from all devices** — the current `logout(true)` call logs out only the current device. Add an explicit "log out all devices" option calling `client.logout()` with appropriate flags.
- [ ] **Code splitting** — the main JS bundle is ~1.35 MB (391 KB gzipped) and the WASM blob is 5.5 MB. Add dynamic `import()` for pages and lazy-load crypto initialization.

---

## WARNING

**Read before deploying or storing real data.**

- **matrix.org rate limits** — `matrix.org` enforces strict rate limits on room creation and message sending. Creating many entities quickly will trigger `M_LIMIT_EXCEEDED` errors. For development, use a self-hosted Synapse instance.

- **Recovery key is ephemeral** — the Rust crypto bootstrap generates a new secret storage key on every login and stores it only in `sessionStorage`. If the tab is closed or the session ends, the key is gone. Encrypted messages from previous sessions may become permanently unreadable without a proper key backup restore flow.

- **`account_data` is server-visible** — the entity indices are stored in Matrix `account_data`, which is visible to the homeserver operator. Do not store sensitive entity fields in the index. Entity data itself is in encrypted room events and is not server-readable.

- **Full snapshot growth** — every entity edit appends a new full-snapshot event to the room timeline. In rooms with many edits, the timeline grows linearly. There is no event pruning, compaction, or archiving.

- **WASM bundle size** — the `@matrix-org/matrix-sdk-crypto-wasm` WASM blob is ~5.5 MB (1.9 MB gzipped). This is unavoidable with the Rust crypto backend. Serve with long-lived cache headers and consider a CDN.

- **`sessionStorage` credential storage** — the Matrix access token, login password (used for cross-signing UIA), and recovery key are all stored in `sessionStorage`, which is readable by any JS on the same origin. A single XSS vulnerability exposes all three simultaneously. Do not co-host this app with untrusted third-party scripts.

- **File uploads are not E2E encrypted** — `client.uploadContent()` sends raw bytes to the homeserver media repository without client-side encryption. The file metadata (filename, size, `mxc://` URI) is stored in an encrypted room event, but the file content itself is accessible to the homeserver operator via the media API. Use Matrix's encrypted attachment spec (`EncryptedFile` content) if confidentiality of file bytes is required.

- **`vite-plugin-top-level-await` not used** — the original plan included this plugin, but it is incompatible with Vite 8 (peer-requires a CJS-accessible `rollup`/`esbuild`, which Vite 8 no longer exposes this way). Vite 8 with `build.target: "esnext"` handles top-level await natively; the plugin is not needed.

- **`bootstrapCrossSigning` may fail silently on matrix.org** — if the server requires UIA (interactive auth) for uploading device signing keys and the 401 flow is not fully handled, cross-signing will not be established. The prototype suppresses this error. Encrypted messages will still work (Megolm), but device verification will not.

- **StrictMode double-invocation** — React StrictMode (enabled in `main.tsx`) invokes effects twice in development. The `attachSyncListeners` call may attach duplicate listeners during HMR. This is harmless in production but can cause duplicate store updates in dev.
