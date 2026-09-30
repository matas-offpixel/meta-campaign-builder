[Use Opus]

# Ad-set geo targeting has no way to say "Europe". Add Meta's `country_groups` as a fourth location type, resolved through Meta's own search like everything else. One PR, `cursor/geo-country-groups`, off fresh `main`. Open, don't merge.

Matas: *"europe was missing from the continent selects."* It is missing because the app has no continent concept at all:

- `LocationSelection.locationType` (`lib/types.ts:804`) is `"city" | "country" | "region"`.
- `GET /api/meta/location-search` passes `location_types` of `city,region,country` — Meta's `adgeolocation` search also accepts `country_group`, which the app never asks for.
- `buildMetaTargeting` (`lib/meta/adset.ts:~372`) emits `geo_locations.{countries,cities,regions}`; Meta's `geo_locations.country_groups[]` is never written.
- `PRESET_CONFIGS` (`components/steps/budget-schedule.tsx:~130`) is UK, London +40km, UK excl London.
- `lib/meta/import/map.ts` reads live targeting on import; `country_groups` on a source ad set is currently dropped silently — check and say in the PR body whether it lands in `dropped[]` or vanishes.

`grep -rn country_group lib components app` on `main` returns nothing outside fixtures.

## 1 — Search, not a hardcoded list

Meta's group keys are Meta's — `europe`, `eea`, `worldwide`, `africa`, `asia`, `north_america`, `south_america`, `oceania`, `middle_east`, and trade blocs — and the set has changed over the years. Do not hardcode them. Extend `/api/meta/location-search` so the caller can request `types=country_group` (alone or alongside the others); Meta returns `{ key, name, type: "country_group", country_codes[] }`. Capture one real response for `q=europe` in the PR body — the exact `key` and whether Meta returns both `europe` and `eea` — and build from that.

The picker's search box then finds "Europe" the same way it finds "Manchester". Add `"country_group"` to `locationType`, store the key in `locationKey`, no `countryCode`. `country_codes[]` from the search result is kept on the selection as `memberCountryCodes` so preflight can tell that an included city or country sits inside an included/excluded group (the same overlap logic the four-rule geo precedence already does for city-in-country).

## 2 — Write it to Meta

`buildMetaTargeting`: `country_group` selections → `geo_locations.country_groups: [key…]` (include) / `excluded_geo_locations.country_groups` (exclude). Same shape as `countries`. Meta's cap applies — say what it is from the docs, and refuse over it in preflight like the 25-country / 250-city caps.

The ad-set fingerprint (`geoFingerprint`, `components/steps/budget-schedule.tsx:~253`) must include `country_groups`, or two ad sets differing only in group will collapse into one at Generate — the exact bug #964 fixed for cities.

## 3 — Presets and tiers

Add two presets, resolved through search like the others, not hardcoded keys: **Europe** and **Europe excl UK** (include `europe` group, exclude `GB` country). If §1's capture shows Meta distinguishes `europe` from `eea`, use `europe` and note the difference in the preset label tooltip. The Primary/Secondary tiers from #964 apply to groups as they do to regions — Matas asked for that then (*"should also apply to regions (UK, EU etc)"*).

## 4 — Import round-trip

`map.ts`: `geo_locations.country_groups[]` and `excluded_geo_locations.country_groups[]` on a source ad set become `country_group` selections with the key, and the label from a search lookup (or the key if the lookup fails, flagged in `dropped[]` as `label_unresolved`). Re-import the DHB fixture and confirm nothing changed for it; find or capture one ad set that targets a group and confirm it round-trips.

## Guards

No migration — `draft_json` + `migrateDraft`. Existing selections with the three old types are untouched. Do not touch `lib/tiktok/**`, `lib/optimisation/**`, `lib/google-ads/**`, `lib/google-search/**`, or the live ad-set targeting push (#989 — it treats `targeting` as opaque and needs nothing).

## Test plan

Search `types=country_group` returns groups; `q=europe` yields the captured key. A `country_group` selection → `geo_locations.country_groups`; exclude → `excluded_geo_locations.country_groups`; countries/cities/regions untouched beside it. Two ad sets differing only by group have different fingerprints. Preflight flags GB included inside an included `europe`. Europe-excl-UK preset produces include-group + exclude-country. Import of an ad set with `country_groups` round-trips; DHB fixture unchanged. #969's write-set guard unchanged.

Full `npm test`, `npm run build`, check-run conclusions in the thread — not in a commit.
