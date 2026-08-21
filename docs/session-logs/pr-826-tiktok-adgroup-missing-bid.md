# Session log

## PR

- **Number:** 826
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/826
- **Branch:** `cursor/tiktok-adgroup-missing-bid`

## Summary

Null `bidStrategy` was treated as `BID_TYPE_NO_BID`, so a Target CPC typed in Step 2 never reached TikTok. Launch now blocks when the strategy is missing, `targetCostPerResult` is the CONVERT/VALUE cost-cap bid, and Review warns when the strategy is unset.

## Scope / files

- `lib/tiktok/write/mapping.ts` — fail closed on null bid strategy; CONVERT/VALUE read `targetCostPerResult`
- `lib/tiktok/write/preflight.ts` — blocking issue when bid strategy is null
- `lib/tiktok-wizard/review.ts` — Review checklist item for bid strategy
- `lib/types/tiktok-draft.ts` — `TikTokOptimisation.targetCostPerResult`
- `components/tiktok-wizard/steps/optimisation-strategy.tsx` — bid strategy + target cost next to money inputs
- `components/tiktok-wizard/steps/campaign-setup.tsx` — warning when unset; persist both bid fields
- `components/tiktok-wizard/steps/review-launch.tsx` — Bid strategy KeyValue warning
- `lib/tiktok/write/__tests__/bid-payload.test.ts`

## Validation

- [x] `npm run build`
- [x] `npm test` — 4147 = 4131 passed + 13 failed + 3 skipped (pre-existing 13 unchanged)
- [x] `npx eslint` on changed files

## Notes

Follow-up: migrate backfills `targetCostPerResult` from benchmarks for COST_CAP + CONVERSION/VALUE. `saveBidStrategy` sends `{ bidStrategy }` through `applyTikTokCampaignSetupPatch` so a stale optimisation snapshot cannot overwrite the money fields.
