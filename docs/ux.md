# UX / Frontend Reference

Frontend contributor reference. Covers routing, layout, loading states, forms, file uploads, the share modal, the verification banner, accessibility gaps, and Tailwind conventions.

---

## Route Tree

Defined in `src/App.tsx`.

```
/                           → HomePage (feature picker: CRM vs Docs)
/login                      → LoginPage
/docs                       → AppLayout > DocsLayout > DocsHomePage
/docs/:docId                → AppLayout > DocsLayout > DocEditorPage
/:entityType                → AppLayout > EntityLayout > EntityListPage
/:entityType/new            → AppLayout > EntityLayout > NewEntityPage
/:entityType/:entityId      → AppLayout > EntityLayout > EntityDetailPage
* (catch-all)               → redirect to /
```

`entityType` is the `urlSegment` from the entity config (e.g. `contacts`, `companies`, `trainings`). Pages resolve the config via `getEntityConfigBySegment(entityType)` from the registry.

Unlike the CRM routes, `/docs` does not redirect from `/` — `HomePage` (`src/pages/HomePage.tsx`) is its own route that links to both `/contacts` and `/docs`, since Docs and the CRM are peer features rather than one being the app's default.

### Auth guard behaviour in `AppLayout`

`src/components/layout/AppLayout.tsx` — `AppLayout` is the auth guard for all protected routes. It reads `loginState` from `useAuthStore`:

| `loginState` | Render |
|---|---|
| `"idle"` | Spinner ("Connecting to Matrix...") |
| `"loading"` | Spinner |
| `"unauthenticated"` | `<Navigate to="/login" replace />` |
| `"error"` | `<Navigate to="/login" replace />` |
| `"authenticated"` | Full layout (Sidebar + Header + Outlet) |

The spinner on `"idle"` and `"loading"` prevents a flash-to-login on page reload while `SessionLoader`'s async effect is restoring a saved session. See LIMIT-14 in [limitations.md](limitations.md).

`AppLayout` also mounts `<VerificationBanner />` unconditionally (it renders `null` when there is no active verification request).

---

## Layout Components

| Component | File | Role |
|---|---|---|
| `AppLayout` | `src/components/layout/AppLayout.tsx` | Auth guard, top-level shell (Sidebar + Header + main), mounts VerificationBanner |
| `EntityLayout` | `src/components/layout/EntityLayout.tsx` | Two-panel layout: left = scrollable entity list (`w-60`), right = `<Outlet>` detail/form; reads `entityType` from URL to select config |
| `Sidebar` | `src/components/layout/Sidebar.tsx` | Left nav rail (`w-48`), app name, auto-generated `NavLink` per registered entity type from `getAllEntityConfigs()` |
| `Header` | `src/components/layout/Header.tsx` | Top bar: sync state dot indicator, current `userId`, Logout button |

---

## Loading State Inventory

| Context | Pattern | Component / File |
|---|---|---|
| Session restore on reload | `loginState === "idle"` or `"loading"` → spinner div | `src/components/layout/AppLayout.tsx` |
| Entity list syncing | `isReady === false` → "Syncing..." paragraph | `src/components/entity/EntityList.tsx` |
| Entity data still syncing | `entity === undefined` after hydration → "data is still syncing..." message | `src/pages/EntityDetailPage.tsx` |
| Form submission (create / edit) | `isSubmitting` from `useForm` → button disabled + "Saving..." label | `src/components/entity/EntityForm.tsx` |
| Avatar image upload | `uploadState === "uploading"` → spinning SVG icon | `src/components/entity/EntityFormField.tsx` |
| File upload (FileDropZone) | `uploading: string[]` — per-filename spinning SVG | `src/components/contacts/FileDropZone.tsx` |
| Share action | `sharing` boolean → button disabled + "Sharing..." label | `src/components/contacts/ShareDialog.tsx` |

There is no global loading indicator. Sync state (SYNCING, RECONNECTING, etc.) is reflected only by the colored dot in `Header`.

---

