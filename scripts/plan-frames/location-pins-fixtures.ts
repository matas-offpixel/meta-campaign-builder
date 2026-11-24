/**
 * LP frames (docs/design-record/2026-11-24-campaign-creator-location-pin.html):
 * the Step 5 location picker from fixtures. No Supabase, no Meta: the search
 * hit is the one city Meta returns for "Leeds" (811209, Leeds, Kent), as the
 * record draws it. Mounted by components/steps/location-pins-frame-mount.tsx.
 */

import { keepRegionMismatch, manualPinGroup, presetPinGroup } from "../../lib/meta/location-pins.ts";
import type { LocationTargetingGroup } from "../../lib/types.ts";
import type { LocationPickerFrameState } from "../../components/steps/budget-schedule.tsx";

export const LOCATION_PIN_FRAME_IDS = [
  "LP-A",
  "LP-A-hand",
  "LP-B-empty",
  "LP-B",
  "LP-B-name",
  "LP-B-latitude",
  "LP-B-longitude",
  "LP-B-radius",
  "LP-C",
  "LP-C-kept",
] as const;

export type LocationPinFrameId = (typeof LOCATION_PIN_FRAME_IDS)[number];

/** Leeds, Kent as a saved draft holds it (the seven drafts' rows before #1368). */
export const KENT_ROW: LocationTargetingGroup = {
  id: "manual_1795103585517",
  label: "Leeds, Kent, England, United Kingdom (+40 km)",
  source: "manual",
  selections: [
    {
      id: "city_811209_include_1795103585517",
      source: "search",
      label: "Leeds, Kent, England, United Kingdom",
      mode: "include",
      locationType: "city",
      locationKey: "811209",
      countryCode: "GB",
      radius: 40,
      distanceUnit: "kilometer",
    },
  ],
};

const KENT_HIT = { key: "811209", name: "Leeds, Kent", type: "city", country_code: "GB", country_name: "United Kingdom", region: "England" };

const FILLED = { name: "Leeds", latitude: "53.7997", longitude: "-1.5492", radius: "80" };

export interface LocationPinFrame {
  groups: LocationTargetingGroup[];
  state?: LocationPickerFrameState;
}

export function locationPinFrame(id: LocationPinFrameId): LocationPinFrame {
  switch (id) {
    case "LP-A":
      return { groups: [presetPinGroup("leeds")], state: { query: "Leeds", results: [KENT_HIT] } };
    case "LP-A-hand":
      return {
        groups: [manualPinGroup({ name: "Leeds", latitude: 53.7997, longitude: -1.5492, radiusKm: 40, mode: "include" }, 1795103585517)],
      };
    case "LP-B-empty":
      return { groups: [], state: { pinForm: { values: { name: "", latitude: "", longitude: "", radius: "40" } } } };
    case "LP-B":
      return { groups: [], state: { pinForm: { values: FILLED } } };
    case "LP-B-name":
      return { groups: [], state: { pinForm: { values: { ...FILLED, name: "" }, checked: true } } };
    case "LP-B-latitude":
      return { groups: [], state: { pinForm: { values: { ...FILLED, latitude: "93.7997" }, checked: true } } };
    case "LP-B-longitude":
      return { groups: [], state: { pinForm: { values: { ...FILLED, longitude: "-181.5492" }, checked: true } } };
    case "LP-B-radius":
      return { groups: [], state: { pinForm: { values: { ...FILLED, radius: "81" }, checked: true } } };
    case "LP-C":
      return { groups: [KENT_ROW] };
    case "LP-C-kept":
      return {
        groups: [keepRegionMismatch(KENT_ROW, KENT_ROW.selections[0]!.id, "Matas", new Date("2026-11-24T16:40:00Z"))],
      };
  }
}
