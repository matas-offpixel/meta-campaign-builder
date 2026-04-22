import "server-only";

/**
 * Shared feature-flag readers for the enrichment APIs. Keeping the
 * `process.env.FEATURE_*` reads in one place stops every route
 * handler from bikeshedding "is this string truthy?" individually
 * (the answer: anything other than "false" / "0" / "" counts as on).
 */

function flag(name: string, defaultOn: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return defaultOn;
  const v = raw.trim().toLowerCase();
  if (v === "" || v === "false" || v === "0" || v === "off" || v === "no") {
    return false;
  }
  return true;
}

export function artistEnrichmentEnabled(): boolean {
  return flag("FEATURE_ARTIST_ENRICHMENT", true);
}

export function venueEnrichmentEnabled(): boolean {
  return flag("FEATURE_VENUE_ENRICHMENT", true);
}
