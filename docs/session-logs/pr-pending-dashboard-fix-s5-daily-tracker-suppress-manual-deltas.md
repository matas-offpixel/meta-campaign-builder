# Session log — S5/H tracker hygiene: suppress manual ticket_sales_snapshots from daily-delta path

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/dashboard-fix-s5-daily-tracker-suppress-manual-deltas`

## Summary

Stops reconciliation-source rows in `ticket_sales_snapshots` (source='manual'
or 'xlsx_import') from leaking as phantom daily sales in the tracker. Bug H
from the 2026-06-04 audit (PR #536): after the PR #530 SQL topups, Manchester
showed +43 tickets on Jun 4 in the Performance Summary WoW chip (truth: +19
from the daily_history cron). The root cause was two propagation paths reading
the naïve snapshot envelope instead of the authoritative corroborated series.

Two-layer fix:

**Layer 1 — Delta builder.** `buildEventCumulativeTicketTimeline` now tags
steps where every contributing snapshot row is a reconciliation source
(`isReconciliation: true`). `ticketDeltasFromCumulativeTimeline` advances the
running baseline (so subsequent organic deltas are correctly re-based against
the raised ceiling) but does NOT emit a delta for reconciliation steps. This
suppresses phantom deltas in the no-daily_history/no-rollup path used by
venues like Glasgow SWG3.

**Layer 2 — WoW chip.** `ClientPortalVenueTable` now filters
`RECONCILIATION_SNAPSHOT_SOURCES` rows out of `weeklyTicketSnapshots` before
passing to `aggregateVenueWoW`. Manual rows have the highest source priority
(4), causing them to dominate `collapseWeeklyNormalizedPerEvent` and inflate
the "current week" cumulative used by the WoW ticket delta chip.

New constant `RECONCILIATION_SNAPSHOT_SOURCES` (manual, xlsx_import) is
deliberately separate from `MANUAL_SOURCE_KINDS` (which lives on
`tier_channel_sales_daily_history` and has opposite semantics — bypass the
corroboration gate to surface real sales).

## Scope / files

- `lib/dashboard/venue-trend-points.ts` — `RECONCILIATION_SNAPSHOT_SOURCES`
  constant; `CumulativeTicketStep.isReconciliation?`; tracking in
  `buildEventCumulativeTicketTimeline`; propagation through
  `buildVenueTicketSnapshotPoints` → `buildVenueCumulativeTicketTimeline`;
  suppression in `ticketDeltasFromCumulativeTimeline`
- `lib/dashboard/trend-chart-data.ts` — `TrendChartPoint.isReconciliation?`
  (optional, chart renderers ignore it)
- `components/share/client-portal-venue-table.tsx` — `wowTicketSnapshots`
  useMemo that filters reconciliation sources before WoW aggregation
- `lib/dashboard/__tests__/corroborated-daily-deltas.test.ts` — 15 new tests
  covering `RECONCILIATION_SNAPSHOT_SOURCES` membership, delta suppression,
  baseline advancement, gap-fill carry-forward, xlsx_import parity, and the
  Manchester Jun-4 regression (+19 from corroborated history, not +43 from
  snapshot diff)

## Validation

- [x] 36 unit tests pass (`node --experimental-strip-types --test lib/dashboard/__tests__/corroborated-daily-deltas.test.ts`)
- [x] `npm run build` clean (0 new errors)
- [x] Pre-existing lint errors in `client-portal-venue-table.tsx` (lines 2613, 2648: setState in effect) confirmed pre-existing on main, not introduced here

## Notes

- Envelope ceiling stays correct: manual rows still raise `runningMax`, so
  lifetime totals (1,001 for Manchester, 3,389 for Glasgow SWG3) are
  unaffected.
- Bristol/Aberdeen (no recent manual topups) are unaffected — their snapshot
  sources remain eventbrite/fourthefans.
- `RECONCILIATION_SNAPSHOT_SOURCES` is the single point of truth. Do not
  widen it beyond manual/xlsx_import — eventbrite, fourthefans, foursomething
  are real-time sources that MUST continue to emit deltas.
- Cross-ref: PR #536 (audit), PR #530 (topups that exposed the bug), PR #438
  (corroboration architecture).
