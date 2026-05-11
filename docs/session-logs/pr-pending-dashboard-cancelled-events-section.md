# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `feat/dashboard-cancelled-events-section`

## Summary

Adds a third "Cancelled Events" collapsible accordion to the client dashboard (both internal `/clients/[id]/dashboard` and shared `/share/client/[token]`). Cancelled venue groups — where every fixture has `status='cancelled'` — are pulled out of the active and past buckets and rendered with red-tinted styling below the existing "Past Events" section. Individual cancelled fixtures inside otherwise-active groups show a red CANCELLED badge in-row. Priority order: `cancelled > past > active`. A `?cancelled=1` URL deeplink preserves expand state across shares and page refreshes.

## Scope / files

- `lib/dashboard/event-recency.ts` — new `isCancelledEvent` + `isCancelledVenueGroup` helpers
- `lib/db/client-dashboard-aggregations.ts` — `RecencyFilter` extended with `'cancelled'`; `AggregatableEvent.status` field; `aggregateClientWideTotals` bucketing updated
- `lib/db/client-portal-server.ts` — `PortalEvent.status` field + Supabase select + mapping
- `components/share/client-portal-venue-table.tsx` — 3-bucket split, `cancelledSectionSummary`, Cancelled accordion, `isCancelledGroup` + `isCancelledWithinActive` styling
- `components/share/client-portal.tsx` — `cancelledExpanded` state + `handleCancelledToggle` + `?cancelled=1` URL sync; `initialCancelledExpanded` prop
- `components/dashboard/dashboard-tabs.tsx` — `initialCancelledExpanded` prop threaded to `ClientPortal`
- `app/(dashboard)/clients/[id]/dashboard/page.tsx` — reads `?cancelled=1` from `searchParams`
- `app/share/client/[token]/page.tsx` — reads `?cancelled=1` from `searchParams`
- `lib/dashboard/__tests__/event-recency.test.ts` — tests for `isCancelledEvent` + `isCancelledVenueGroup`
- `lib/db/__tests__/client-dashboard-aggregations.test.ts` — tests for `recencyFilter='cancelled'`

## Validation

- [x] `npm run lint` — 0 new errors in touched files (pre-existing errors in unrelated files unchanged)
- [x] `npm run build` — clean (exit 0)
- [x] `node --test lib/dashboard/__tests__/event-recency.test.ts` — 32/32 pass
- [x] `node --test lib/db/__tests__/client-dashboard-aggregations.test.ts` — 69/69 pass

## Notes

- Hook ordering: `cancelledSectionSummary` useMemo placed before the early-return guard (`allVenues.length === 0`) to avoid React's rules-of-hooks violation, consistent with the `pastSectionSummary` fix from PR #381.
- Backwards compatible: events without a `status` column (null/undefined) are treated as non-cancelled, so legacy rows remain unaffected.
