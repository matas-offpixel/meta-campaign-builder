# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/client-level-bulk-attach-entry-point`

## Summary

Adds a "Bulk Attach Creatives" entry point at the client level (`/clients/[id]/bulk-attach`). Previously the flow was only accessible at `/events/[id]/bulk-attach`, requiring operators to drill into individual events. The new surface shows campaigns from the entire client ad account (cross-event), enabling operators at `/clients/[id]?tab=campaigns` to run bulk-attach without event scoping. A `Paperclip` icon button appears on the Campaigns tab next to the existing "Refresh" button whenever the client has a Meta ad account configured.

## Scope / files

- `components/dashboard/campaigns/client-campaigns-tab.tsx` — add `adAccountId` prop and "Bulk Attach Creatives" link button
- `components/dashboard/clients/client-detail.tsx` — pass `adAccountId={client.meta_ad_account_id}` to `ClientCampaignsTab`
- `app/(dashboard)/clients/[id]/bulk-attach/page.tsx` — new server component; fetches client, guards on missing ad account, renders wizard
- `app/(dashboard)/clients/[id]/bulk-attach/wizard.tsx` — new client component; full 4-step wizard adapted from the event-scoped page with client-scoped draft persistence and back-link

## Key differences from the event-scoped wizard

- `adAccountId` is a required prop (resolved server-side — no manual entry form)
- No `preselectCodes` (event-specific feature)
- Back link → `/clients/[id]?tab=campaigns`
- localStorage key: `bulk-attach-unsaved-client-[clientId]`
- Draft save: `clientId` stored, `eventId: null`
- Draft list: all user drafts shown (no `?eventId=` filter)

## Validation

- [x] `npx tsc --noEmit` — zero errors in changed files (pre-existing jest/`.next/` errors unchanged)
- [x] All 62 bulk-attach + draft + template tests pass
- [x] Events `/events/[id]/bulk-attach` page untouched

## Notes

- PR #570/#568/#575 creative builder fixes apply automatically — the wizard calls the same shared `Creatives` component and `bulk-attach-ads` API endpoint.
- ACTIVE default (PRs #540/#541) applies automatically — same API endpoint.
