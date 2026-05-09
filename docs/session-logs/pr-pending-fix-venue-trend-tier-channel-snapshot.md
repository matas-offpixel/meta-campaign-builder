# Session log: fix/venue-trend-tier-channel-snapshot

## PR

- **Number:** pending
- **URL:** _set after `gh pr create`_
- **Branch:** `fix/venue-trend-tier-channel-snapshot`

## Summary

Fixes three related Manchester WC26 venue full-report bugs caused by the
source-stitch trend layer (PR #373) comparing cumulative ticket totals
across data sources with different channel coverage:

1. **Phantom ticket drops.** Apr 28 = 878 (`xlsx_import` all-channel) →
   Apr 29 = 284 (`fourthefans` only sees fourthefans-channel). The
   trend chart showed a 590-ticket overnight cliff that did not exist.
2. **Sparse Daily Tracker tickets column.** Most days rendered `—`
   because the per-day source-priority pick produced zero deltas
   whenever no fresh snapshot was captured.
3. **Wrong CPT tooltip.** "Spend £92.86 / Tickets 843 / CPT £0.11" on
   Mon 4 May — divided one-day spend by lifetime cumulative tickets,
   meaningless mix of denominators.

The fix builds a per-event monotonic-envelope cumulative timeline from
`ticket_sales_snapshots` (running max across sources) and anchors today
to the per-event `tier_channel_sales` SUM (the same source-of-truth
the Event Breakdown row already reads via PR #372). The trend chart,
the Daily Tracker tickets column, and the venue-card mini-trend now
all consume the same monotonic timeline. CPT in cumulative mode is
recomputed as `running_lifetime_spend ÷ cumulative_tickets`.

The WoW path is untouched: `weeklyTicketSnapshots`
(`collapseWeeklyNormalizedPerEvent`, dominant-source per event) is
still consumed by week-over-week consumers; only the trend/tracker
path (`trendTicketSnapshots` + the new envelope) was changed.

## Scope / files

Implementation:

- `lib/dashboard/venue-trend-points.ts` — new
  `buildEventCumulativeTicketTimeline` (running-max envelope across
  sources + tier-channel today anchor),
  `buildVenueCumulativeTicketTimeline`,
  `ticketDeltasFromCumulativeTimeline`, `todayInLondon`. Existing
  `buildVenueTicketSnapshotPoints` rewritten on top of the envelope.
- `lib/dashboard/trend-chart-data.ts` — `aggregateTrendChartPoints`
  now computes lifetime/lifetime CPT in cumulative mode (daily and
  weekly paths). `trimEmptyRange` keeps a trailing
  `cumulative_snapshot` day even when it has no spend (the today
  anchor case).
- `components/share/venue-daily-report-block.tsx` —
  `buildVenueReportModel` produces `cumulativeTicketPoints`,
  `mergeVenueTimeline` consumes `cumulativeTicketTimeline` via
  `ticketDeltasFromCumulativeTimeline`, `VenueTrendChartSection`
  composes spend dayPoints + cumulative tickets points so the chart
  hits the new aggregator path.
- `components/share/client-portal-venue-table.tsx` —
  `buildVenueTrendPoints` accepts and forwards `tierChannelAnchors`;
  `VenueSection` builds them from `group.events`.

Tests:

- `lib/dashboard/__tests__/venue-trend-points.test.ts` —
  envelope/anchor unit tests + Manchester WC26 scenario (Apr 28 = 878,
  no Apr 29 phantom drop, today = 1,362 tier-channel SUM, monotonic
  non-decreasing) + `ticketDeltasFromCumulativeTimeline` correctness +
  CL Final no-anchor regression guard.
- `lib/dashboard/__tests__/trend-chart-data.test.ts` —
  lifetime/lifetime CPT for daily and weekly aggregation, Mon 4 May
  Manchester tooltip assertion that the new value differs from the
  broken £92.86 / 843 ≈ £0.11.

## Validation

- [x] `npm run lint` — no new errors in touched files (16 pre-existing
  errors on main, unchanged: `lib/hooks/useMeta.ts`,
  `app/auth/facebook-error/page.tsx`, etc.)
- [x] `npm test` — 901 pass, 1 pre-existing skip, 0 fail (902 total)
- [x] `npm run build` — clean

## Notes

Non-regression items confirmed:

- **CL Final venues** (single-source `tier_channel_sales` after PR
  #367 backfill) — explicit unit test "CL Final / single-source
  venue with no anchor: trend unchanged".
- **WoW deltas** still consume `weeklyTicketSnapshots` produced by
  `collapseWeeklyNormalizedPerEvent` — that data path is untouched.
- **Presale row** still slices the same timeline, but
  `tickets_sold` per row now comes from envelope deltas (no negative
  contributions), so presale totals are stable rather than swinging
  on source-coverage transitions.
- **Day-boundary timezone** — `todayInLondon()` uses `Intl
  .DateTimeFormat('en-CA', { timeZone: 'Europe/London' })` to anchor
  today's `tier_channel_sales` SUM in client tz.

Follow-ups:

- A future PR could replace the today-only `tier_channel_sales`
  anchor with an actual per-day history table once the upsert table
  is augmented (or shadowed by a daily snapshot job). For now, the
  envelope + today-anchor pair gets us to a smooth monotonic curve
  that matches the Event Breakdown lifetime totals.
