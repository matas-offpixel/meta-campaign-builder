# Session log — asset queue regression fixes (Colin Hendry Glasgow)

## PR

- **Number:** 587
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/587
- **Branch:** `cursor/asset-queue-regression-fixes`

## Summary

Three production regressions from Colin Hendry Glasgow launch: NULL `resolved_event_code` after SQL reset, empty `generated_url`, and 9:16-only Meta preview (BOOK_NOW + dual-aspect Meta API constraint).

## Fixes

1. **Re-resolve at prepare** — `resolveQueueRowVenue()` + persist `resolved_event_code` on prepare when NULL
2. **Destination URL** — load event by code; organiser URL fallback + empty-URL Vercel log
3. **Per-placement** — `4x5`/`9x16` filename hints; BOOK_NOW+dual UI warning; asset_queue wire payload logging

## Validation

- [x] `node --experimental-strip-types --test lib/clients/asset-queue/__tests__/aspect-detect.test.ts`
- [ ] Prepare jest test (CI)
- [ ] Colin Hendry re-prepare smoke
