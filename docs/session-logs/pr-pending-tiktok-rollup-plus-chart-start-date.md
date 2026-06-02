# Session log template

Copy to `docs/session-logs/pr-{number}-{branch-slug}.md` (use `pr-pending-{branch-slug}.md` until the PR exists).

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/tiktok-rollup-plus-chart-start-date`

## Summary

Fixes two brand_campaign share-report integrity gaps: TikTok rollup cron now requests the full dual-metric field list per account (not goal-filtered batches), resolves conversion + engagement per campaign with diagnostic logs, and sums into `tiktok_results` / `tiktok_engagement_results`. Daily Trend charts for brand campaigns anchor on the earliest spend or Mailchimp registration day so pre-spend subscriber growth is visible.

## Scope / files

- `lib/tiktok/rollup-insights.ts` — unified metric list, per-campaign resolver, diagnostic logging
- `lib/tiktok/optimization-goal-map.ts` — `real_time_conversion` fallback
- `lib/dashboard/tiktok-rollup-leg.ts` — pass `eventId` for logs
- `lib/dashboard/trend-chart-data.ts` — `leadingAnchor: spend_or_registrations`
- `components/dashboard/events/event-trend-chart.tsx` — brand chart uses new anchor
- Tests: rollup-sync-runner-tiktok, brand-campaign-chart-start-date, brand-campaign-chart-from-zero

## Validation

- [x] `npx tsc --noEmit` (pre-existing unrelated errors in other test files)
- [x] `npm run build`
- [x] Targeted unit tests for changed paths (all pass)

## Notes

After deploy, re-run rollup cron for Ironworks (`68535c85-0394-435f-9439-245dd2e87043`) and grep logs for `[rollup-sync-tiktok]` to confirm conv/eng per campaign.
