# UX / Frontend Reference

Frontend contributor reference. Covers routing, layout, loading states, forms, file uploads, the share modal, the verification banner, accessibility gaps, and Tailwind conventions.

---

## Route Tree

Defined in `src/App.tsx`.

```
/login                    → LoginPage
/                         → redirect to /contacts
/contacts                 → AppLayout > ContactsLayout > ContactsPage
/contacts/new             → AppLayout > ContactsLayout > NewContactPage
/contacts/:contactId      → AppLayout > ContactsLayout > ContactDetailPage
* (catch-all)             → redirect to /contacts
```

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
| `ContactsLayout` | `src/components/layout/ContactsLayout.tsx` | Two-panel layout: left = scrollable contact list (w-60), right = `<Outlet>` detail/form |
| `Sidebar` | `src/components/layout/Sidebar.tsx` | Left nav rail (w-48), app name, "Contacts" `NavLink` |
| `Header` | `src/components/layout/Header.tsx` | Top bar: sync state dot indicator, current `userId`, Logout button |

`ContactsLayout` also renders an "Export JSON" button at the bottom of the left panel that calls `exportContactsJson` from `src/lib/export.ts`. The button is disabled when there are no contacts.

---

## Loading State Inventory

| Context | Pattern | Component / File |
|---|---|---|
| Session restore on reload | `loginState === "idle"` or `"loading"` → spinner div | `src/components/layout/AppLayout.tsx:16` |
| Form submission (create / edit contact) | `isSubmitting` from `useForm` → button disabled + "Saving..." label | `src/components/contacts/ContactForm.tsx:279` |
| Avatar image upload | `uploadState === "uploading"` → spinning SVG icon next to the "Replace" button | `src/components/contacts/ContactForm.tsx:165` |
| File upload (FileDropZone) | `uploading: string[]` — per-filename spinning SVG | `src/components/contacts/FileDropZone.tsx:114` |
| Share action | `sharing` boolean → button disabled + "Sharing..." label | `src/components/contacts/ShareDialog.tsx:79` |

There is no global loading indicator. Sync state (SYNCING, RECONNECTING, etc.) is reflected only by the colored dot in `Header`.

---

## Form Patterns

All forms use **React Hook Form** with a **Zod resolver**.

**Setup pattern (from `ContactForm`):**

```typescript
const { register, handleSubmit, formState: { errors, isSubmitting } } =
  useForm<ContactFormData>({
    resolver: zodResolver(ContactFormSchema),
    defaultValues,
  });
```

**Error display strategy:** Field-level errors only. Each field renders the error message immediately below its input:

```tsx
{errors.fullname && (
  <p className="text-red-500 text-xs mt-1">{errors.fullname.message}</p>
)}
```

There are no form-level error summaries. Submission errors (network failures) are surfaced by the calling page (e.g. `NewContactPage`, `ContactDetailPage`) as component state outside the form.

**Zod schemas used by forms:**
- `ContactFormSchema` (`src/schemas/contact.schema.ts:29`) — omits `id`, `createdAt`, `createdBy`, `updatedAt`, `dataRoomId`, `commentsRoomId` from the full `ContactSchema`.

---

## File Upload (FileDropZone)

**File:** `src/components/contacts/FileDropZone.tsx`

The component accepts a `contactId` and `dataRoomId` prop. It renders:

1. **Drop target div** — responds to `onDrop`, `onDragOver`, `onDragLeave`. Clicking it triggers `inputRef.current?.click()` to open the system file picker.
2. **Hidden `<input type="file" multiple>`** — actual file input, visually hidden.
3. **Upload progress list** — one spinner row per filename currently uploading.
4. **Error list** — one `<p>` per upload error, prefixed with the filename.
5. **File list** — all previously uploaded files with filename, size, and a Download button.

**Upload flow:**

```
user drops / selects files
  → uploadFile(file) called per file
  → sendContactFile(client, dataRoomId, contactId, file)   src/matrix/events.ts:85
      → client.uploadContent(file)        ← raw bytes to media server (unencrypted)
      → client.sendEvent(EVENT_TYPE_CONTACT_FILE, { filename, mxc_uri, ... })
  → onDecrypted or onTimeline triggers refreshFiles()
  → store updates → component re-renders with new file in list
```

**Download flow:**

Uses the authenticated media endpoint (`/_matrix/client/v1/media/download/...`) because modern homeservers require an `Authorization` header for media downloads. `<a href>` can't send headers, so the component fetches the blob programmatically and creates a temporary object URL.

---

## Share Modal

**File:** `src/components/contacts/ShareDialog.tsx`

Uses the native `<dialog>` element (`dialogRef.current?.showModal()` / `.close()`). No custom backdrop implementation — relies on the browser's native `::backdrop` pseudo-element styled with `backdrop:bg-black/40`.

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

## Accessibility Gaps

Known gaps. None have been addressed in the current codebase.

| Issue | Component / File | Suggested fix |
|---|---|---|
| Drop zone has no `role`, no `aria-label`, no keyboard navigation | `src/components/contacts/FileDropZone.tsx:89` | Add `role="button"`, `aria-label="Upload files"`, `tabIndex={0}`, and `onKeyDown` handler (Enter/Space to open picker) |
| Sync state indicator is color-only (green/yellow/red dot) | `src/components/layout/Header.tsx:11` | The dot has a `title` attribute with the sync state string; also add a visually-hidden `<span>` for screen readers |
| No `aria-live` region for dynamic contact list updates | `src/components/contacts/ContactsList.tsx` | Wrap the list in a `<div aria-live="polite">` or announce updates via a visually-hidden live region |
| No focus trap on the share `<dialog>` | `src/components/contacts/ShareDialog.tsx:41` | The native `<dialog>` element provides a focus trap natively in modern browsers; verify this works across target browsers |
| `VerificationBanner` has no `role="alert"` and no `aria-live` | `src/components/verification/VerificationBanner.tsx:12` | Add `role="alertdialog"` and `aria-label` to the banner div so screen readers announce incoming verification requests |
| Form errors not associated with their inputs via `aria-describedby` | `src/components/contacts/ContactForm.tsx` | Pass an `id` to each error `<p>` and add `aria-describedby` to the corresponding `<input>` |

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
