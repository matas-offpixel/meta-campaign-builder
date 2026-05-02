## PR

- **Number:** 231
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/231
- **Branch:** `creator/cron-meta-campaign-eligibility-fallback`

## Summary

Extends the active-creatives and rollup-sync cron eligibility filters so on-sale/live events with populated `event_code` stay eligible for Meta campaign matching even without ticketing-link rows or recent `general_sale_at` values.

## Scope / files

- `lib/dashboard/cron-eligibility.ts` centralises cron eligibility set loading and merge rules.
- `app/api/cron/refresh-active-creatives/route.ts` now unions linked-and-dated eligibility with event-code matches.
- `app/api/cron/rollup-sync-events/route.ts` now unions ticketing, sale-date, Google Ads, and event-code matches.
- `lib/dashboard/__tests__/cron-eligibility.test.ts` covers the fallback and exclusion rules.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run lint -- app/api/cron/refresh-active-creatives/route.ts app/api/cron/rollup-sync-events/route.ts`
- [x] `npm run lint -- lib/dashboard/cron-eligibility.ts lib/dashboard/__tests__/cron-eligibility.test.ts`
- [x] `node --experimental-strip-types --test lib/dashboard/__tests__/cron-eligibility.test.ts`
- [x] `npm test`

## Notes

No migrations or runner logic changes. Runners already handle no matching Meta campaigns gracefully.
