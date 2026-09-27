/**
 * Pure helpers for Meta adgeolocation search. The route and the location
 * picker both go through these so a country group is the same object a
 * city search produces. Group keys are whatever Meta returns — this file
 * does not list them.
 */

import type { LocationSelection } from "@/lib/types";

export const META_LOCATION_SEARCH_TYPES = ["city", "region", "country", "country_group"] as const;

export type MetaLocationSearchType = (typeof META_LOCATION_SEARCH_TYPES)[number];

const ALLOWED = new Set<string>(META_LOCATION_SEARCH_TYPES);

export interface LocationSearchHit {
  key: string;
  name: string;
  type: MetaLocationSearchType;
  country_code?: string;
  country_name?: string;
  region?: string;
  region_id?: number;
  supports_region?: boolean;
  supports_city?: boolean;
  /** Present on country_group hits. Member ISO codes, as Meta returned them. */
  country_codes?: string[];
}

export interface PresetSearchStep {
  query: string;
  type: "city" | "country" | "country_group";
  /** For city and country, match by country_code to avoid a same-name place. */
  matchCountryCode?: string;
  mode: "include" | "exclude";
  radius?: number;
  distanceUnit?: "kilometer" | "mile";
}

export interface LocationPresetConfig {
  id: string;
  short: string;
  label: string;
  /** Shown on the preset button. Europe is not the European Economic Area. */
  title?: string;
  steps: PresetSearchStep[];
}

/**
 * Europe is the search result whose name is Europe, not a stored key.
 * Meta's docs list `europe` and `eea` as different groups; the preset
 * takes the hit named Europe when both come back.
 */
export const EUROPE_PRESET: LocationPresetConfig = {
  id: "preset_europe",
  short: "Europe",
  label: "Europe",
  title:
    "Meta's Europe country group, from location search. The European Economic Area is a separate group — search for it if you want that instead.",
  steps: [{ query: "Europe", type: "country_group", mode: "include" }],
};

export const EUROPE_EXCL_UK_PRESET: LocationPresetConfig = {
  id: "preset_europe_excl_uk",
  short: "Europe excl UK",
  label: "Europe excluding UK",
  title:
    "Includes the location-search result named Europe and excludes the United Kingdom. Europe and the European Economic Area are different groups.",
  steps: [
    { query: "Europe", type: "country_group", mode: "include" },
    { query: "United Kingdom", type: "country", matchCountryCode: "GB", mode: "exclude" },
  ],
};

export function parseLocationSearchTypes(raw: string | null): MetaLocationSearchType[] | null {
  const source = raw?.trim() ? raw : "city,region,country";
  const types = source.split(",").map((part) => part.trim()).filter(Boolean);
  if (types.length === 0 || types.some((type) => !ALLOWED.has(type))) return null;
  return types as MetaLocationSearchType[];
}

/** `location_types` is a JSON array, the same encoding the route already sends. */
export function locationSearchQuery(query: string, types: readonly string[]): {
  type: "adgeolocation";
  q: string;
  location_types: string;
} {
  return {
    type: "adgeolocation",
    q: query.trim(),
    location_types: JSON.stringify(types),
  };
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const codes = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return codes.length ? codes : undefined;
}

export function parseLocationSearchHits(raw: unknown): LocationSearchHit[] {
  if (!Array.isArray(raw)) return [];
  const hits: LocationSearchHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key : typeof row.key === "number" ? String(row.key) : "";
    const name = typeof row.name === "string" ? row.name : "";
    const type = typeof row.type === "string" ? row.type : "";
    if (!key || !name || !ALLOWED.has(type)) continue;
    const countryCode = typeof row.country_code === "string" ? row.country_code : undefined;
    hits.push({
      key,
      name,
      type: type as MetaLocationSearchType,
      country_code: countryCode,
      country_name: typeof row.country_name === "string" ? row.country_name : undefined,
      region: typeof row.region === "string" ? row.region : undefined,
      region_id: typeof row.region_id === "number" ? row.region_id : undefined,
      supports_region: typeof row.supports_region === "boolean" ? row.supports_region : undefined,
      supports_city: typeof row.supports_city === "boolean" ? row.supports_city : undefined,
      country_codes: stringList(row.country_codes),
    });
  }
  return hits;
}

function sameName(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

/** Country groups match by name. City and country still match on country_code. */
export function matchPresetLocation<T extends { name: string; type: string; country_code?: string }>(
  step: PresetSearchStep,
  results: readonly T[],
): T | undefined {
  const typed = results.filter((result) => result.type === step.type);
  if (step.type === "country_group") {
    return typed.find((result) => sameName(result.name, step.query)) ?? typed[0];
  }
  if (step.matchCountryCode) {
    return typed.find((result) => result.country_code === step.matchCountryCode);
  }
  return typed[0];
}

export function selectionFromGeoResult(
  result: {
    key: string;
    name: string;
    type: string;
    country_code?: string;
    country_name?: string;
    region?: string;
    country_codes?: string[];
  },
  mode: "include" | "exclude" = "include",
  radius?: number,
  distanceUnit?: "kilometer" | "mile",
  source: "search" | "preset" = "search",
): LocationSelection | null {
  if (
    result.type !== "city" &&
    result.type !== "country" &&
    result.type !== "region" &&
    result.type !== "country_group"
  ) {
    return null;
  }
  const label = [result.name, result.region, result.country_name].filter(Boolean).join(", ");
  const group = result.type === "country_group";
  return {
    id: `${result.type}_${result.key}_${mode}_${Date.now()}`,
    source,
    label,
    mode,
    locationType: result.type,
    locationKey: result.type !== "country" ? result.key : undefined,
    countryCode: group ? undefined : result.country_code || undefined,
    memberCountryCodes: group ? result.country_codes : undefined,
    radius: result.type === "city" ? (radius ?? 40) : undefined,
    distanceUnit: result.type === "city" ? (distanceUnit ?? "kilometer") : undefined,
  };
}
