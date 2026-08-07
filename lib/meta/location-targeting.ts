/**
 * lib/meta/location-targeting.ts
 *
 * Pure conversion between the wizard's `LocationTargetingGroup` model (Step 5
 * "Location Targeting") and Meta's ad-set `geo_locations` targeting shape.
 *
 * Extracted out of `components/steps/budget-schedule.tsx`, where `groupToGeo`
 * originally lived as a component-local helper only used at "Generate
 * Suggestions" time to stamp a snapshot onto each `AdSetSuggestion.geoLocations`.
 * Pulling it out here lets other pure, non-React code (e.g. the "+ Blank ad
 * set" default location in `lib/wizard/adset-suggestions.ts`) share the exact
 * same conversion instead of re-implementing it.
 */

import type { AdSetGeoLocations, LocationTargetingGroup } from "@/lib/types";

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
