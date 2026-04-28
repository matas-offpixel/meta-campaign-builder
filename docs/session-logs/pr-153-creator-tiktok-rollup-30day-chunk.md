## PR

- **Number:** 153
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/153
- **Branch:** `creator/tiktok-rollup-30day-chunk`

## Summary

Chunk TikTok AUCTION_CAMPAIGN BASIC rollup insight requests into serial 30-day windows so the 60-day rollup-sync range no longer trips TikTok's report window cap.

## Scope / files

- `lib/tiktok/rollup-insights.ts` now builds inclusive <=30-day sub-windows and runs the existing pagination loop once per slice.
- Campaign enrichment, event-code matching, and per-day aggregation still run after every slice has been collected.
- `lib/tiktok/__tests__/rollup-insights.test.ts` covers two-slice accumulation, 30-day boundary behavior, and 60-day split behavior.

## Validation

- [x] `npx tsc --noEmit`
- [ ] `npm run lint` (fails on pre-existing baseline issues in untouched files; changed files are lint-clean)
- [x] `npm run build`
- [x] `npm test`

## Notes

No schema change. `TIKTOK_CHUNK_CONCURRENCY = 1` remains load-bearing: slices and pages run serially.
