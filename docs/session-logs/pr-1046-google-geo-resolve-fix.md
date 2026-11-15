# Session log

## PR

- **Number:** 1046
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1046
- **Branch:** `cursor/google-geo-resolve-fix`

## Summary

The Search location fallback and the YouTube Editor location list now share one set of IDs checked against Google's geotargets CSV of 2026-08-12. English region names resolve to nothing and are not given a nearby ID.

## Scope / files

- `lib/google-ads/verified-geotargets.ts` — the shared list
- `lib/google-ads/geo-resolve.ts` — fallback map built from that list; English regions return null before suggest
- `lib/google-video/locations.ts` — Editor names, same IDs
- `lib/google-ads/__tests__/fixtures/geotargets-2026-08-12-verified.csv` — the 27 rows copied from the official CSV
- Preview route and the Targeting hint show the region warning. The Search no-location blocker is unchanged.

## Validation

- [x] geo-resolve, geo-suggest, verified-geotargets, geo-preview, campaign-writer (45), search validation, video editor-export — 146 pass, 0 fail
- [x] eslint on the touched files (3 pre-existing warnings)
- [ ] Full `npm test` / CI
- [ ] Browser: the Targeting hint needs a signed-in wizard. Not exercised here.

## Notes

Checked against `geotargets-2026-08-12.csv.zip` from https://developers.google.com/google-ads/api/data/geotargets. London City is 1006886. United Kingdom is 2826. Wales 20343, Scotland 20342, Northern Ireland 20341, England 20339 (all Province). Manchester 1006912, Birmingham 1006524.

The old map's 9049069–9049076 are Spanish cities (9049069 is Estepona). 1006520 is Billingshurst, not Manchester. 20338 and 20337 are not in that CSV.

The CSV does contain other targets we did not use: West Midlands county 9041126, and TV regions East Of England 9047010, North East 9047016, North West 9047018, South West 9047019. There is no South East row. A region name does not fall back to any of those.

An English region returns null even when suggest would return a hit, so the push does not create a criterion for it. The push's no-location blocker and the rest of the mutate chain are unchanged. The existing `geoTargetsFailed` line is the push warning. The preview adds "Google has no English region target…".

No migration. No Google Ads mutate.
