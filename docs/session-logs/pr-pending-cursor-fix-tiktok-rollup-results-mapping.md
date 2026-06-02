# Session log — TikTok rollup results mapping fix

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/fix-tiktok-rollup-results-mapping`

## Summary

Fixes VIEW_CONTENT-optimised TikTok campaigns writing the wrong values into `event_daily_rollups`: pixel conversions (`conversion` / `complete_registration`) now sum to `tiktok_results`, while `view_content` sums to `tiktok_engagement_results`. Resolves Ironworks showing 17 conversions instead of 173.

## Scope / files

- `lib/tiktok/optimization-goal-map.ts` — dual-metric goals (`rollupConversionKey` + `rollupEngagementKey`), `resolveRollupCountsFromMetrics()`
- `lib/tiktok/rollup-insights.ts` — uses dual-metric resolver per campaign-day row
- `lib/tiktok/insights.ts` — VIEW_CONTENT fetches `complete_registration`; campaign results use conversion count
- `lib/tiktok/rollup-totals-display.ts` — VIEW_CONTENT campaign rows show both conversion + engagement
- Tests: `rollup-insights-tiktok-results.test.ts`, updates to insights/optimization-goal-map/rollup-totals-display

## Validation

- [x] `npm run build` — pass
- [x] `lib/tiktok/__tests__/*.test.ts` — 114/114 pass

## Notes

- After deploy, re-run rollup sync for Ironworks to backfill `tiktok_results=173` and `tiktok_engagement_results≈488k`.
- Migration 103 (`tiktok_engagement_results` column) must be applied if not already.
