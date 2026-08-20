# Session log — TikTok targeting v1

## PR

- **Number:** 790
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/790
- **Branch:** `cursor/tiktok-targeting-v1`

## Summary

TikTok audience targeting used plural `/tools/` paths that do not exist and an
invented audience-size endpoint. Fix the documented `/tool/` paths, drop reach
estimate, and add named interest groups with seed-driven interest and hashtag
recommendations, live region/language pickers, and one ad group per non-empty
group.

## Scope / files

- `lib/tiktok/audience.ts` and new recommend/region/language fetchers
- `app/api/tiktok/audience/*` routes with per-dimension `failed` flags
- `components/tiktok-wizard/steps/audiences.tsx`
- `lib/types/tiktok-draft.ts` interest groups + default-on-read normalize
- `lib/tiktok-wizard/review.ts` ad-group generation
- `lib/tiktok/write/mapping.ts` per-group targeting fields

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test`

## Notes

- Do not invent an audience-size endpoint. Hashtag IDs are stored on the group
  and mapped onto `interest_keyword_ids` because AdgroupCreateBody has no
  `hashtag_*` field and `/tool/hashtag/get/` takes `keyword_ids`.
- `OFFPIXEL_TIKTOK_WRITES_ENABLED` unchanged.
