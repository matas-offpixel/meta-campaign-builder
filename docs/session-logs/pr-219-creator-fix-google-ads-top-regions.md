## PR

- **Number:** 219
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/219
- **Branch:** `creator/fix-google-ads-top-regions`

## Summary

Google Ads Top Regions was querying `geographic_view` with a `campaign.id IN (...)` filter, which returned no country rows for BB26-KAYODE. This switches the regions query to `country_view`, keeps age/gender on their existing view-specific campaign-filtered paths, and maps `country_view.country_criterion_id` through the existing country constants.

## Scope / files

- `lib/google-ads/insights.ts`
- `lib/google-ads/__tests__/insights.test.ts`

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint lib/google-ads/`
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'`
- [x] `npm run build`

## Notes

- Vercel CLI is not available locally, so live Vercel log inspection was not possible.
- A direct local Google Ads query attempt could not decrypt credentials because this environment lacks `GOOGLE_ADS_TOKEN_KEY`.
