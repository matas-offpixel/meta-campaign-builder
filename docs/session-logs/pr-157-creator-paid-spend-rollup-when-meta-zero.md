# creator: rollup-derived paid spend when Meta cached is null or zero

PR: https://github.com/matas-offpixel/meta-campaign-builder/pull/157

## Summary
- Extracted the venue paid-media model selector into `lib/dashboard/venue-spend-model.ts` so the rollup fallback is unit-testable.
- Updated the rollup fallback to fire when `meta_spend_cached` is `null` or `0`, but only when rollups contain positive paid-media spend.
- Preserved allocator-first behavior and kept positive Meta cached spend on the existing split path.
- Ensured rollup venue display spend wins before reading a zero cached Meta value.

## Validation
- `npm ci` passed.
- `npm test` passed.
- `npm run build` passed.
- Focused ESLint on changed files passed.
- `npm run lint` still fails on pre-existing repo-wide lint errors outside this change set, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, `components/dashboard/events/event-plan-tab.tsx`, `components/report/internal-event-report.tsx`, and `lib/hooks/useMeta.ts`.

## Test Coverage
- Added `lib/dashboard/__tests__/venue-spend-model.test.ts`.
- Covered the TikTok-only case where Meta cached spend is `0` and rollup paid spend is positive.
- Covered zero Meta cached spend with zero rollup spend, which stays on the split path.
- Covered positive Meta cached spend, which continues to use the existing Meta split path.
