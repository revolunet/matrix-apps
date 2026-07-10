# Matrix apps Prototype

**What if your app's backend was a chat protocol?**

This is an experiment in building real applications — a CRM and a Notion-style collaborative document editor — with **no application server at all**. Every byte of data lives inside end-to-end-encrypted [Matrix](https://matrix.org) rooms, on whatever homeserver you point it at (`matrix.org` by default, or your own). The React app talks directly to the homeserver; there is no API in between that could see your data, log it, or go down independently.

```
npm install && npm run dev
```

Open `http://localhost:5173`, log in with any Matrix account, and you're in.

> **This is a prototype, not a product.** It's built to explore whether Matrix is a viable generic application backend — not to be deployed with real data. See [Drawbacks](#drawbacks--known-limitations) below and [`docs/security.md`](docs/security.md) before doing anything but kicking the tires.

---

## What's actually in here

Two features, sharing one login and one encryption layer:

- **A CRM** — Contacts, Companies, and Trainings, each with comments and file attachments. New entity types are added by writing a schema + config file, not by changing any UI code (see [Entity Registry](#entity-registry)).
- **Docs** — a real-time collaborative rich-text editor (headings, callouts, multi-column layouts, page breaks, file drops), Notion-style nested page hierarchy, comments, and sharing. Multiple people can type in the same document at once, live, fully encrypted.

Both are just different shapes of data stored the same way: as timeline events in Matrix rooms, encrypted with Megolm, synced by the Matrix protocol's own sync loop — the same mechanism Element and every other Matrix client already relies on.

---

## Use Cases

This pattern is worth considering when:

- **You want a small internal tool (CRM, wiki, notes app) without standing up or paying for a backend.** The homeserver _is_ the backend. Deploy the frontend as static files anywhere; data storage, sync, and multi-device support are the homeserver's problem, not yours.
- **Data sovereignty matters.** Point the app at a homeserver you run yourself, and nobody but your users' devices can read the actual content — not even the server operator.
- **You (or your users) already live in the Matrix/Element ecosystem** and want a purpose-built app that reuses the same identity, encryption, and device-verification model instead of bolting on a separate auth system.
- **You're evaluating "Matrix as a generic app backend"** as an architectural pattern — this repo is effectively a worked example, including the parts that turned out to be awkward (see Drawbacks).
- **You need real-time multiplayer editing (Google Docs-style) but E2E-encrypted** — most CRDT-over-server stacks give up encryption for simplicity; this one doesn't.

This is a poor fit if you need a polished, ready-to-ship product today, need fine-grained server-side permissions/roles, or need guaranteed low storage growth over years of heavy use (see below).

---

## Benefits

- **No backend to build, host, or patch.** `npm run build` produces static files. Deploy to Netlify, Cloudflare Pages, GitHub Pages — anything. All "server" logic (storage, sync, auth, rate limiting) is the homeserver's.
- **End-to-end encryption by default.** Entity data, comments, and document content are encrypted with Megolm before they leave the browser. File attachments (CRM and Docs alike) are additionally encrypted client-side with AES-256-CTR before upload, so the media repo only ever stores ciphertext.
- **Real-time sync and multi-device support come for free.** Matrix's sync protocol, which already handles reconnection, catch-up, and cross-device delivery, is reused as-is — no custom WebSocket/polling layer to write or debug.
- **Sharing is just "invite a user to a room."** There's no separate ACL system to build: Matrix's existing invite/join/permission model _is_ the sharing model, for both CRM entities and documents.
- **Collaboration is genuinely concurrent, not locked.** Documents use Yjs (a CRDT), so two people can edit the same paragraph at the same time and both edits merge cleanly — this isn't a save-and-refresh model.
- **Extensible by convention.** The CRM's entity registry pattern means a new data type (say, "Projects") is a schema file and a config file, not new routing, storage, or form code.
- **One identity system for two very different apps.** Structured records (CRM) and free-form collaborative docs share the same login, encryption, and device-verification layer — worth noting as evidence the pattern generalizes.

---

## Drawbacks & Known Limitations

This is where "prototype" is not a formality:

- **Ephemeral recovery keys.** A new secret-storage key is generated on every login and kept only in `sessionStorage`. Close the tab, and messages from that session may become permanently unreadable — there's no key-backup restore flow yet.
- **Credentials sit in `sessionStorage`.** Access token, password (needed for cross-signing), and recovery key are all readable by any JS on the page. One XSS bug compromises all three. Don't co-host this with untrusted third-party scripts.
- **Storage only grows.** CRM entities are stored as full-snapshot events on every edit (Matrix state events can't be encrypted, so this is a workaround) — the room timeline grows forever, with no compaction. Docs mitigate this with periodic squashed snapshots, but the underlying room still accumulates history.
- **Metadata isn't private, even if content is.** Room membership, timestamps, and the CRM's entity index (in `account_data`) are visible to the homeserver operator. Filenames are also not sent to the server (uploads use `includeFilename: false`), but file _size_ and _upload timing_ still are.
- **Rate limits bite in practice.** `matrix.org` throttles room creation and message sending aggressively; creating several entities or documents quickly can trigger errors. Realistic use needs a self-hosted homeserver (e.g. Synapse).
- **Not everything is a CRDT.** Docs use Yjs, so concurrent edits merge safely. CRM entities do not — two people editing the same Contact at once can silently overwrite each other's changes (last write wins).
- **Rough edges expected of a prototype:** no error boundaries (a crypto or network failure can blank the screen), no automated tests, no entity-deletion flow, incomplete device-verification UX, and a large WASM crypto bundle (~5.5 MB) that slows first load.
- **Fighting the protocol's grain in places.** Matrix's 65 KB per-event size limit means large document updates must be chunked and reassembled; state events can't be encrypted, forcing the full-snapshot-as-timeline-event workaround above. These aren't bugs so much as the cost of repurposing a chat protocol as a database.

A full, itemized limitations list (with bug/limitation IDs) lives in [`docs/limitations.md`](docs/limitations.md); the security threat model is in [`docs/security.md`](docs/security.md).

---

## Tech Stack

| Concern               | Library                                   |
| --------------------- | ----------------------------------------- |
| Framework             | React 19 + TypeScript (Vite)              |
| Matrix SDK            | `matrix-js-sdk` (Rust/WASM crypto)        |
| Collaborative editing | Yjs (CRDT) + BlockNote (rich-text editor) |
| Styling               | Tailwind CSS v4                           |
| UI components         | Mantine                                   |
| State                 | Zustand + Immer                           |
| Routing               | React Router                              |
| Forms                 | React Hook Form + Zod                     |
| Table                 | TanStack Table                            |
| Drag & drop           | dnd-kit                                   |

---

## Architecture, in brief

```
Login → createMatrixClient → initRustCrypto → bootstrapSecretStorage
      → bootstrapCrossSigning → startClient → attachSyncListeners
                                                     ↓
                                Zustand stores hydrated from Matrix
                                account_data indices + room timelines
```

### Entity Registry

Every CRM data type (Contact, Company, Training, …) is a self-contained config object registered once at startup. All list/detail UI, routing, and Matrix storage is driven generically from these configs — a new entity type needs only:

1. A Zod schema (`src/entities/<type>/schema.ts`)
2. A config registration (`src/entities/<type>/config.ts`)
3. One import line in `src/App.tsx`

Each entity instance gets two encrypted Matrix rooms (`data` + `comments`); a per-type index of room IDs lives in `account_data` for fast listing.

### Docs

Each document is one encrypted Matrix room. A `MatrixYjsProvider` streams incremental Yjs updates as room events, periodically collapsing them into a full-state snapshot so reloads and new collaborators don't have to decrypt the entire history. Document hierarchy (nesting, ordering) lives in an `account_data` index for the owner, mirrored into room state so people the doc is shared _with_ — who can't read the owner's private index — still see the right title and position in the tree.

### Directory layout

```
src/
├── entities/         Entity type definitions, registry, per-type schema+config
├── features/docs/    Docs editor, tree/hierarchy, comments, sharing
├── matrix/           Client lifecycle, auth, entity/doc rooms, Yjs↔Matrix bridge, sync
├── stores/           Zustand: auth, entity, sync
├── hooks/            useMatrixClient, useEntitySync, useShareContact
├── components/       Shared entity/layout/comment/verification UI
└── pages/            Login, entity list/detail, new-entity
```

For deeper detail, see [`docs/`](docs/index.md) — architecture decisions, the full security threat model, tracked limitations, and frontend/UX conventions.

---

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` and log in with a **matrix.org account** (or point `HOMESERVER_URL` in `src/lib/constants.ts` at your own homeserver — recommended if you plan to use this beyond a quick look, given the rate-limit caveat above).

### Build

```bash
npm run build
```

Output lands in `dist/` — deploy to any static host.
