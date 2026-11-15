# Session log

## PR

- **Number:** 1056
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1056
- **Branch:** `cursor/graph-v26-ids-adset-meta`

## Summary

Meta removes the `ids` query parameter on every Graph version on 27 Oct 2026. Ad set facts for the nightly insights job now go through `graphMultiGetByIds`, one Batch API POST per 50 ids, and a guard stops that query (and `pretty`, `debug`, `date_format`, `If-None-Match`) from coming back.

## Scope / files

- `lib/ad-daily-insights/adset-meta.ts` — `fetchAdSetMeta` calls the batch reader.
- `app/api/cron/ad-daily-insights/route.ts`, `lib/ad-daily-insights/objective-backfill.ts`, `scripts/backfill-insights-objective.mts`, `scripts/backfill-ad-daily-insights.mts` — pass `graphMultiGetByIds`.
- `lib/meta/__tests__/graph-v26-request-guard.test.ts` — greps `lib/`, `app/`, and `scripts/`.

## Validation

- [x] `npm test` — 7305 pass, 0 fail, 4 skipped; vitest library rows 8 pass
- [x] `npx tsc --noEmit` — no errors in touched files
- [x] ESLint on touched files
- [x] `npm run build` — succeeded with gitignored `scripts/out` set aside (same as CI), then restored.
- [x] `scripts/backfill-insights-objective.mts --account act_1967530076312 --fetch` — 1 Meta call, 1 ad set resolved (OUTCOME_SALES / OFFSITE_CONVERSIONS, no promoted event). No writes.

## Notes

`graphMultiGetByIds` and `graph-multi-get-parse.ts` are the allowed `ids` parameter. `/debug_token` is a path. `/api/meta/interest-suggestions?debug=1` is our route, not a Graph query.