## Form Patterns

All forms use **React Hook Form** with a **Zod resolver**. Entity forms are fully auto-generated from `EntityConfig.fields`.

**Setup pattern (from `EntityForm`):**

```typescript
const { register, handleSubmit, control, formState: { errors, isSubmitting } } =
  useForm({
    resolver: zodResolver(config.formSchema as any),
    defaultValues,
  });
```

The `as any` cast is required because `ZodTypeAny` does not satisfy `@hookform/resolvers` v5's generic constraints with Zod v4.

**Field rendering** is delegated to `EntityFormField` (`src/components/entity/EntityFormField.tsx`) which switches on `field.type`:

| Field type | Rendered as |
|---|---|
| `text` / `email` / `date` | `<input type={...} {...register(field.name)} />` |
| `color` | `<input type="color" />` |
| `select` | `<select>` with `field.options` |
| `avatar` | Avatar upload input via `useController` |
| `relation` | `<RelationField>` component |

**Error display strategy:** Field-level errors only. Each field renders the error message immediately below its input:

```tsx
{errors[field.name] && (
  <p className="text-red-500 text-xs mt-1">{errors[field.name]?.message}</p>
)}
```

There are no form-level error summaries. Submission errors (network failures) are surfaced by the calling page as component state outside the form.

---

## Relation Field

**File:** `src/components/entity/RelationField.tsx`

The relation field renders a searchable picker for fields of type `relation`. It reads the target entity type from the entity store and renders:

1. **Selected badges** — one badge per selected entity, with a clickable `<Link>` to the related entity's detail page (`/<urlSegment>/<id>`) and a `×` remove button.
2. **Search input** — filters the target entity list by `displayNameFn` output.
3. **Dropdown list** — shown only when the search input is non-empty; clicking an item toggles selection.

The value is `string[]` (entity IDs). For `multiple: false` fields, selecting an already-selected item deselects it (toggle behavior).

**Important:** The `useEntityStore` hook must be called before the `if (!field.relation) return null` guard — it is called unconditionally at the top of the component to comply with React's Rules of Hooks.

---

## File Upload (FileDropZone)

**File:** `src/components/contacts/FileDropZone.tsx`

The component accepts `entityId`, `entityType`, and `dataRoomId` props. It renders:

1. **Drop target div** — responds to `onDrop`, `onDragOver`, `onDragLeave`. Clicking it triggers `inputRef.current?.click()` to open the system file picker.
2. **Hidden `<input type="file" multiple>`** — actual file input, visually hidden.
3. **Upload progress list** — one spinner row per filename currently uploading.
4. **Error list** — one `<p>` per upload error, prefixed with the filename.
5. **File list** — all previously uploaded files with filename, size, and a Download button.

**Upload flow:**

```
user drops / selects files
  → uploadFile(file) called per file
  → sendEntityFile(client, config, dataRoomId, entityId, file)   src/matrix/entity-events.ts:94
      → client.uploadContent(file)        ← raw bytes to media server (unencrypted)
      → (client as any).sendEvent(dataRoomId, fileEventType, { entity_id, filename, mxc_uri, ... })
  → onDecrypted or onTimeline triggers refreshFiles()
  → store updates → component re-renders with new file in list
```

**Download flow:**

Uses the authenticated media endpoint (`/_matrix/client/v1/media/download/...`) because modern homeservers require an `Authorization` header for media downloads. `<a href>` can't send headers, so the component fetches the blob programmatically and creates a temporary object URL.

---

## Share Modal

**File:** `src/components/contacts/ShareDialog.tsx`

Uses the native `<dialog>` element (`dialogRef.current?.showModal()` / `.close()`). No custom backdrop implementation — relies on the browser's native `::backdrop` pseudo-element styled with `backdrop:bg-black/40`.

Props: `entityId`, `dataRoomId?`, `commentsRoomId?`.

**Flow:**

