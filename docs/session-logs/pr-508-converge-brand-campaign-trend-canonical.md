# Session log — converge brand-campaign trend chart on canonical pipeline

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/converge-brand-campaign-trend-canonical`

## Summary

Deletes the divergent `lib/mailchimp/trend-data.ts` aggregator (introduced across PRs #500–#507) and replaces it with the canonical `aggregateTrendChartPoints` pipeline used by the event-kind VenueTrend. Email subscribers now map onto the `ticketsKind: "cumulative_snapshot"` flag, activating carry-forward and lifetime-spend/lifetime-subscribers CPR math automatically — the same arithmetic the venue trend chart uses for ticket CPT. Weekly bucketing is handled by the aggregator with no manual code path.

## Scope / files

- **DELETED** `lib/mailchimp/trend-data.ts` — divergent `computeMailchimpTrendPoints` path removed
- **DELETED** `lib/mailchimp/__tests__/trend-data.test.ts` — tests for deleted module
- **DELETED** `__tests__/share-report/cpr-chart-total-based.test.ts` — asserted wrong behaviour (weekly_spend / lifetime_subs)
- **NEW** `lib/dashboard/brand-campaign-trend-points.ts` — `buildBrandCampaignTrendPoints`, canonical TrendChartPoint builder for brand_campaign events
- **MODIFIED** `lib/dashboard/venue-trend-points.ts` — added `buildMailchimpRegistrationSnapshotPoints`, sibling to `buildVenueTicketSnapshotPoints`
- **MODIFIED** `components/dashboard/events/event-trend-chart.tsx` — `BrandCampaignTrendChart` now calls `buildBrandCampaignTrendPoints → aggregateTrendChartPoints`; removed `buildBrandRows` and manual weekly aggregation; removed `impressions` metric (not in canonical aggregator)
- **NEW** `lib/dashboard/__tests__/brand-campaign-trend-points.test.ts` — 19 tests: snapshot-points helpers, cross-platform spend, Ironworks-shape fixture asserting carry-forward, per-day spend, lifetime CPR, and weekly bucketing

## Validation

- `npx tsc --noEmit` — no new errors in changed files
- `npm run build` — passes
- `npm test` — 1999 tests, 5 pre-existing failures, 0 new failures
- 19 new unit tests all pass
