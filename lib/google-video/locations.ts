/**
 * lib/google-video/locations.ts
 *
 * Location IDs for the Editor file. The IDs live in
 * `lib/google-ads/verified-geotargets.ts`, checked against Google's
 * geotargets CSV of 2026-08-12. Deliberately not a second copy of the
 * Search fallback map.
 *
 * `Location` is Google's canonical name with ", " separators, which is
 * how Editor exported London. `type` is set only where Editor's export
 * showed the spelling (Country, City); otherwise Editor fills it in.
 *
 * Google has no "South East England" (or any other English region)
 * target. A name not listed here is left out of the file with a warning.
 */

import { VERIFIED_GEOTARGETS } from "../google-ads/verified-geotargets.ts";
import type { GoogleVideoGeoTarget } from "./types.ts";

export interface EditorLocation {
  id: string;
  location: string;
  type: "Country" | "City" | null;
}

const LOCATIONS: ReadonlyArray<{ keys: readonly string[] } & EditorLocation> = VERIFIED_GEOTARGETS.map(
  (row) => ({
    keys: row.keys,
    id: row.id,
    location: row.editorLocation,
    type: row.editorType,
  }),
);

const BY_KEY = new Map(LOCATIONS.flatMap(({ keys, ...loc }) => keys.map((k) => [k, loc] as const)));

export function editorLocation(name: string): EditorLocation | null {
  return BY_KEY.get(name.toLowerCase().trim().replace(/\s+/g, " ")) ?? null;
}

function titleCase(key: string): string {
  return key.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** One row per checked location ID. `name` is a key `editorLocation` accepts. */
export function editorLocationChoices(): ReadonlyArray<{ name: string; id: string } & EditorLocation> {
  const seen = new Set<string>();
  const out: Array<{ name: string; id: string } & EditorLocation> = [];
  for (const row of LOCATIONS) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ name: titleCase(row.keys[0]), id: row.id, location: row.location, type: row.type });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/**
 * Add a location the operator can pick. Unknown names (including English
 * regions, which Google does not target) are rejected. A name already on
 * the plan as a positive target is left as it is.
 */
export function addPlanLocation(
  geo: readonly GoogleVideoGeoTarget[],
  name: string,
): readonly GoogleVideoGeoTarget[] | null {
  const loc = editorLocation(name);
  if (!loc) return null;
  if (geo.some((g) => !g.negative && editorLocation(g.name)?.id === loc.id)) return geo;
  const canonical = editorLocationChoices().find((choice) => choice.id === loc.id)?.name ?? name.trim();
  return [...geo, { name: canonical, bid_modifier_pct: null, negative: false }];
}

export function removePlanLocation(
  geo: readonly GoogleVideoGeoTarget[],
  name: string,
): GoogleVideoGeoTarget[] {
  return geo.filter((g) => g.name !== name);
}