1. User clicks "Share" button → `dialogRef.current?.showModal()`.
2. User types a Matrix user ID (`@alice:matrix.org`) into a plain `<input type="text">`.
3. User clicks "Share" → `useShareContact.shareWith(matrixUserId)` → `client.invite()` on both rooms in parallel.
4. On success: success message displayed, then Close button.
5. On error: `error` string from `useShareContact` displayed in red below the input.

**No format validation** is applied to the Matrix user ID input. Any string is accepted and passed directly to `client.invite()`. The SDK returns an error if the ID is invalid, which surfaces via the `error` state.

---

## Verification Banner

**File:** `src/components/verification/VerificationBanner.tsx`

A fixed-position overlay (bottom-right, `z-50`, `w-96`) rendered by `AppLayout`. Driven by the `useVerification` hook.

**Incoming-only:** The banner handles SAS (Short Authentication String) verification requests initiated by *other* devices. There is no UI to initiate outgoing verification. Steps:

| `step` value | UI |
|---|---|
| `"requested"` | Description + Accept / Decline buttons |
| `"accepting"` | "Starting verification…" message |
| `"sas"` | Emoji grid (4×2) or decimal triple + "They match" / "They don't match" buttons |
| `"done"` | Green "Verification complete" message |
| `"cancelled"` | Red "Verification was cancelled or failed" message |

Step badge color: yellow (pending), blue (sas), green (done), red (cancelled).

---

## Docs

### Layout

**File:** `src/features/docs/DocsLayout.tsx`

Two-panel layout: a resizable left panel (`DocTree`, 160–480px, default 260px, dragged via a `role="separator"` handle) and a right `<Outlet>` for `DocsHomePage` or `DocEditorPage`. On mount it calls `loadDocs(client)` once, then re-runs it (debounced 300 ms) on `ClientEvent.Room`, `RoomMemberEvent.Membership`, and `RoomStateEvent.Events` (filtered to `DOC_META_STATE_TYPE`) — this is what makes a newly-shared document appear in "Shared with me" without a page reload, unlike the CRM's reliance on the general sync-driven `hydrateFromMatrix` debounce.

### Document Tree

**File:** `src/features/docs/DocTree.tsx`, `src/features/docs/DocTreeItem.tsx`

Renders two trees: the user's own documents (`getTree()`, full CRUD + drag reorder) and "Shared with me" (`getSharedTree()`, read-only except for a "Remove from Shared with me" action that leaves the room). Each own-tree item (`DocTreeItem`) supports, via hover-revealed icon buttons:

- **New sub-page** (`+`) — creates a child doc under the hovered node.
- **Rename** (`✎`, or double-click the title) — inline text input, committed on blur/Enter.
- **Delete** (`✕`) — `confirm()` dialog, then recursively deletes the node and all descendants (`deleteDoc` walks `parentDocId` links to build the removal set) and leaves their Matrix rooms.
- **Drag handle** (`⠿`) — `@dnd-kit/sortable`; see LIMIT-15 in [limitations.md](limitations.md) for the root-only reorder caveat.

A new document is created optimistically (visible in the tree immediately with `roomId: null`) while its Matrix room is created in the background; `DocEditorPage` shows a `CreatingState` skeleton ("Setting up encrypted room…") until the room ID resolves.

### Document Editor

**File:** `src/features/docs/DocEditorPage.tsx`

