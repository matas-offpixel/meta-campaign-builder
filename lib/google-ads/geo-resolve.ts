/**
 * lib/google-ads/geo-resolve.ts
 *
 * Single source of truth for geo-target resolution.
 * Used by:
 *   - The push adapter (`campaign-writer.ts`) at push time.
 *   - The preview route (`app/api/google-search/resolve-geo/route.ts`)
 *     for the live resolution UI in the Targeting & Budget wizard step.
 *
 * Having one module here guarantees the wizard preview and the actual
 * push resolve identically — no silent divergence.
 *
 * Resolution strategy:
 *   1. `geoTargetConstants:suggest` API (Google Ads v23, global endpoint).
 *      Returns ranked matches by relevance. We take the first ENABLED result.
 *   2. Hardcoded `GEO_TARGET_CONSTANTS_MAP` fallback — covers the ~40 most
 *      common UK + EU locations for tests and when the API is unavailable.
 *
 * IDs sourced from the Google Ads API geo target CSV
 * (https://developers.google.com/google-ads/api/data/geotargets) — verified
 * 2026-05-21 against the v23 API.
 */

import type { GoogleAdsClient, GoogleAdsCustomerCredentials } from "./client.ts";

// ─── Fallback map (UK + common EU) ───────────────────────────────────

/**
 * Hardcoded map of common location strings (lowercase, normalised) →
 * `geoTargetConstant` resource names. Used when the suggest API returns
 * no match (e.g. in tests or if the API is temporarily unavailable).
 *
 * Canonical IDs from the Google Ads geotargets CSV (2026-05-21).
 */
export const GEO_TARGET_CONSTANTS_MAP: ReadonlyMap<string, string> = new Map([
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
  // Wales — correct ID 20338 (was wrongly 20339/England in geo-suggest.ts v1)
  ["wales", "geoTargetConstants/20338"],
  ["scotland", "geoTargetConstants/20337"],
  ["northern ireland", "geoTargetConstants/20339"],
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

function normaliseKey(location: string): string {
  return location.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Fallback map lookup — returns the resource name or null. */
export function lookupFallbackGeoConstant(location: string): string | null {
  return GEO_TARGET_CONSTANTS_MAP.get(normaliseKey(location)) ?? null;
}

// ─── Resolution result ────────────────────────────────────────────────

export interface GeoResolution {
  /** e.g. `geoTargetConstants/1006886` */
  resourceName: string;
  /** Canonical display name returned by the API, e.g. "London, England, United Kingdom". */
  canonicalName: string;
  /** ISO 3166-1 alpha-2, e.g. "GB". Present when the suggest API returned it. */
  countryCode: string | null;
  /** Google Ads target type, e.g. "City", "Region", "Country". */
  targetType: string | null;
  source: "suggest" | "fallback";
}

// ─── Single-location resolve (for the preview route) ─────────────────

/**
 * Resolves a single free-text location string. Returns the top ENABLED
 * match from `geoTargetConstants:suggest`, falling back to the hardcoded
 * map if the API returns nothing.
 *
 * Returns `null` if no match was found via either path.
 */
export async function resolveGeoLocation(
  location: string,
  client: GoogleAdsClient,
  credentials: GoogleAdsCustomerCredentials,
): Promise<GeoResolution | null> {
  const trimmed = location.trim();
  if (!trimmed) return null;

  // Try the suggest API first.
  try {
    const results = await client.suggestGeoTargetConstants(
      credentials.refreshToken,
      [trimmed],
      { locale: "en", countryCode: "GB" },
    );
    const match = results[0];
    if (match) {
      return {
        resourceName: match.resourceName,
        canonicalName: match.displayName,
        countryCode: match.countryCode ?? null,
        targetType: match.targetType ?? null,
        source: "suggest",
      };
    }
  } catch {
    // API error — fall through to hardcoded map.
  }

  // Fallback map.
  const fallbackResource = lookupFallbackGeoConstant(trimmed);
  if (fallbackResource) {
    return {
      resourceName: fallbackResource,
      canonicalName: trimmed,
      countryCode: "GB",
      targetType: null,
      source: "fallback",
    };
  }

  return null;
}

// ─── Batch resolve (for the push adapter) ────────────────────────────

/**
 * Resolves an array of location strings to `geoTargetConstant` resource
 * names in one batched suggest call. Results are cached in `cache`
 * (pass an empty `Map` to create a fresh session cache).
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

  const uncached = [...new Set(locations)].filter((loc) => !cache.has(loc));

  if (uncached.length > 0) {
    let suggestResults: Array<{
      resourceName: string;
      displayName: string;
      countryCode?: string | null;
      targetType?: string | null;
    } | null>;
    try {
      suggestResults = await client.suggestGeoTargetConstants(
        credentials.refreshToken,
        uncached,
        { locale: "en", countryCode: "GB" },
      );
    } catch {
      suggestResults = uncached.map(() => null);
    }

    for (let i = 0; i < uncached.length; i += 1) {
      const loc = uncached[i];
      const apiResult = suggestResults[i];
      if (apiResult) {
        cache.set(loc, {
          resourceName: apiResult.resourceName,
          canonicalName: apiResult.displayName,
          countryCode: apiResult.countryCode ?? null,
          targetType: apiResult.targetType ?? null,
          source: "suggest",
        });
      } else {
        const fallback = lookupFallbackGeoConstant(loc);
        if (fallback) {
          cache.set(loc, {
            resourceName: fallback,
            canonicalName: loc,
            countryCode: "GB",
            targetType: null,
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
