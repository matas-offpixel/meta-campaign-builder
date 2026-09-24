# Session log

## PR

- **Number:** 975
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/975
- **Branch:** `cursor/tiktok-cover-image`

## Summary

TikTok cover upload was failing with `Duplicate material name.` and the catch swallowed it, so launch preflight only said the cover was missing. A failed cover is now stored on the creative, shown on the Creatives row, and repeated in preflight. A duplicate file name is retried once under a unique name.

## Scope / files

- `lib/tiktok/write/cover-image.ts`
- `lib/tiktok/write/preflight.ts`, `launch.ts` (persist the failure; `launchPaused` unchanged)
- Creatives step row and `POST /api/tiktok/creative/cover`
- Captured log fixture `lib/tiktok/__fixtures__/captured/tiktok-cover-duplicate-material-name-2026-09-24.json`

## Validation

- [x] `npm test` (6244 pass, 4 skipped)
- [x] `npm run build`

## Notes

Production log on `dpl_JBEKGK9HbhdVnfRkCWoLvZsntFJN`, 2026-09-24 16:15:48, `POST /api/tiktok/launch-campaign`: all five creatives logged `failed: Duplicate material name.` The cover URL had resolved. Not an unfetchable CDN URL.
