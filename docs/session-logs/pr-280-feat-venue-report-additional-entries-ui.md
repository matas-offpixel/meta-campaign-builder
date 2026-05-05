# Session log

## PR

- **Number:** 280
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/280
- **Branch:** `feat/venue-report-additional-entries-ui`

## Summary

Added venue-report entry points for additional spend and additional ticket sales so operators can add event-specific costs, allocations, comps, and offline sales directly from the venue view.

## Scope / files

- `components/dashboard/events/additional-ticket-entries-card.tsx`
- `components/dashboard/events/venue-additional-spend-card.tsx`
- `components/share/venue-full-report.tsx`
- `components/share/client-portal-venue-table.tsx`
- `components/share/venue-event-breakdown.tsx`
- `app/api/events/[id]/additional-ticket-entries/**`
- `app/api/events/[id]/additional-tickets/**`

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint <changed files>`
- [ ] `npm run lint` (fails on pre-existing repo-wide lint errors outside this change: `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, existing hook/effect warnings, etc.)

## Notes

Investigation found `additional_ticket_entries` schema, aggregation, API, and a per-event card under `additional-ticket-sales-card.tsx`, but no component named `additional-ticket-entries-card.tsx` and no ticket-entry UI wired into `client-portal-venue-table.tsx`.
