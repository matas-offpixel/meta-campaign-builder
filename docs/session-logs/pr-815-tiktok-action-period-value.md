# Session log

## PR

- **Number:** 815
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/815
- **Branch:** `cursor/tiktok-action-period-value`

## Summary

#814 borrowed `action_period: 0` from the saved-audience model. The live `/adgroup/create/` endpoint rejected it (`40002` "Invalid time period set for behavior targeting.", request `20260821191646DAEFF0B9BC2AA7DA28AE`). VIDEO_RELATED now uses the documented 15-day window (Ads Manager default; broadest non-zero of 7 | 15).

## Scope / files

- `lib/tiktok/write/mapping.ts` — scene-dependent `TIKTOK_ADGROUP_ACTION_PERIOD_BY_SCENE`; defaults use VIDEO_RELATED → 15
- `lib/tiktok/__tests__/write-mapping.test.ts` — constant cannot be 0; no-behaviours still omits `actions`

## Validation

- [x] `npm run build`
- [x] `npx eslint` on changed files + `npm run lint`
- [x] `npm test` — 4085 = 4069 passed + 13 failed + 3 skipped (pre-existing 13; +1 vs #814's 4084)

## Notes

- Source: TikTok Marketing API Create an ad group, actions / behaviour-targeting section — https://ads.tiktok.com/marketing_api/docs?id=1739499616346114
- `AdgroupcreateActions.md` still has no enums. Did not re-borrow 0 from `DmpsavedAudiencecreateActions`.
- `video_user_actions` AND vs OR is not stated in that page. Left all four as Ads Manager's default. Check audience size on the next launch.
