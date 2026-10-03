import type { CampaignDraft } from "../types.ts";

/** Meta's documented ceiling for a city radius. 0 means no radius. */
export const CITY_RADIUS_MAX_KM = 80;
export const CITY_RADIUS_MAX_MI = 50;
export const CITY_RADIUS_MESSAGE = "Meta allows up to 80 km (50 mi) around a city";
/** 1487110 whose text says the radius is below a floor, not above the ceiling. */
export const CITY_RADIUS_TOO_SMALL_MESSAGE = "Meta rejected this city radius as too small.";
export const CITY_RADIUS_SUBCODE = 1487110;

export function cityRadiusOutOfRange(
  radius: number | null | undefined,
  unit?: "kilometer" | "mile" | string | null,
): boolean {
  if (radius == null || !Number.isFinite(radius) || radius === 0) return false;
  const max = unit === "mile" ? CITY_RADIUS_MAX_MI : CITY_RADIUS_MAX_KM;
  return radius > max;
}

export function clampCityRadius(
  radius: number,
  unit: "kilometer" | "mile" = "kilometer",
): number {
  const max = unit === "mile" ? CITY_RADIUS_MAX_MI : CITY_RADIUS_MAX_KM;
  if (!Number.isFinite(radius) || radius === 0) return 0;
  return Math.min(max, radius);
}

export function cityRadiusProblemInDraft(draft: CampaignDraft): string | null {
  const selections = [
    ...(draft.budgetSchedule.locationGroups ?? []).flatMap((group) => group.selections),
    ...(draft.budgetSchedule.excludedLocations ?? []),
  ];
  for (const selection of selections) {
    if (
      selection.locationType === "city" &&
      cityRadiusOutOfRange(selection.radius, selection.distanceUnit)
    ) {
      return CITY_RADIUS_MESSAGE;
    }
  }
  for (const adSet of draft.adSetSuggestions ?? []) {
    const cities = [
      ...(adSet.geoLocations?.cities ?? []),
      ...(adSet.geoLocations?.excluded_geo_locations?.cities ?? []),
    ];
    for (const city of cities) {
      if (cityRadiusOutOfRange(city.radius, city.distance_unit)) return CITY_RADIUS_MESSAGE;
    }
  }
  return null;
}
