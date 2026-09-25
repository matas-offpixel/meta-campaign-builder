# Session log

## PR

- **Number:** 983
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/983
- **Branch:** `cursor/existing-post-website-url`

## Summary

An Instagram Reel boosted into an offsite campaign was refused with subcode 2061015 because the creative payload dropped the destination URL. The payload now sends that URL as `call_to_action.value.link` when the operator set one. Step 5 requires it only for an Instagram video.

## Scope / files

- `lib/meta/creative.ts` — existing-post `call_to_action`
- `lib/validation.ts` — Instagram video in an offsite campaign
- `lib/meta/launch-error-classify.ts` — subcode 2061015
- `components/steps/creatives.tsx` — store the picked post's media kind

## Validation

- [x] `npm test` — 6303 pass, 3 skipped
- [x] `npm run build`
- [ ] check runs (reported in the thread, not in this file)

## Notes

SCHAK signup `120251738050060755`: 14 boosted ads, 13 creatives, all the same Reel `18149952778529453`, created 2026-09-23 in Ads Manager, none delivering. Destination is `call_to_action.value.link` = `https://www.schak-newcastle.com/`. On Sale launch the same day: Feed Post v1 (that Reel) created no ads; Feed Post v2 (feed carousel `18124756982308464`, creative `1440308838050275`) linked with no call to action. Page-post read was refused for `pages_read_engagement`.
