# proto-cms-matrix — Documentation

A React 19 + TypeScript SPA prototype that uses the Matrix protocol as a fully E2E-encrypted backend for a multi-entity CRM. There is no application server — all persistence lives in Matrix rooms and `account_data` on a homeserver.

> **Prototype warning.** This codebase is not production-ready. Read [security.md](security.md) before storing real data or deploying publicly.

---

## Navigation

| Document | Audience | Description |
|---|---|---|
| [architecture.md](architecture.md) | Backend / platform contributors | Why the system is structured this way: startup sequence, entity registry, ADRs, event registry, state management, sync, crypto, sharing |
| [security.md](security.md) | Security reviewers, anyone deploying | Threat model, what is and is not encrypted, credential storage, known vulnerabilities |
| [limitations.md](limitations.md) | Product / engineering | Tracked bugs (BUG-xx), missing features (LIMIT-xx), and scaling constraints |
| [ux.md](ux.md) | Frontend contributors | Route tree, layout components, loading states, form patterns, file upload, share modal, accessibility |

---

## Quick Source Links

| Concern | File |
|---|---|
| App entry point & routes | `src/App.tsx` |
| Entity type definitions | `src/entities/types.ts` |
| Entity registry | `src/entities/registry.ts` |
| Contact entity config | `src/entities/contact/config.ts` |
| Company entity config | `src/entities/company/config.ts` |
| Training entity config | `src/entities/training/config.ts` |
| Matrix client lifecycle | `src/matrix/client.ts` |
| Login / register / session restore | `src/matrix/auth.ts` |
| Room creation (two rooms per entity) | `src/matrix/entity-rooms.ts` |
| Event read/write helpers | `src/matrix/entity-events.ts` |
| Entity index in `account_data` | `src/matrix/entity-index.ts` |
| Sync listeners + debounce | `src/matrix/sync.ts` |
| Generic entity Zustand store | `src/stores/entity.store.ts` |
| Auth Zustand store | `src/stores/auth.store.ts` |
| Sync state Zustand store | `src/stores/sync.store.ts` |
| Share flow hook | `src/hooks/useShareContact.ts` |
| Auto-generated entity form | `src/components/entity/EntityForm.tsx` |
| Relation field picker | `src/components/entity/RelationField.tsx` |
| File upload component | `src/components/contacts/FileDropZone.tsx` |
| Verification banner | `src/components/verification/VerificationBanner.tsx` |

---

## Relationship to README.md

`README.md` is the developer quick-start: tech stack, getting started commands, features list, and a high-level warning section.

This `docs/` tree goes deeper:

- `architecture.md` expands the README's architecture diagram into annotated ADRs and code citations.
- `security.md` turns the README's WARNING block into a structured threat model.
- `limitations.md` turns the README's TODO list into trackable items with bug IDs and root-cause citations.
- `ux.md` documents frontend conventions that are not covered by the README at all.
