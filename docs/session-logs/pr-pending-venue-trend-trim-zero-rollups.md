# Session log — Trim leading zero-rollup days from venue trend chart

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `fix/venue-trend-trim-zero-rollups`

## Summary

Newly-onboarded events (e.g. Dublin) have ~80 backfilled `event_daily_rollups`
rows carrying numeric zero for all columns (`spend=0`, `revenue=0`,
`tickets_sold=0`, `link_clicks=0`) rather than NULL. The existing
`hasRangeAnchorMetric` used `!== null` as the anchor test, so zero rows
passed through and the X-axis was pushed back to the first backfill date
(~7 Feb), making the chart appear empty for months before real activity began.

Fix: treat null AND zero as "no signal" — only positive values anchor the
trimmed range. Four-line change in `hasRangeAnchorMetric`:
- `spend !== null && spend > 0`
- `revenue !== null && revenue > 0`
- `linkClicks !== null && linkClicks > 0`
- `!hasCumulativeTickets && tickets !== null && tickets > 0`

The cumulative-tickets path is untouched — it uses a different carry-forward
branch and zero there has no special meaning for trim anchoring.

## Scope / files

- `lib/dashboard/trend-chart-data.ts` — `hasRangeAnchorMetric`
- `lib/dashboard/__tests__/trend-chart-data.test.ts` — new test with 80
  leading zero days followed by 5 real days; asserts chart starts on first
  real day

## Validation

- [x] 7/7 tests pass (includes all pre-existing cumulative-tickets tests)
- [x] `npm run lint` clean
- [x] `npm run build` clean (16 s)
