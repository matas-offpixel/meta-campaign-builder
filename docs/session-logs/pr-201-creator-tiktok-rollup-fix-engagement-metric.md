# Session Log - TikTok Rollup Engagement Metric Fix

## PR

- **Number:** `201`
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/201
- **Branch:** `creator/tiktok-rollup-fix-engagement-metric`

## Summary

Fixes TikTok daily rollups by dropping invalid AUCTION_CAMPAIGN BASIC metrics `engagements` and `post_engagement`, requesting valid `comments`, `likes`, `shares`, and `follows` metrics instead, and deriving `tiktok_post_engagement` client-side.

## Scope / files

- `lib/tiktok/rollup-insights.ts`
- `lib/tiktok/__tests__/rollup-insights.test.ts`
- `lib/tiktok/breakdowns.ts` was checked and already did not request invalid engagement metrics.

## Validation

- [x] `node --experimental-strip-types --test 'lib/tiktok/__tests__/rollup-insights.test.ts'`
- [x] `npm run lint -- lib/tiktok/rollup-insights.ts lib/tiktok/__tests__/rollup-insights.test.ts lib/tiktok/breakdowns.ts lib/tiktok/__tests__/breakdowns.test.ts`
- [x] `npm run build`
- [x] `npm test`
- [ ] `npm run lint` repo-wide

## Notes

- Repo-wide `npm run lint` still fails on unrelated pre-existing lint debt, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, React hook set-state-in-effect warnings/errors in existing components/hooks, and other unused variables. Touched-file lint passed.
- No schema changes.
- After merge, run Sync now for Rian Brazil Promo, then BB26-RIANBRAZIL, so the rollup rows refresh using the valid TikTok metric set.
