# Session log — Customer Audience Upload (Client-level relocation)

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/customer-audience-client-level`
- **Follows:** PR #547 (`cursor/customer-audience-upload`)

## Summary

Relocates the Customer Audience Upload tool from event-scoped
(`/events/[id]/customer-audience`) to client-scoped
(`/clients/[id]/customer-audience`). Customer audiences are bound to a
Meta ad account — which is a client-level resource — not to a single event.
A 4thefans buyer list applies across all 4thefans events.

The backend route (`POST /api/meta/customer-audience-upload`) is unchanged —
it already accepts `adAccountId` in the body.

## Scope / files

**New:**
- `components/dashboard/clients/customer-audience-wizard.tsx` — "use client" 4-step wizard,
  adapted from the event page in PR #547. Props: `clientId`, `clientName`, `adAccountId`.
  Back button + success link → `/clients/{id}`.
- `app/(dashboard)/clients/[id]/customer-audience/page.tsx` — server wrapper: loads
  `client.name` + `client.meta_ad_account_id` via `getClientByIdServer` (RLS-scoped),
  renders the wizard.

**Modified:**
- `app/(dashboard)/audiences/[clientId]/audience-list-actions.tsx` — "Upload customer list"
  pill added after "New audience", linking to `/clients/${clientId}/customer-audience`
- `components/dashboard/clients/client-detail.tsx` — "Upload customer audience" button added
  to PageHeader actions after "Rollout", conditional on `client.meta_ad_account_id` being set
- `docs/session-logs/pr-547-cursor-customer-audience-upload.md` — "Superseded by PR #548"
  notice added at top

**Deleted:**
- `app/(dashboard)/events/[id]/customer-audience/page.tsx` — event-scoped page removed;
  no 404 guard needed since Next.js returns 404 for missing routes automatically

**Cleaned:**
- `components/dashboard/events/event-detail.tsx` — "Upload customer audience" button removed
  from Campaigns tab (was added by PR #547; this PR removes it — customer audiences are
  not event-scoped)

**Backend unchanged:**
- `app/api/meta/customer-audience-upload/route.ts` — no changes
- `app/api/meta/customer-audience-upload/list/route.ts` — no changes
- `lib/customer-audience/` — no changes
- All tests from PR #547 remain valid

## PII Safety

All PII safety properties from PR #547 are preserved:
- Hashing still happens in the browser (`CustomerAudienceWizard` → `hashAudienceBatch`)
- Server route receives only SHA-256 hashes + audience config
- No PII in localStorage or server logs
- "Clear all" re-mounts the wizard, flushing in-memory state

## Validation

- [x] `npx eslint` on all changed files — 0 errors
- [x] `npx tsc --noEmit` — no new errors in new files
- [ ] Vercel preview build green
- [ ] Click-through: `/clients/[id]` → "Upload customer audience" (visible only when ad account set) → wizard → success panel → "Back to [client name]"
- [ ] Click-through: `/audiences/[clientId]` → "Upload customer list" pill → same wizard
- [ ] Confirm `/events/[id]/customer-audience` returns 404
- [ ] Confirm event detail Campaigns tab has NO upload button

## Notes

- `getClientByIdServer` enforces RLS so only the owning user can load the client.
- Button in client-detail is conditional on `client.meta_ad_account_id` — clients without
  a Meta ad account don't see it (the wizard shows a helpful error if id is empty).
- The Audience Builder pill always shows regardless of ad account, mirroring how all other
  audience actions work.
