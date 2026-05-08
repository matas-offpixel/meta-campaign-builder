# Session log — Venue trend chart: combine snapshot + rollup tickets

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `fix/venue-trend-snapshot-rollup-union`

## Summary

Manchester WC26 venue trend chart showed a flat zero tickets line despite 259 cumulative snapshot rows (Eventbrite/FourtheFans data spanning Feb 12 → May 8). Root cause: two gated `if (!hasRollupTickets)` / `if (rollupTicketTotal === 0)` conditions blocked ALL snapshot data from being added whenever even a single day of `tickets_sold` landed in the rollup table (meta_regs = 4 from today's on-Meta conversions). Fix: always use snapshot data when present; suppress rollup tickets_sold to prevent the aggregator's cumulative-mode carry-forward from treating meta_regs=4 as the new cumulative total (which would have dropped the chart from 699 → 4 on today's date).

## Scope / files

- `lib/dashboard/venue-trend-points.ts` — NEW: extracted `buildVenueTicketSnapshotPoints` from component to lib so it's unit-testable. Includes full inline doc explaining the cumulative-vs-additive mixing hazard.
- `components/share/client-portal-venue-table.tsx` — Import from lib; rewrite `buildVenueTrendPoints` to compute snapshot points first, set `hasRollupTickets = !hasSnapshotTickets && ...`, always push snapshot points (removes the `!hasRollupTickets` gate).
- `components/share/venue-daily-report-block.tsx` — Fix `mergeVenueTimeline`: remove `rollupTicketTotal === 0` gate; always compute `snapshotDeltas`, clear rollup `tickets_sold` when snapshot data exists, add deltas. Remove now-unused `rollupTicketTotal` variable.
- `lib/dashboard/__tests__/venue-trend-points.test.ts` — NEW: 8 tests: snapshot point building (empty, single event, four Manchester fixtures, carry-forward), Manchester regression scenario (699 survives), pre-fix bug illustration, rollup-only still works, mixed events.

## Validation

- [x] `npm run lint` — no new errors in modified files
- [x] `npm run build` — clean
- [x] `npm test` — 831 tests, 830 pass, 1 pre-existing skip, 0 fail

## Notes

- The aggregator carry-forward (hasCumulativeTicketPoints path in trend-chart-data.ts) was NOT modified — this PR only unblocks the venue-trend-builder from feeding it the snapshots.
- `mergeVenueTimeline` fix uses the delta approach (week-over-week increments). This shows incremental ticket sales on the daily tracker/trend chart, not a smooth cumulative line. The cumulative line (carry-forward) requires the `buildVenueTrendPoints` → `points` prop path; both now work correctly.
- Other venues without snapshot history (London groups, BB26 awareness) are unaffected: `snapshotDeltas.size === 0` → the timeline's rollup tickets_sold is preserved as-is.
