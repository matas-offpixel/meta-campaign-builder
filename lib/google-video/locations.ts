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
