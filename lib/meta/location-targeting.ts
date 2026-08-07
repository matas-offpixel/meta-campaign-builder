/**
 * lib/meta/location-targeting.ts
 *
 * Pure conversion between the wizard's `LocationTargetingGroup` model (Step 5
 * "Location Targeting") and Meta's ad-set `geo_locations` targeting shape.
 *
 * Extracted out of `components/steps/budget-schedule.tsx` (where `groupToGeo`
 * originally lived, only used at "Generate Suggestions" time to STAMP a
 * snapshot onto each `AdSetSuggestion.geoLocations`) so the same conversion
 * can also run at LAUNCH time in `lib/meta/adset.ts`, resolving a per-ad-set
 * `AdSetSuggestion.locationGroupId` FK fresh against
 * `BudgetScheduleSettings.locationGroups` (task #118, multi-location per
 * campaign). One conversion, two call sites — no risk of UI and launch
 * payload drifting apart on what a given location group actually means.
 */

import type { AdSetGeoLocations, AdSetSuggestion, LocationTargetingGroup } from "@/lib/types";

/** Convert a `LocationTargetingGroup` (UI model) into Meta's `geo_locations` shape. */
export function groupToGeo(group: LocationTargetingGroup): AdSetGeoLocations {
  const geo: AdSetGeoLocations = {};
  const excluded: AdSetGeoLocations = {};

  for (const sel of group.selections) {
    if (sel.mode === "include") {
      if (sel.locationType === "country" && sel.countryCode) {
        geo.countries = geo.countries ?? [];
        geo.countries.push(sel.countryCode);
      } else if (sel.locationType === "city" && sel.locationKey) {
        geo.cities = geo.cities ?? [];
        geo.cities.push({
          key: sel.locationKey,
          radius: sel.radius,
          distance_unit: sel.distanceUnit,
        });
      } else if (sel.locationType === "region" && sel.locationKey) {
        geo.regions = geo.regions ?? [];
        geo.regions.push({ key: sel.locationKey });
      }
    } else {
      if (sel.locationType === "city" && sel.locationKey) {
        excluded.cities = excluded.cities ?? [];
        excluded.cities.push({
          key: sel.locationKey,
          radius: sel.radius,
          distance_unit: sel.distanceUnit,
        });
      }
    }
  }

  if (excluded.cities?.length) {
    geo.excluded_geo_locations = excluded;
  }

  return geo;
}

/**
 * Resolve the effective geo-targeting for an ad set at launch time.
 *
 * Precedence:
 *   1. `adSet.locationGroupId` resolved FRESH against `locationGroups` — the
 *      source of truth once a campaign has multiple location groups (task
 *      #118). Reassigning a row's location or editing the group's selections
 *      after "Generate Suggestions" ran takes effect at launch without
 *      needing to regenerate.
 *   2. The stamped `adSet.geoLocations` snapshot — every draft created
 *      before `locationGroupId` existed, or a row whose `locationGroupId`
 *      points at a group that's since been removed. Zero regression.
 *   3. `undefined` — caller (`buildMetaTargeting`) defaults to `{ countries: ["GB"] }`.
 */
export function resolveAdSetGeoLocations(
  adSet: AdSetSuggestion,
  locationGroups: LocationTargetingGroup[] | undefined,
): AdSetGeoLocations | undefined {
  if (adSet.locationGroupId) {
    const group = locationGroups?.find((g) => g.id === adSet.locationGroupId);
    if (group) return groupToGeo(group);
  }
  return adSet.geoLocations;
}
