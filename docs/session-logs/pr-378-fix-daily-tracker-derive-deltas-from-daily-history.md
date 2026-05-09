# Session log — fix(daily-tracker): derive per-day tickets and revenue deltas from tier_channel_sales_daily_history

## PR

- **Number:** 378
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/378
- **Branch:** `fix/daily-tracker-derive-deltas-from-daily-history`

## Summary

Post-PR #376 the Daily Tracker showed correct cumulative totals (trend chart + Running Tickets)
but mostly empty per-day TICKETS and REVENUE columns. The ticket deltas were being derived from
the sparse `ticket_sales_snapshots` envelope (a few dates: Apr 28, May 1, May 7 for Manchester
WC26) rather than the 31 daily rows in `tier_channel_sales_daily_history`. Revenue deltas were
only showing for the last ~3 days because they came exclusively from `event_daily_rollups`.

Fix: added `buildVenueDailyHistoryTimelines` to `venue-trend-points.ts` — a pure function that
computes venue-wide cumulative ticket + revenue timelines directly from daily_history rows using
per-event carry-forward, then sums per calendar date. Updated `mergeVenueTimeline` to accept
these timelines and use them as the primary delta source, with the existing snapshot-envelope
path as a fallback for dates not covered by daily_history. Revenue now derives from
`revenue_total` deltas in daily_history when present.

## Scope / files

- `lib/dashboard/venue-trend-points.ts` — new `buildVenueDailyHistoryTimelines` export
- `components/share/venue-daily-report-block.tsx` — `buildVenueReportModel` computes
  `dailyHistoryTimelines` and passes to updated `mergeVenueTimeline`; `mergeVenueTimeline`
  signature gains `dailyHistoryTimelines` param; revenue fallback extended
- `lib/dashboard/__tests__/daily-history-timelines.test.ts` — 17 new tests covering
  Manchester 31-day scenario, single-day edge case, gap handling, revenue derivation,
  no-double-counting invariant, and fallback to empty arrays

## Validation

- [x] `npm run lint` — 0 new errors (16 pre-existing errors unrelated to this change)
- [x] `npm run build` — clean
- [x] `npm test` — 940 pass, 0 fail (940/940 including 17 new tests)

## Notes

- Spend column (`ad_spend`, `tiktok_spend`) unchanged — still reads from `event_daily_rollups`.
- CPT tooltip in trend chart unchanged (lifetime/lifetime from PR #374).
- CL Final venues and single-event venues without daily_history fall back gracefully: empty
  arrays → `histTicketDeltas.size === 0` → fallback to `snapshotDeltas`; empty revenue →
  fallback to `venueSnapshotRevenueDeltas` when rollupRevenueTotal === 0.
- Gap handling: dates not present in daily_history have no delta from the history path; the
  snapshot-envelope fills in for those dates via the merged `effectiveTicketDeltas` Map.
