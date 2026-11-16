# Session log

## PR

- **Number:** 1265
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1265
- **Branch:** `cursor/he5-tiktok-zero-rows`

## Summary

The TikTok creatives table was listing snapshot rows that had no impressions in the period, including Electric's NX Newcastle view (16 rows at £0.00 and 0 impressions, mostly duplicate names). Those rows are left out. When none remain, the table shows the existing "No TikTok creatives for this show yet." line, and the source line does not name TikTok.

## Scope / files

- `lib/dashboard/creative-section.ts` — drop TikTok rows with no impressions
- `lib/dashboard/__tests__/creative-section.test.ts`

## Validation

- [x] `node --test lib/dashboard/__tests__/creative-section.test.ts`
- [ ] `frames:check` — CR2's six Jamie Jones rows all have impressions, so the frame is not re-shot

## Notes

Auto-tags on music ads include "Sporting Event" and "Shy Fx Fans". That is tagger quality, known from the genre audit, and it is not this PR.
