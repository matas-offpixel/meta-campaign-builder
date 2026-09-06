# Session log

## PR

- **Number:** 901
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/901
- **Branch:** `cursor/plan-v2-show-close`

## Summary

Show-close write for `campaign_plan_predictions.actual`. `/api/cron/rollup-sync-events` now stamps the plan-window actual once (`closed_reason: 'show'`) for every live plan whose event date is yesterday or earlier (London) and whose prediction rows still have `actual_at` null. Same reader LEARN uses. Idempotent, DB-only, no platform calls. Archive-first keeps `archived`.

## Scope / files

- `lib/plan/show-close.ts` — cutoff + `closeDueShowPredictions`
- `app/api/cron/rollup-sync-events/route.ts` — pass on both the empty-eligibility path and after the event loop
- `lib/plan/__tests__/show-close.test.ts` — yesterday write, second run no-op, archived-first, today left open
- `lib/plan/__tests__/predictions.test.ts` — writer exists with `untilDate: eventDate`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5297 pass, 4 skipped)

## Notes

No migration. Merge after A and B. `planLaunchedAt` still reads `created_at` on main; after B it reads `launched_at`. This pass uses that helper so it picks B up automatically.
