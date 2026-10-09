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
 *   1. An English region name resolves to nothing. Google's geotargets
 *      CSV has no such region, and the name is not sent to suggest and
 *      not given a nearby ID.
 *   2. `geoTargetConstants:suggest` API. The first result is used.
 *   3. `GEO_TARGET_CONSTANTS_MAP`, built from
 *      `verified-geotargets.ts`, when suggest returns nothing.
 *
 * IDs checked against the geotargets CSV of 2026-08-12
 * (https://developers.google.com/google-ads/api/data/geotargets).
 */

import type { GoogleAdsClient, GoogleAdsCustomerCredentials } from "./client.ts";
import {
  englishRegionWarning,
  normaliseLocationKey,
  VERIFIED_GEOTARGETS,
} from "./verified-geotargets.ts";

export { englishRegionWarning } from "./verified-geotargets.ts";

// ─── Fallback map (verified IDs only) ────────────────────────────────

/**
 * Common location strings (lowercase, normalised) → `geoTargetConstant`
 * resource names. Used when suggest returns no match. Every ID is in
 * the verified geotargets list. English region names are absent.
 */
export const GEO_TARGET_CONSTANTS_MAP: ReadonlyMap<string, string> = new Map(
  VERIFIED_GEOTARGETS.flatMap((row) =>
    row.keys.map((key) => [key, `geoTargetConstants/${row.id}`] as const),
  ),
);

/** Fallback map lookup — returns the resource name or null. */
export function lookupFallbackGeoConstant(location: string): string | null {
  if (englishRegionWarning(location)) return null;
  return GEO_TARGET_CONSTANTS_MAP.get(normaliseLocationKey(location)) ?? null;
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
  if (englishRegionWarning(trimmed)) return null;

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
  for (const loc of uncached) {
    if (englishRegionWarning(loc)) cache.set(loc, null);
  }
  const toSuggest = uncached.filter((loc) => !cache.has(loc));

  if (toSuggest.length > 0) {
    let suggestResults: Array<{
      resourceName: string;
      displayName: string;
      countryCode?: string | null;
      targetType?: string | null;
    } | null>;
    try {
      suggestResults = await client.suggestGeoTargetConstants(
        credentials.refreshToken,
        toSuggest,
        { locale: "en", countryCode: "GB" },
      );
    } catch {
      suggestResults = toSuggest.map(() => null);
    }

    for (let i = 0; i < toSuggest.length; i += 1) {
      const loc = toSuggest[i];
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
