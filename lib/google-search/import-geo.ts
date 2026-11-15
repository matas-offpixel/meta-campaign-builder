/**
 * Resolve Locations-tab rows at import time. The parser stays pure;
 * this is the one place the import route talks to Google Ads.
 *
 * A resolved row is the wizard shape: `resolved_resource_name` and
 * `resolved_name` set, which the Budget step shows as a green check.
 * No match stores an explicit null (amber in the wizard, and Review
 * already warns). If the resolver throws, the rows stay unresolved
 * and the import still succeeds.
 */

import type { GeoResolution } from "../google-ads/geo-resolve.ts";
import type { GoogleSearchGeoTarget, GoogleSearchImportWarning, GoogleSearchPlanDraftTree } from "./types.ts";

export type GeoResolveBatch = (locations: string[]) => Promise<Array<GeoResolution | null>>;

export async function resolveImportedGeoTargets(
  draft: GoogleSearchPlanDraftTree,
  resolve: GeoResolveBatch,
): Promise<void> {
  if (draft.plan.geo_targets.length === 0) return;
  let results: Array<GeoResolution | null>;
  try {
    results = await resolve(draft.plan.geo_targets.map((geo) => geo.location));
  } catch (err) {
    console.error(
      `[google-search-import] geo resolve failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
    draft.warnings.push({
      code: "geo_resolve_failed",
      message:
        "Locations could not be checked with Google Ads, so they were imported unresolved. Resolve them in the Budget step before push.",
    });
    return;
  }
  draft.plan.geo_targets = draft.plan.geo_targets.map((geo, i) => applyResolution(geo, results[i], draft.warnings));
}

function applyResolution(
  geo: GoogleSearchGeoTarget,
  result: GeoResolution | null | undefined,
  warnings: GoogleSearchImportWarning[],
): GoogleSearchGeoTarget {
  if (!result) {
    warnings.push({
      code: "geo_unresolved",
      message: `Location "${geo.location}" didn't resolve to a Google Ads location. Check the spelling in the Budget step.`,
      context: { location: geo.location },
    });
    return { ...geo, resolved_resource_name: null, resolved_name: null };
  }
  return {
    ...geo,
    resolved_resource_name: result.resourceName,
    resolved_name: result.canonicalName,
  };
}
