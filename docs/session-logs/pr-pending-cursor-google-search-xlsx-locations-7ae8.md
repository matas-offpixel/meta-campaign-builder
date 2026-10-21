# Google Search xlsx import reads locations

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/google-search-xlsx-locations-7ae8`

## Summary

A Search plan imported from xlsx had `geo_targets: []`, so Push hard-errored "No locations — this would run worldwide". The importer now reads an optional Locations tab (also Geo, or Targeting when the name has no budget and no exclusion) and the import route resolves each row with the same suggest batch the push uses. No match stores `resolved_resource_name: null`. If Google Ads cannot be asked, the import still saves and warns `geo_resolve_failed`.

## Scope / files

- `lib/google-search/xlsx-import.ts` — tab routing and the pure parser. No network.
- `lib/google-search/import-geo.ts` — resolution step the import route calls.
- `app/api/google-search/import/route.ts` — one `resolveGeoLocations` batch after a non-empty parse.
- `lib/google-search/workbook.ts` — `Locations` on `SEARCH_TABS.optional`.
- `lib/google-search/geo-targets-codec.ts` — an explicit null resolution survives a save. A missing key still means not tried.
- `lib/google-search/__tests__/fixtures/261023-folamour-google-search.xlsx` — stand-in. The real Folamour sheet was not in the repo. Same three rows: Tyne and Wear, Northumberland, County Durham, Targeting = Presence.

## Validation

- [x] `npx tsc --noEmit` (no errors in the touched files)
- [x] `npm run build`
- [x] `npm test` (7392 pass, 0 fail)

## Notes

Locations is matched last, so Campaigns, Keywords, Negatives, Ad Copy, Overview and Budget keep their tabs. "Targeting & Budget" stays budget. "Targeting & Exclusions" is not Locations and does not turn a video workbook into a search workbook. A budget tab that also says Geo stays the budget tab, so location rows on it are not read.
