# Session log — campaign daily insights

## PR

- **Number:** 958
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/958
- **Branch:** `cursor/campaign-daily-insights`

## Summary

Campaign-grain daily Meta insights now have a store. `campaign_daily_insights`
holds one row per `(meta_campaign_id, date)` so Armed floor 4 can draw a real
14-day series instead of a dashed not-yet. The writer is a pass on
`rollup-sync-events` — the tick that already calls `level=campaign` +
`time_increment=1` — because optimisation-tick's rolling `date_preset` is a
decision read, not a daily series. Upsert, never insert-only. A day Meta
omits is a gap, not a zero. `results` is the resolved primary result (same
candidate list as `live-metric.ts`) so the series is the Armed chip's
denominator, not a bag of action types.

## Scope / files

- `supabase/migrations/178_campaign_daily_insights.sql` — applied to prod 16 Sept night
- `lib/insights/campaign-daily.ts` — window, parse, upsert-merge, sync
- `lib/insights/campaign-daily-fetch.ts` — Graph fetch, injected client
- `lib/insights/campaign-daily-cron.ts` — production adapter (relative imports)
- `lib/db/campaign-daily-insights.ts` — load armed drafts + upsert
- `app/api/cron/rollup-sync-events/route.ts` — pass even when no events
- `scripts/backfill-campaign-daily-insights.ts` — 14-day, dry-run default; does not import `lib/meta/client.ts` so `node --experimental-strip-types` can run it
- `lib/insights/campaign-daily.ts` — window, parse, upsert-merge, sync
- `lib/insights/campaign-daily-fetch.ts` — Graph fetch, injected client
- `lib/insights/campaign-daily-cron.ts` — production adapter
- `lib/db/campaign-daily-insights.ts` — load armed drafts + upsert
- `app/api/cron/rollup-sync-events/route.ts` — pass even when no events
- `scripts/backfill-campaign-daily-insights.ts` — 14-day, dry-run default

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 6055 pass, 0 fail, 4 skipped

## Notes

- Owner is `rollup-sync-events`, not a new cron and not optimisation-tick.
  The ruling named that tick because it already pays for this Graph shape.
- Migration 178 **applied to prod** 16 Sept night (`campaign_daily_insights` in `schema_migrations`). This repo's GitHub CI uses `https://example.supabase.co` — there is no separate CI project in the MCP org to apply to (CIRQLIN is a different app).
- Backfill dry-run then `--apply`: **62 rows** across **10** armed campaigns (one armed campaign had no Meta days in the window). Not 14×10 — Meta only returned the days it had. Gaps inside a span are absent rows (two campaigns each miss 2 days). A day Meta returns as zeros is stored as zeros, not invented.
- Floor 4 stays a not-yet in PR C until this store is read. The morning check `≥ 14 × armed campaigns` will not pass: the longest series is 12 days, one campaign has 1. That is the truth, not a failed writer.
- Finding 1: 3,597 wrote nothing — most because there was nothing to write.
  Not repeated as "were shadow".
- Per-ad-set daily grain is not this PR (finding 2).
- R9 (armed campaigns ticking against passed events) is not this PR.
- `drawer.test.ts` launch.ts companion: #957 asserted 5 hunks vs `origin/main`.
  After merge that is 0. Same empty-diff freeze preflight already had; the
  overlay is still asserted in the file.
