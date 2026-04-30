## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `creator/fix-google-ads-top-regions-v3`

## Summary

PR #219's `country_view.country_criterion_id` query failed with `UNRECOGNIZED_FIELD`. This changes Top Regions to use `segments.geo_target_country` on `geographic_view`, which returns `geoTargetConstants/...` values that the existing `geoLabel()` country mapping already handles. It also fixes Meta demographic breakdown calls by removing breakdown dimensions from the `fields` param and relying on `breakdowns=country|age|gender`.

## Scope / files

- `lib/google-ads/insights.ts`
- `lib/google-ads/__tests__/insights.test.ts`
- `lib/insights/meta.ts`

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint lib/google-ads/ lib/insights/ lib/meta/`
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'`
- [x] `npm run build`

## Notes

- Scoped ESLint reports two pre-existing warnings in `lib/meta/adset.ts` for unused `_goal` parameters.
- Live production verification should confirm no more `[googleAds] geo query omitted` or `[insights/meta] demographics breakdowns failed: gender` warnings.
