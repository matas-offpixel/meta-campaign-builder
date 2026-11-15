# Session log

## PR

- **Number:** 1067
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1067
- **Branch:** `cursor/mml-tiktok-minimums`

## Summary

TikTok's £50 floor is the campaign budget. Ad groups floor at £20/day, matching Puzzle's live campaign. A TikTok share under £50 leaves the campaign budget unset. An optional target cost is written as `conversion_bid_price` when the goal is CONVERT, and omitted when the field is empty.

## Scope / files

- `lib/tiktok/write/mapping.ts`, `lib/tiktok/write/preflight.ts` — ad-group floor £20, campaign floor £50 only when a campaign budget is set, `BUDGET_MODE_INFINITE` when it is unset
- `lib/plan/mml-budget.ts`, `lib/plan/adapters/tiktok.ts`, `components/wizard/mml-step-budget.tsx` — step 6 split and the target-cost field
- TikTok creator budget step and Review

## Validation

- [x] `npx tsc --noEmit` — no new errors in touched files
- [x] `npm run build`
- [x] `npm test` — 7378 passed, 4 skipped, plus 8 vitest

## Notes

The 40002 request body for `202608210618444D942991BC30CBAA9000` is not stored. `tiktok_write_idempotency` keeps a payload hash, not the body. Puzzle's live read is the confirmation used here: campaign `BUDGET_MODE_DAY` £50, ad group `BUDGET_MODE_DAY` £20, `bid_type` `BID_TYPE_CUSTOM`, `conversion_bid_price` 10, `optimization_goal` `CONVERT`, `optimization_event` `SHOPPING`. MML sets the campaign budget to the TikTok share when that share is at least £50/day, and leaves it unset below that.
