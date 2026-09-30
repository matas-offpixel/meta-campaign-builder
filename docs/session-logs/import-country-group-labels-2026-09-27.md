[Use Opus]

# PR A — Importer names country groups. One PR, `cursor/import-country-group-labels`, off fresh `main`. Open, don't merge.

#992 made `mapMetaLiveCampaign` accept `countryGroupLabels` and left the one caller — `lib/meta/import/save.ts:266` — not passing it. So an imported ad set targeting `europe` shows the raw key as its label and `dropped[]` carries `label_unresolved`. DHB's `DHB Primary – EU` and `Wide – EU` are the live case.

## Fix

In `save.ts`, before `mapMetaLiveCampaign`, collect every distinct group key from the bundle's ad sets (`geo_locations.country_groups` and `excluded_geo_locations.country_groups`) and resolve them the same way `imageSizes` is resolved: one injected dep (`deps.countryGroupLabels ?? defaultCountryGroupLabels`) that calls Meta's adgeolocation search with `location_types: ["country_group"]` and matches on `key`, returning `{ name, countryCodes }` per key. Batch: one search per distinct key, keys deduped across ad sets, never per ad set. Pass the map through. A key the search cannot resolve stays as today — key as label, `label_unresolved` in `dropped[]` — never a guessed name.

Use the `graphGetWithToken` + `location-search` helpers #992 added (`lib/meta/location-search.ts`), not a second search implementation. The import token is the one `save.ts` already holds.

## Guards

No migration. The mapper is unchanged. Do not touch `lib/tiktok/**`, `lib/optimisation/**`, `lib/google-ads/**`, `lib/google-search/**`. The importer still writes nothing to Meta.

## Test plan

Two ad sets both targeting `europe` → one search call, both selections labelled from the hit with `memberCountryCodes`. A key the search does not return → label is the key, `label_unresolved` dropped. Search throws → same as unresolved, import still saves. DHB fixture: the two EU ad sets now carry the name (assert it is not `"europe"`), everything else identical to #992's snapshot.

Full `npm test`, `npm run build`, check-run conclusions in the thread — not in a commit.
