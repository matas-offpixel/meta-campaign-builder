# Session log

## PR

- **Number:** 1105
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1105
- **Branch:** `cursor/ops-truth`

## Summary

The learning-refresh cron log summed a field the runner never returns, so every successful run recorded 0 rows. The tickets freshness alarm treated two listings on one event as growth. A cron that was never built stayed on the alarm list. The portal snapshot cache expired after 15 minutes while the cron runs three times a day. A launch prediction copied the operator's target, and only when that target was filled in. A standalone Meta launch now writes the same prediction when the draft has an event, a unit, and one plan.

## Scope / files

- `lib/learning/runner.ts`, `app/api/cron/learning-refresh/route.ts`
- `lib/ticketing/rollup-tickets-freshness.ts`, `lib/db/rollup-tickets-freshness-load.ts`
- `lib/reporting/cron-alarm-config.ts`
- `lib/reporting/client-portal-snapshot.ts`, `vercel.json` (portal schedule only), the two cron headers
- `lib/plan/launch-prediction.ts`, `app/api/plan/launch/route.ts`, `app/api/meta/launch-campaign/route.ts`

## Validation

- [x] `npm test`
- [x] `npm run build`

## Notes

No migration. No UI.
