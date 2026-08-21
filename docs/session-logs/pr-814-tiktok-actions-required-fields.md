# Session log

## PR

- **Number:** 814
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/814
- **Branch:** `cursor/tiktok-actions-required-fields`

## Summary

The first launch with behaviours selected was rejected with `actions.0.action_period` missing — we sent `action_category_ids` alone. Each actions object now carries the four AdgroupcreateActions fields, using the DMP sibling's documented enums for the choice defaults. `/adgroup/create/` logs the full actions array before the write.

## Scope / files

- `lib/tiktok/write/mapping.ts` — `TIKTOK_ADGROUP_BEHAVIOUR_ACTION_DEFAULTS`
- `lib/tiktok/write/adgroup.ts` — outgoing actions log (extends the #806 pre-write log)
- `lib/tiktok/__tests__/write-mapping.test.ts` / `write-foundation.test.ts`

## Validation

- [x] `npm run build`
- [x] `npx eslint` on changed files
- [x] `npm test` — 4084 = 4068 passed + 13 failed + 3 skipped (pre-existing 13; +2 vs #813's 4082)

## Notes

- SDK model used: `AdgroupcreateActions.md` for field names; `DmpsavedAudiencecreateActions.md` for required-when-actions-specified + enums.
- Rollback for request `202608211826403EAD08F71F250ED15D9B` logged `campaign_id=1874128192803217 outcome=failed error=HTTP 404`. `1874088782701874` was not on that cleanup line.
