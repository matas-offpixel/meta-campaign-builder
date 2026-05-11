# Session log — feat/dashboard-hide-past-events

## PR

- **Number:** 381
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/381
- **Branch:** `feat/dashboard-hide-past-events`

## Summary

Hides fully-past venue groups from the main client dashboard load behind a
collapsible "Past Events" accordion at the bottom. Multi-fixture series like
Arsenal Title Run In stay in the active section until every fixture has passed
(2+ days ago in Europe/London time). Past fixtures within an active group render
with a muted/struck-through style and a "PAST" badge. Headline topline totals
exclude fully-past groups by default. URL deeplink `?past=1` preserves accordion
state across shares and browser refreshes. Identical behaviour on the public
`/share/client/[token]` portal (read-only).

## Scope / files

- `lib/dashboard/event-recency.ts` (new) — `isPastEvent`, `isPastVenueGroup`,
  `londonTodayIso`, `PAST_THRESHOLD_DAYS = 1`
- `lib/dashboard/__tests__/event-recency.test.ts` (new) — 19 unit tests
- `lib/db/client-dashboard-aggregations.ts` — added `RecencyFilter` type;
  `aggregateClientWideTotals` now accepts `recencyFilter` + `now` params
- `lib/db/__tests__/client-dashboard-aggregations.test.ts` — 4 new recency
  filter tests (64 total, all green)
- `components/share/client-portal-venue-table.tsx` — splits `allVenues` into
  `activeVenues` / `pastVenues`; past accordion; `isPastWithinActive` on
  `EventRow`; muted styling + PAST badge; `now` + `isPastGroup` props on
  `VenueSection`
- `components/share/client-portal.tsx` — `initialPastExpanded` prop;
  `pastExpanded` state + URL `?past=1` sync; passes `recencyFilter='active'`
  to `aggregateClientWideTotals`
- `components/dashboard/dashboard-tabs.tsx` — threads `initialPastExpanded`
- `app/(dashboard)/clients/[id]/dashboard/page.tsx` — reads `?past=1`
- `app/share/client/[token]/page.tsx` — reads `?past=1`

## Validation

- [x] `npm run lint` (only new/modified files checked — all pass)
- [ ] `npm run build`
- [x] `npm test` (event-recency: 19/19; aggregations: 64/64)

## Notes

- `PAST_THRESHOLD_DAYS = 1` is a constant in `lib/dashboard/event-recency.ts` —
  easy to adjust later without touching logic.
- The active-group total (headline card) includes BOTH past and future fixtures
  from the same group, matching the venue card's own "Total" row semantics.
- The existing timeframe pills (Today / Yesterday / Past 30d) on venue report
  pages are unaffected — they filter a RANGE within the spend graph, not the
  visibility of venue rows on the dashboard list.
- Individual event detail pages remain accessible via direct URL regardless of
  whether the event's group appears in active or past sections.
