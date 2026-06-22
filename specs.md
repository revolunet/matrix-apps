# Matrix CMS Prototype — Specification

A web frontend for a multi-entity CRM that uses the Matrix protocol as a fully end-to-end-encrypted backend. No application server. All persistence is in Matrix rooms and `account_data` on a homeserver.

## Authentication

- Login with Matrix username/password (`m.login.password`)
- Register a new Matrix account (two-step UIA with `m.login.dummy`)
- Session persisted in `sessionStorage` and restored automatically on page reload
- Logout invalidates the current device's access token

## Entity Registry

All data models are registered through an **entity registry** (`src/entities/registry.ts`). Each entity type is defined by an `EntityConfig` object:

```typescript
interface EntityConfig {
  type: string             // unique key: 'contact', 'company', 'training'
  label: string            // singular label for UI
  pluralLabel: string      // plural label for UI
  urlSegment: string       // plural URL path segment: 'contacts', 'companies'
  schema: ZodSchema        // full schema (includes system fields)
  formSchema: ZodSchema    // form schema (system fields omitted)
  fields: FieldDefinition[]
  eventTypePrefix: string  // e.g. 'org.demo-e2e-app.contact'
  roomNameFn: (id, suffix?) => string   // derives Matrix room name from entity ID
  displayNameFn: (data) => string       // human-readable label for list/index
  matchRoomName: (roomName) => { entityId, isComments } | null  // reverse-parse room name
}
```

## Models

Entity schemas live in `src/entities/<type>/schema.ts`. All entities include system fields: `id` (UUID), `createdAt`, `createdBy`, `updatedAt`, `dataRoomId`, `commentsRoomId`.

### Contact

Fields: `fullname`, `email`, `gender` (male/female/other/prefer_not_to_say), `birthdate` (ISO date, optional), `preferred_color` (CSS hex, optional), `avatarMxcUri` (mxc:// URI, optional).

### Company

Fields: `name`, `email` (optional), `website` (optional), `contactIds` (array of Contact UUIDs — relation field).

### Training

Fields: `title`, `description` (optional), `startDate` (optional), `endDate` (optional), `participantIds` (array of Contact UUIDs — relation field).

### Comment

Fields: `id` (Matrix event ID), `contactId` (entity ID, legacy field name), `authorId` (Matrix userId), `body`, `createdAt`.

### File attachment

Fields: `id` (Matrix event ID), `entityId`, `authorId`, `filename`, `mxcUri`, `mimetype`, `size`, `createdAt`.

## Channels

Each entity type defines its own naming convention via `EntityConfig.roomNameFn`. The pairing between data and comments rooms is detected by the `-comments` suffix, which each entity config encodes in both `roomNameFn` and `matchRoomName`.

| Entity | Data room name | Comments room name |
|---|---|---|
| Contact | `demo-e2e-app/channels/<id>` | `demo-e2e-app/channels/<id>-comments` |
| Company | `demo-e2e-app/channels/company-<id>` | `demo-e2e-app/channels/company-<id>-comments` |
| Training | `demo-e2e-app/channels/training-<id>` | `demo-e2e-app/channels/training-<id>-comments` |

Both rooms for each entity use `m.megolm.v1.aes-sha2` encryption.

### Event types

| Event type pattern | Room | Purpose |
|---|---|---|
| `<eventTypePrefix>.update` | Data room | Full entity snapshot (latest wins) |
| `<eventTypePrefix>.file` | Data room | File attachment metadata (mxc URI + filename/size/mimetype) |
| `m.room.message` (msgtype `m.text`) | Comments room | Comment text |

Examples:
- `org.demo-e2e-app.contact.update` — Contact snapshot
- `org.demo-e2e-app.company.update` — Company snapshot
- `org.demo-e2e-app.training.update` — Training snapshot

## Indexing

Each entity type stores a per-type index in Matrix `account_data` under the key `<eventTypePrefix>_index` (e.g. `org.demo-e2e-app.contact_index`). The index maps `entityId → { dataRoomId, commentsRoomId, displayName, addedAt }`. It syncs automatically across all of the user's devices and survives browser storage clears. The index is not E2E encrypted (visible to the homeserver operator).

## Relation Fields

Entity schemas can declare fields that link to another entity type:

```typescript
{ name: 'contactIds', label: 'Contacts', type: 'relation',
  relation: { entityType: 'contact', multiple: true } }
```

Relation fields are stored as `string[]` (arrays of UUIDs) in the entity snapshot. The UI renders a searchable picker that reads the target entity type from the entity store. Selected items display as badges that link to the related entity's detail page.

## Sharing

- Any user can invite another Matrix user (`@user:server`) to both rooms of an entity.
- The invitee auto-joins on the next sync cycle and the entity appears in their list automatically.
- The owner re-sends the latest entity snapshot when the new member joins, so the invitee can decrypt it immediately.
- Both parties can edit the entity and leave comments in real time.

## UI

- **Entity list/detail layout** — scrollable entity list on the left (per entity type), detail/form panel on the right
- **Create entity** — auto-generated form from `EntityConfig.fields`; saves a snapshot event on submit
- **Edit entity** — same auto-generated form pre-filled; saves a new snapshot event
- **Relation picker** — searchable select for relation fields; selected items shown as badges with links to related entities
- **Comments feed** — chronological list, new comment input at bottom
- **File attachments** — drag-and-drop or click-to-browse upload; download via authenticated media endpoint
- **Share dialog** — enter a Matrix user ID to invite to both rooms
- **Device verification** — incoming SAS (emoji) verification requests handled via a fixed overlay banner

## E2E Encryption

- All entity data, comments, and file metadata are encrypted with Megolm (`m.megolm.v1.aes-sha2`).
- Crypto is handled by the Rust/WASM backend (`@matrix-org/matrix-sdk-crypto-wasm`), initialised via `initRustCrypto`.
- Secret storage and cross-signing are bootstrapped automatically on first login.
- File bytes are uploaded to the homeserver media repository without client-side encryption (known limitation).

## Adding a New Entity Type

1. Create `src/entities/<type>/schema.ts` with a Zod schema
2. Create `src/entities/<type>/config.ts` calling `registerEntity({...})`
3. Add `import "@/entities/<type>/config"` to `src/App.tsx`

Routes, forms, list view, detail view, sidebar navigation, and Matrix storage all work automatically.
