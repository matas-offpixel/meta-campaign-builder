# Session log — perf/venue-page-narrow-loader (PR-C)

## PR

- **Number:** 361
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/361
- **Branch:** `perf/venue-page-narrow-loader`

## Summary

Stop the internal venue page (`/clients/[id]/venues/[event_code]`)
from loading the entire client-portal payload then filtering events
in memory. Add a venue-scoped loader `loadVenuePortalByCode` that
narrows the events SELECT to the requested `event_code` (plus the
synthetic London on-sale / presale rows the topline aggregator
needs) at the SQL layer. Steps 3–13 (snapshots, rollups, ticket
tiers, allocations, sales, etc.) inherit the narrow `eventIds` set
so the per-event PostgREST filters return only the rows the venue
page actually renders.

Cold load drops from ~1.5–3.5s (whole-client payload filtered in
memory) to ~200–400ms (1–4 events × parallel fetches inherited
from PR #360).

## Scope / files

- `lib/db/client-portal-server.ts` — refactor `loadPortalForClientId`
  to accept `options?: { eventCode?: string }`. When provided, the
  events SELECT filters to `.in("event_code", [eventCode,
  LONDON_ONSALE_EVENT_CODE, LONDON_PRESALE_EVENT_CODE])`. The
  synthetic London codes are split out of `eventRows` by the existing
  `SYNTHETIC_LONDON_CODES` check so they never leak into the rendered
  venue list. Add new exported `loadVenuePortalByCode(clientId,
  eventCode)` wrapper. `loadClientPortalByClientId` is unchanged
  (called with no options → unchanged behaviour for the dashboard
  route).
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` —
  swap `loadClientPortalByClientId(id)` → `loadVenuePortalByCode(id,
  eventCode)` and drop the in-memory `result.events.filter(...)`
  cascade. The loader has already filtered.

## Validation

- [x] `npm test` — 853 pass / 0 fail.
- [x] `npm run build` — clean.
- [x] No new lint warnings on the changed files.
- [ ] Open Lock Warehouse / TOCA Social / Outernet venue pages on
      preview deploy; confirm Trend chart, Active Creatives, Funnel
      Pacing, additional-spend totals all render identically to
      pre-PR.
- [ ] Confirm the venue page console marker logs `<400ms` cold for
      the narrow loader on a 1–4-event venue.

## Notes

- The synthetic London inclusion is a deliberate trade-off: 2 extra
  rows per venue page in exchange for keeping `londonOnsaleSpend` /
  `londonPresaleSpend` populated. Net cost is negligible vs the 38
  events the venue page no longer fetches.
- `loadClientPortalData` (token-driven share route) and
  `loadVenuePortalByToken` (legacy share route) intentionally still
  call `loadPortalForClientId` *without* the eventCode option — they
  pre-date the venue scope and rely on filtering the full payload.
  Migrating them is a separate scope.
- Builds on PR #360 (`perf/client-portal-loader-parallelise`) which
  ships the underlying Promise.all. Without that PR the narrow loader
  would still pay sequential round-trip latency.