A BlockNote (`@blocknote/mantine`) rich-text editor wired to Yjs via `useMatrixCollaboration` (see [architecture.md](architecture.md#docs-architecture)). Key UI details:

- **Title** is an inline `<input>` in the header plus a duplicated large `contentEditable` `<h1>` in the document body — both write through `renameDoc` on blur. Both are `readOnly`/non-editable when the current user only has the doc via "Shared with me" (`isShared`).
- **Load/sync status indicator** (`DocLoadStatus`) shows one of four states, checked in this precedence: `loading` (initial history replay) → `error` (retry button, reloads the page) → `isReceiving` ("Updating…", a remote edit is mid-decryption) → `isSyncing` ("Saving…", local edits not yet confirmed persisted) → `"Synced"`.
- **Comments toggle** — a button with an animated ping badge when comments arrive while the sidebar is closed (`hasUnseenComments`, tracked via a `seenCount` high-water mark).
- The editor itself is only mounted once `loadState === "loaded"` — a skeleton (four animated bars) renders while loading, and an error state blocks editing entirely rather than risk persisting edits on top of a partially-restored document.
- Slash-menu (`/`) items come from `getDocsSlashMenuItems` (`blocknote-schema.tsx`), which adds custom blocks (callouts, multi-column layout, page break) alongside BlockNote's defaults.

### Comments Sidebar

**File:** `src/features/docs/DocCommentsSidebar.tsx`, `src/features/docs/useDocComments.ts`

Unlike CRM comments (plain text in a dedicated comments room), doc comments are `m.room.message` events in the *same* room as the document content, tagged `doc_comment: true`. `useDocComments` re-derives the full comment list from the room's live timeline on every `RoomEvent.Timeline` and `MatrixEventEvent.Decrypted` event (no incremental append) and renders bodies through `react-markdown` with a small custom component set (bold/italic/code/lists/blockquotes/links — no images or tables).

### Share Dialog (Docs)

**File:** `src/features/docs/DocShareDialog.tsx`

Structurally similar to the CRM's `ShareDialog` (native `<dialog>`, plain user-ID input) but adds a **live members list** — `refreshMembers()` reads `room.getMembers()` directly and re-runs on every `RoomMemberEvent.Membership`, showing each member's `join`/`invite` state with a per-member "Remove" (kick) button. Both invite and remove fan out to every descendant sub-document's room (see [architecture.md](architecture.md#docs-architecture)); partial fan-out failures surface as an amber warning (`shareWarning`) rather than blocking the primary action.

---

## Accessibility Gaps

Known gaps. None have been addressed in the current codebase.

| Issue | Component / File | Suggested fix |
|---|---|---|
| Drop zone has no `role`, no `aria-label`, no keyboard navigation | `src/components/contacts/FileDropZone.tsx` | Add `role="button"`, `aria-label="Upload files"`, `tabIndex={0}`, and `onKeyDown` handler (Enter/Space to open picker) |
| Sync state indicator is color-only (green/yellow/red dot) | `src/components/layout/Header.tsx` | The dot has a `title` attribute with the sync state string; also add a visually-hidden `<span>` for screen readers |
| No `aria-live` region for dynamic entity list updates | `src/components/entity/EntityList.tsx` | Wrap the list in a `<div aria-live="polite">` or announce updates via a visually-hidden live region |
| No focus trap on the share `<dialog>` | `src/components/contacts/ShareDialog.tsx` | The native `<dialog>` element provides a focus trap natively in modern browsers; verify this works across target browsers |
| `VerificationBanner` has no `role="alert"` and no `aria-live` | `src/components/verification/VerificationBanner.tsx` | Add `role="alertdialog"` and `aria-label` to the banner div so screen readers announce incoming verification requests |
| Form errors not associated with their inputs via `aria-describedby` | `src/components/entity/EntityForm.tsx` | Pass an `id` to each error `<p>` and add `aria-describedby` to the corresponding `<input>` |

---

## Tailwind CSS v4 Conventions

The project uses **Tailwind CSS v4** via the `@tailwindcss/vite` Vite plugin.

**CSS-first configuration:** In Tailwind v4, there is no `tailwind.config.js`. Configuration is done via `@theme` directives in CSS. The current `src/index.css` contains only:

```css
@import "tailwindcss";
```

No custom `@theme` block has been added — the project uses only Tailwind's default design tokens.

**No responsive breakpoints used in the UI.** All layout is fixed-width desktop (e.g. `w-48`, `w-60` sidebars). There are no `sm:`, `md:`, `lg:` responsive modifiers in any component. The app is desktop-only by design for this prototype.

**Dark mode:** Not configured. The app uses only light-mode colors (`bg-white`, `text-gray-700`, etc.).
