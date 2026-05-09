# Session log — PR #373

## PR

- **Number:** 373
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/373
- **Branch:** `fix/venue-trend-cumulative-source-stitch`

## Summary

Manchester WC26 Daily Tracker and Trend Chart showed tickets on only 2 days
(Apr 28 = 878, May 9 = sparse) despite 259 `ticket_sales_snapshots` rows
spanning Feb 12 → May 9. Root cause: `collapseWeeklyNormalizedPerEvent`
picks ONE dominant source per event — for Croatia/Ghana/Panama that's
`xlsx_import` (priority 3 > fourthefans 2). After the last xlsx_import date
(~Apr 28) those three events went dark. Fix: add `collapseTrendPerEventStitched`
(per-day priority, all dates kept) as a second snapshot array
`trendTicketSnapshots` threaded to the trend chart and tracker, while WoW
computations continue to use `weeklyTicketSnapshots` (dominant-source for
cumulative comparability).

## Scope / files

- `lib/db/event-history-collapse.ts` — new `collapseTrendPerEventStitched` export
- `lib/db/client-portal-server.ts` — `trendTicketSnapshots` field on `ClientPortalData`;
  built in `loadPortalForClientId`, filtered in `loadVenuePortalByToken`
- `components/share/venue-daily-report-block.tsx` — `buildVenueReportModel` +
  `useVenueReportModel` accept optional `trendTicketSnapshots?`; passed to
  `mergeVenueTimeline` → `venueSnapshotTicketDeltas`
- `components/share/client-portal-venue-table.tsx` — prop threading through
  `ClientPortalVenueTable` → `VenueSection` → `buildVenueTrendPoints` →
  `buildVenueTicketSnapshotPoints`
- `components/share/venue-full-report.tsx`, `client-portal.tsx`,
  `dashboard/dashboard-tabs.tsx`, `clients/client-detail.tsx` — prop additions
- 4 app pages — `result.trendTicketSnapshots` to `DashboardTabs` / `VenueFullReport`
- `lib/db/__tests__/event-history-resolver.test.ts` — 8 new tests

## Validation

- [x] `npm test` — 885 tests, 0 failures
- [x] `npm run build` — clean, 0 type errors
- [x] `npx eslint` on all changed files — 0 errors / 0 warnings
- [ ] Manual verify: hard-refresh Manchester WC26 venue report — Daily Tracker
  should show continuous ticket data Feb → May 9 (not just Apr 28 + sparse May)

## Notes

- `collapseTrendPerEventStitched` is semantically identical to `collapseWeekly`
  (named alias for call-site clarity). `collapseWeekly` was already doing
  per-day priority — the missing piece was the code path choosing it over
  `collapseWeeklyNormalizedPerEvent` for the trend consumer.
- WoW computation (`aggregateVenueWoW`) continues to receive `weeklyTicketSnapshots`
  (dominant-source). This preserves cumulative comparability within an event's
  history and prevents phantom WoW regressions (Leeds FA Cup SF -692 from
  historic brief).
- `buildVenueReportModel` and `useVenueReportModel` accept `trendTicketSnapshots`
  as optional (`?`) with a fallback to `weeklyTicketSnapshots` — no existing
  test-only callers break.
- Per-event row totals (602/142/540/78 = 1,362) from PR #372 are unaffected
  by this change — those read from `tier_channel_sales`, not snapshot history.
