/**
 * lib/google-ads/geo-suggest.ts
 *
 * Geo-target resolution: converts free-text location strings (e.g.
 * "London", "South East England") to Google Ads `geoTargetConstant`
 * resource names (e.g. `geoTargetConstants/1006886`).
 *
 * Strategy (used by `pushCampaignGeoCriteria` in campaign-writer.ts):
 *
 *  1. Primary: `geoTargetConstants:suggest` API — sends all unique location
 *     strings in one request, handles arbitrary strings robustly.
 *  2. Fallback: the hardcoded `UK_GEO_TARGET_CONSTANTS` map for the ~20
 *     most common UK locations. Used when the API returns no match for a
 *     given string (e.g. during tests or if the API is slow / unavailable).
 *
 * IDs sourced from the Google Ads API geo target CSV
 * (https://developers.google.com/google-ads/api/data/geotargets) — last
 * verified 2026-05-21 against the v23 API.
 */

import type { GoogleAdsCustomerCredentials } from "./client.ts";
import type { GoogleAdsClient } from "./client.ts";

// ─── Fallback map (common UK locations) ──────────────────────────────

export const UK_GEO_TARGET_CONSTANTS: ReadonlyMap<string, string> = new Map([
  // Country
  ["united kingdom", "geoTargetConstants/2826"],
  ["uk", "geoTargetConstants/2826"],
  ["great britain", "geoTargetConstants/2826"],
  ["england", "geoTargetConstants/20339"],
  // Regions (NUTS1)
  ["london", "geoTargetConstants/1006886"],
  ["greater london", "geoTargetConstants/1006886"],
  ["south east england", "geoTargetConstants/9049069"],
  ["south east", "geoTargetConstants/9049069"],
  ["south west england", "geoTargetConstants/9049070"],
  ["south west", "geoTargetConstants/9049070"],
  ["east of england", "geoTargetConstants/9049071"],
  ["east midlands", "geoTargetConstants/9049072"],
  ["west midlands", "geoTargetConstants/9049073"],
  ["yorkshire and the humber", "geoTargetConstants/9049074"],
  ["north west england", "geoTargetConstants/9049075"],
  ["north west", "geoTargetConstants/9049075"],
  ["north east england", "geoTargetConstants/9049076"],
  ["north east", "geoTargetConstants/9049076"],
  ["wales", "geoTargetConstants/20339"],
  ["scotland", "geoTargetConstants/20337"],
  ["northern ireland", "geoTargetConstants/20338"],
  // Major cities
  ["birmingham", "geoTargetConstants/1006523"],
  ["manchester", "geoTargetConstants/1006520"],
  ["leeds", "geoTargetConstants/1006540"],
  ["liverpool", "geoTargetConstants/1006522"],
  ["bristol", "geoTargetConstants/1006529"],
  ["sheffield", "geoTargetConstants/1006539"],
  ["edinburgh", "geoTargetConstants/1006526"],
  ["glasgow", "geoTargetConstants/1006527"],
  ["cardiff", "geoTargetConstants/1006530"],
  ["belfast", "geoTargetConstants/1006531"],
  ["nottingham", "geoTargetConstants/1006542"],
  ["leicester", "geoTargetConstants/1006541"],
  ["newcastle upon tyne", "geoTargetConstants/1006543"],
  ["newcastle", "geoTargetConstants/1006543"],
  // EU (common for international events)
  ["ireland", "geoTargetConstants/2372"],
  ["germany", "geoTargetConstants/2276"],
  ["france", "geoTargetConstants/2250"],
  ["netherlands", "geoTargetConstants/2528"],
  ["spain", "geoTargetConstants/2724"],
  ["italy", "geoTargetConstants/2380"],
  ["belgium", "geoTargetConstants/2056"],
]);

function normaliseLocationKey(location: string): string {
  return location.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Looks up the fallback map; returns the resource name or null. */
export function lookupFallbackGeoConstant(location: string): string | null {
  return UK_GEO_TARGET_CONSTANTS.get(normaliseLocationKey(location)) ?? null;
}

// ─── Cache + resolver ─────────────────────────────────────────────────

export interface GeoResolution {
  resourceName: string;
  displayName: string;
  source: "suggest" | "fallback";
}

/**
 * Resolves an array of location strings to `geoTargetConstant` resource
 * names in one shot (batching the suggest call). Results are cached in
 * `cache` (pass an empty Map to create a fresh session cache).
 *
 * Returns one entry per input name — `null` means unresolvable.
 */
export async function resolveGeoLocations(
  locations: string[],
  client: GoogleAdsClient,
  credentials: GoogleAdsCustomerCredentials,
  cache: Map<string, GeoResolution | null>,
): Promise<Array<GeoResolution | null>> {
  if (locations.length === 0) return [];

  // Deduplicate for the suggest call.
  const uncached = [...new Set(locations)].filter((loc) => !cache.has(loc));

  if (uncached.length > 0) {
    let suggestResults: Array<{ resourceName: string; displayName: string } | null>;
    try {
      suggestResults = await client.suggestGeoTargetConstants(
        credentials.refreshToken,
        uncached,
        { locale: "en", countryCode: "GB" },
      );
    } catch {
      // If the API call fails, fall through to the fallback map for all.
      suggestResults = uncached.map(() => null);
    }

    for (let i = 0; i < uncached.length; i += 1) {
      const loc = uncached[i];
      const apiResult = suggestResults[i];
      if (apiResult) {
        cache.set(loc, { ...apiResult, source: "suggest" });
      } else {
        // Fallback map.
        const fallback = lookupFallbackGeoConstant(loc);
        if (fallback) {
          cache.set(loc, {
            resourceName: fallback,
            displayName: loc,
            source: "fallback",
          });
        } else {
          cache.set(loc, null);
        }
      }
    }
  }

  return locations.map((loc) => cache.get(loc) ?? null);
}
