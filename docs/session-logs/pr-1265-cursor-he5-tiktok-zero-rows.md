# Session log

## PR

- **Number:** 1265
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1265
- **Branch:** `cursor/he5-tiktok-zero-rows`

## Summary

The TikTok creatives table was listing snapshot rows that neither spent nor were seen, including Electric's NX Newcastle view (16 rows at £0.00 and 0 impressions, mostly duplicate names). A row is dropped only when spend and impressions are both 0, so a billing correction stays. When none remain, the table shows the existing empty line and the source line does not name TikTok. Never-delivered rows are hidden with no count of how many were left out.

## Scope / files

- `lib/dashboard/creative-section.ts` — drop a TikTok row only when spend and impressions are both 0
- `lib/dashboard/__tests__/creative-section.test.ts`

## Validation

- [x] `node --test lib/dashboard/__tests__/creative-section.test.ts`
- [ ] `frames:check` — CR2's six Jamie Jones rows all have impressions, so the frame is not re-shot

## Notes

Auto-tags on music ads include "Sporting Event" and "Shy Fx Fans". That is tagger quality, known from the genre audit, and it is not this PR.
