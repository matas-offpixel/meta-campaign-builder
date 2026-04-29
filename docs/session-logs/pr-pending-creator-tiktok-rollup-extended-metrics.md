# creator: extended TikTok metric coverage + breakdowns cron (migration 059)

PR: pending

## Summary
- Added migration `059_tiktok_rollup_breakdowns_and_metrics.sql`.
- Extended `event_daily_rollups` with TikTok reach, 2s/6s/100% video views, average play time, and post engagement columns.
- Extended `fetchTikTokDailyRollupInsights` and `upsertTikTokRollups` so the TikTok-owned rollup leg writes the new `tiktok_*` columns without touching Meta spend/click/reg fields.
- Added `lib/tiktok/breakdowns.ts` for API-sourced country, region, city, age, gender, age_gender, and interest-category breakdown snapshots with 30-day chunking and one retry for TikTok 50001.
- Added `/api/cron/tiktok-breakdowns` and registered it in `vercel.json` at `30 */6 * * *`, offset from TikTok active creatives at `:15`.
- No share-report render files were changed in this PR.

## Migration Note
Migration `supabase/migrations/059_tiktok_rollup_breakdowns_and_metrics.sql` must be applied via Cowork MCP after merge. PR-β is gated on this migration being applied.

## Validation
- `npm ci` passed.
- `npm test` passed.
- `npm run build` passed.
- Focused ESLint on touched files passed.
- `npm run lint` still fails on the existing repo-wide lint baseline outside this PR, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, `components/dashboard/events/event-plan-tab.tsx`, `components/report/internal-event-report.tsx`, and `lib/hooks/useMeta.ts`.

## Tests
- Extended `lib/tiktok/__tests__/rollup-insights.test.ts` for the new metric columns.
- Added `lib/tiktok/__tests__/breakdowns.test.ts` for dimension fetch shape, 50001 retry, 30-day chunking, and skip/error write refusal.
- Extended `lib/dashboard/__tests__/rollup-sync-runner.test.ts` so the TikTok leg coverage includes the new reach/video bucket columns and still confirms no Meta-owned columns are written.
