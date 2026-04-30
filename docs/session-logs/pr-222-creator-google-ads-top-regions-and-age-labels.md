## PR

- **Number:** 222
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/222
- **Branch:** `creator/google-ads-top-regions-and-age-labels`

## Summary

Fixes Google Ads share-report consistency for BB26-KAYODE: Top Regions now uses the `geographic_view.country_criterion_id` path indicated by Vercel diagnostics, and Google Ads age/gender labels are normalised to match Meta's display format.

## Scope / files

- `lib/google-ads/insights.ts`
- `lib/google-ads/__tests__/insights.test.ts`

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint lib/google-ads/`
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'`
- [x] `npm run build`

## Notes

- Vercel logs for `/share/report/Rul8DeLZBVTZ0kZr` showed `segments.geo_target_country` fails on `GEOGRAPHIC_VIEW` with `PROHIBITED_SEGMENT_IN_SELECT_OR_WHERE_CLAUSE`.
- Earlier logs showed `country_view.country_criterion_id` fails as `UNRECOGNIZED_FIELD`, and another geo attempt required `campaign.id` in the `SELECT` clause when filtering by `campaign.id`.
