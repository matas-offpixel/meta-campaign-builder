/**
 * venue-resolve.ts
 *
 * Resolves an AssetSheetRow location label to a client_venue_mappings record.
 * Matching is case-insensitive and ignores leading/trailing whitespace.
 *
 * "All" location rows resolve to null — the caller decides how to handle them
 * (typically: error + prompt for manual event selection).
 */

export interface VenueMapping {
  id: string;
  clientId: string;
  sheetLabel: string;
  eventCode: string;
  nationLabel: string | null;
}

export interface ResolvedVenue {
  eventCode: string;
  mappingId: string;
}

/**
 * Resolves a location label against an in-memory list of venue mappings.
 * Returns null if no mapping found (caller should log status='error').
 */
export function resolveVenue(
  location: string,
  mappings: VenueMapping[],
): ResolvedVenue | null {
  const needle = location.trim().toLowerCase();

  // "All" is a valid sheet value but cannot be auto-resolved to a single event
  if (needle === "all" || needle === "") return null;

  const match = mappings.find((m) => m.sheetLabel.trim().toLowerCase() === needle);
  if (!match) return null;

  return { eventCode: match.eventCode, mappingId: match.id };
}

/**
 * Batch-resolves an array of location strings, returning a Map for O(1) lookup.
 * Each key is the original location string (case-preserved); value is the
 * resolved event code or null.
 */
export function buildVenueResolutionMap(
  locations: string[],
  mappings: VenueMapping[],
): Map<string, ResolvedVenue | null> {
  const result = new Map<string, ResolvedVenue | null>();
  for (const loc of locations) {
    if (!result.has(loc)) {
      result.set(loc, resolveVenue(loc, mappings));
    }
  }
  return result;
}
