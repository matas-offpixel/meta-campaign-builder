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
it already accepts `adAccountId` in the body, not `eventId`.

## Scope / files

**New:**
- `components/dashboard/clients/customer-audience-wizard.tsx` — "use client" 4-step wizard,
  adapted from the event page in PR #547 (props: `clientId`, `clientName`, `adAccountId`)
- `app/(dashboard)/clients/[id]/customer-audience/page.tsx` — server wrapper: loads
  `client.name` + `client.meta_ad_account_id` via `getClientByIdServer`, renders wizard

**Modified:**
- `app/(dashboard)/audiences/[clientId]/audience-list-actions.tsx` — adds "Upload customer list"
  pill linking to `/clients/${clientId}/customer-audience`
- `components/dashboard/clients/client-detail.tsx` — adds "Upload customer audience" button in
  PageHeader actions (conditional on `client.meta_ad_account_id` being set)
- `docs/session-logs/pr-547-cursor-customer-audience-upload.md` — adds "Superseded by PR #548"
  notice at top

**Deleted:**
- `app/(dashboard)/events/[id]/customer-audience/page.tsx` — removed (no 404; file gone)

**Cleaned from event-detail:**
- `components/dashboard/events/event-detail.tsx` — "Upload customer audience" button removed from
  Campaigns tab (PR #547 added it; this PR removes it per the new architecture)

## PII Safety

All PII safety properties from PR #547 are preserved:
- Hashing still happens in the browser (`CustomerAudienceWizard` → `hashAudienceBatch`)
- Server route only receives SHA-256 hashes
- No PII in localStorage or logs
- "Clear all" re-mounts the wizard (flushes in-memory state)

## Validation

- [x] `npx eslint` on all changed files — 0 errors
- [x] `npx tsc --noEmit` — no new errors in customer-audience files
- [ ] Vercel preview build green
- [ ] Click-through: `/clients/[id]` → "Upload customer audience" → wizard flows → success panel
- [ ] Click-through: `/audiences/[clientId]` → "Upload customer list" pill → same wizard
- [ ] Confirm `/events/[id]/customer-audience` returns 404 (file deleted)
- [ ] Confirm event detail Campaigns tab no longer shows the upload button

## Notes

- The server page uses `getClientByIdServer` (RLS-scoped) to enforce ownership.
- The button in client-detail is conditional: only shown when `client.meta_ad_account_id`
  is set. The wizard itself also shows a helpful "no ad account" message if the ID is empty.
- The Audience Builder pill always shows (the clientId there equals the client UUID, same
  as `/clients/[id]`). If the client has no ad account, the wizard will surface the error.
