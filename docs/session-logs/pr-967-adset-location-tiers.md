# Session log template

## PR

- **Number:** 967
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/967
- **Branch:** `cursor/adset-location-tiers`

## Summary

Tiers are the generate unit and the ad set name. Generate emits one ad set per audience per non-empty Primary/Secondary tier (`{audience} — Primary`), never sweeps untiered locations into a tier, and launch writes `resolveAdSetGeoLocations` onto `geoLocations` so `launched_ad_sets.geo` stays the locations that actually ran after a later picker edit.

## Scope / files

- `lib/wizard/generate-adset-suggestions.ts` — one row per audience per non-empty tier
- `lib/wizard/adset-suggestions.ts` — tier suffix, `followLocationTiers`, strip stale ` — Primary` / ` — Secondary`
- `components/steps/budget-schedule.tsx` — picker rule line; follow membership on picker edit
- `lib/types.ts` — optional `AdSetSuggestion.locationTier`
- `lib/launched-ad-sets/snapshot.ts` + `launch-recorder.ts` + `app/api/meta/create-adsets/route.ts` — stamp at launch from resolve output
- Did not touch exclusion pool, `resolveAdSetGeoLocations` precedence, caps/warnings, `lib/tiktok/**`, `lib/optimisation/**`, `lib/google-*`, `lib/meta/import/**`

## Validation

- [x] `npm test` (6168 tests, 6164 pass, 0 fail, 4 skipped)
- [x] `npm run build`

## Notes

No SQL migration. Country-contains stays a warning. No location blocs.
