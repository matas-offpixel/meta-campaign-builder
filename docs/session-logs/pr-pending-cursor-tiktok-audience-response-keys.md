# Session log — TikTok audience response keys

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/tiktok-audience-response-keys`

## Summary

Prod logs after #790 showed `/search/region/`, `/tool/interest_keyword/recommend/`,
and `/dmp/saved_audience/list/` returning array keys we never read, so those
pickers were silently empty. Add the confirmed keys, log the first row's field
names (never values), trim padded labels, and map official
`interest_category_name` / `sub_category_ids`.

## Scope / files

- `lib/tiktok/audience.ts` — confirmed array keys, rowKeys log, trim, official
  interest category name + parent inversion
- `app/api/tiktok/audience/hashtags/route.ts` — document `keyword` query contract
- `lib/tiktok/__tests__/audience.test.ts`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 3880 = 3864 passed + 13 failed + 3 skipped

## Notes

- Official interest category fields:
  https://ads.tiktok.com/marketing_api/docs?id=1737174348712961
  (`interest_category_id`, `interest_category_name`, `level`, `sub_category_ids`).
- Hashtag query is repeated `keyword`, not `keywords`. `?keywords=techno` is 400
  by design. Validation unchanged.
- Hashtag → `interest_keyword_ids` union unchanged.
