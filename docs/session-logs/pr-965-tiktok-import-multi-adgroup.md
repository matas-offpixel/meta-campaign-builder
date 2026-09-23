# Session log template

Copy to `docs/session-logs/pr-{number}-{branch-slug}.md` (use `pr-pending-{branch-slug}.md` until the PR exists).

## PR

- **Number:** 965
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/965
- **Branch:** `cursor/tiktok-import-multi-adgroup`

## Summary

The TikTok importer carried N ad groups when their representable targeting matched, and named the differing field and both values when it did not — instead of refusing solely on count. Matas's live RUDIMENTAL - SIGNUP capture (Smart+, campaign `1877146768391633`) has two ad groups, NEWCASTLE and SECONDARY, whose locations differ; the mapper still refuses that campaign, now with the location values, and the picker lets the operator import one. Matching targeting is carried as two `budgetSchedule.adGroups` with per-group creatives. Uncarriable fields are not part of the comparison.

## Scope / files

- `lib/tiktok/import/adgroup-targeting.ts` — representable targeting compare / named diff / pick-one filter
- `lib/tiktok/import/map.ts` — carry all matching groups; named refuse; `adGroupId` pick; per-group budget and creative assignment
- `lib/tiktok/import/types.ts`, `lib/types/tiktok-draft.ts`, `lib/tiktok-wizard/migrate-draft.ts` — `adgroup_targeting_differs`, `adGroupsCarried`
- `lib/tiktok/import/picker.ts`, `components/tiktok/tiktok-import-picker.tsx`, `lib/tiktok/import/save.ts` — pick one ad group when targeting differs
- Account setup / Review lines for `N ad groups carried`
- Captured fixture `tiktok-import-capture-1877146768391633.json` (raw-route equivalent reads, advertiser `7681317718284304385`)
- Frozen mapped output for the two existing single-ad-group captures

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (6140 pass, 0 fail)

## Notes

RUDIMENTAL is not a matching-targeting campaign. Ages match (18–44); locations do not (NEWCASTLE two Geonames vs SECONDARY six). Pick NEWCASTLE or SECONDARY tonight. Do not take `adGroups[0]` and warn. Launcher / `lib/tiktok/write/**` untouched. `TIKTOK_IMPORT_RELAUNCH_ENHANCEMENTS = "OFF"`. No migration.
