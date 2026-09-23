# Cities become a set, with tiers and an exclusion pool

## PR

- **Number:** pending (opens after #963 merges)
- **URL:** pending
- **Branch:** `cursor/adset-location-multi-city`

## Summary

Matas, 23 Sept: "select multiple cities per ad set — similar to creatives —
select all or primary / secondary … preselect cities for exclusion and then
select which ad sets to exclude from."

Two answers settle the design. Cities combine into one ad set, and tiers are
tagged in the picker. An ad set now targets a **set** of campaign locations
(`locationGroupIds`) combined into one `geo_locations`. Each location carries
a Primary / Secondary tag. Search-added exclusions live in one campaign
**exclusion pool** (`excludedLocations`), applied per ad set
(`excludedLocationIds`). Generate makes one ad set per audience targeting
every location. **Split by city** is explicit, on the row.

## Scope / files

- `lib/types.ts`: `LocationSelection.tier`,
  `BudgetScheduleSettings.excludedLocations`,
  `AdSetSuggestion.locationGroupIds` / `excludedLocationIds`,
  `excluded_geo_locations.countries` / `regions`. `locationGroupId` and
  `geoLocations` stay on the type.
- `lib/meta/location-targeting.ts`: `groupToGeo` now emits excluded
  countries and regions (it dropped them before). `locationsToGeo` merges a
  set of groups plus pooled exclusions. `resolveAdSetGeoLocations` has a
  four-rule precedence in its doc comment. `findAdSetLocationProblems` is the
  shared preflight.
- `lib/meta/adset.ts`: the pool is passed through. An emptied multi-city row
  throws instead of defaulting to GB.
- `lib/validation.ts`: Step 5 runs `findAdSetLocationProblems` on enabled ad
  sets. Review (step 7) aggregates it, and so does the plan canvas blocker
  badge.
- `lib/autosave.ts` (`migrateDraft`): see "What an old draft resolves to".
- `lib/wizard/generate-adset-suggestions.ts`: `generateSuggestions` moved out
  of the component so the generate rule is testable. Also fixes
  `geoFingerprint` (below).
- `lib/wizard/adset-suggestions.ts`: set, bulk apply, quick picks, split,
  summaries, naming.
- `components/steps/budget-schedule.tsx`: picker (tier toggles, exclusion
  pool, the rule line); the row control (closed summary plus a dialog with
  All / All primary / All secondary / None, per-location checkboxes with
  tiers, "Apply to" ad sets, Split by city with the trade stated once); the
  late-location banner now offers "Add to every ad set" or "Duplicate ad
  sets for it".

## What an old draft resolves to

`migrateDraft`, on read only:

- A row whose `locationGroupId` still resolves gets
  `locationGroupIds: [locationGroupId]`. `locationsToGeo` of one group equals
  the `groupToGeo` it launched with, and the test asserts the identical
  targeting payload.
- A row whose FK dangles, a pre-#118 row with only `geoLocations`, and a row
  with nothing: untouched. The snapshot or the GB default applies as before.
- An exclusion-only group (search "Exclude" used to make one) moves to the
  pool and is removed from `locationGroups`. Its ad sets get
  `locationGroupIds: []` plus that exclusion. Those rows had no included area
  and Meta rejected them. Step 5 now names them as having no locations.
- Names are not rewritten.

## Found on the way

- `geoFingerprint` used `JSON.stringify(geo, Object.keys(geo).sort())`. An
  array replacer filters keys at every depth, so every single-city group
  fingerprinted as `{"cities":[{}]}`, and Generate silently deduplicated all
  city-only groups after the first. On main, Newcastle + Belfast → Generate
  produced Newcastle ad sets only. The second city could only come from the
  "Duplicate every enabled ad set under …" banner.

## Not done here, and why

- **Server-side preflight in `app/api/meta/launch-campaign/route.ts`.**
  `lib/plan/__tests__/drawer.test.ts` freezes that route against `main`
  (#923). The check runs in `validateStep`, which gates the wizard's Launch
  (step 7), the standalone draft, and the plan canvas (blocker → "blocked").
  `buildMetaTargeting` refuses an empty multi-city row as the last line. A
  request that bypasses the client reaches Meta and gets Meta's own error.
  Lifting the freeze for a Phase 0 call is a one-line follow-up.

## Validation

- [x] `npm test`: 6122 pass, 0 fail
- [x] `npm run build`
- [x] `npx tsc --noEmit`: no errors outside the pre-existing `__tests__` set
- New: `lib/wizard/__tests__/adset-multi-city.test.ts`. Rewritten:
  `lib/wizard/__tests__/adset-row-location-label.test.ts`.
