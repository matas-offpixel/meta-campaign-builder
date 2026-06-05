/**
 * venue-resolve.ts
 *
 * Resolves an AssetSheetRow location label to a client_venue_mappings record.
 * Matching is case-insensitive and ignores leading/trailing whitespace.
 *
 * Two resolution modes:
 *   - Single venue: location matches a specific venue label → ResolvedVenue
 *   - Umbrella:     location='All' → UmbrellaResolution with all event codes
 *     for the given nation (or all nations when nation='All')
 */

export interface VenueMapping {
  id: string;
  clientId: string;
  sheetLabel: string;
  eventCode: string;
  nationLabel: string | null;
}

export interface ResolvedVenue {
  isUmbrella: false;
  eventCode: string;
  mappingId: string;
}

/** Returned when location='All' — one row maps to N events */
export interface UmbrellaResolution {
  isUmbrella: true;
  /** All event codes matched by this nation filter. */
  eventCodes: string[];
  /** Human-readable label for copy-generation (e.g. "All England events") */
  label: string;
}

export type VenueResolution = ResolvedVenue | UmbrellaResolution;

/**
 * Resolves a single specific location label (non-All).
 * Returns null if no mapping found; callers should log status='error'.
 */
export function resolveVenue(
  location: string,
  mappings: VenueMapping[],
): ResolvedVenue | null {
  const needle = location.trim().toLowerCase();
  if (needle === "all" || needle === "") return null;

  const match = mappings.find((m) => m.sheetLabel.trim().toLowerCase() === needle);
  if (!match) return null;

  return { isUmbrella: false, eventCode: match.eventCode, mappingId: match.id };
}

/**
 * Resolves an "All" location to all venue mappings for the given nation.
 *
 * @param nation  Sheet value from column A — "England" | "Scotland" | "All"
 * @param mappings  All client_venue_mappings for the client
 * @returns UmbrellaResolution with matching event codes, or null if no mappings match
 */
export function resolveUmbrella(
  nation: string,
  mappings: VenueMapping[],
): UmbrellaResolution | null {
  const nationNeedle = nation.trim().toLowerCase();

  const matched =
    nationNeedle === "all" || nationNeedle === ""
      ? mappings                                                        // all nations
      : mappings.filter((m) => m.nationLabel?.trim().toLowerCase() === nationNeedle);

  if (matched.length === 0) return null;

  const eventCodes = [...new Set(matched.map((m) => m.eventCode))].sort();
  const label =
    nationNeedle === "all" || nationNeedle === ""
      ? "All venues"
      : `All ${nation.trim()} venues`;

  return { isUmbrella: true, eventCodes, label };
}

/**
 * Map key used internally: `${location}::${nation}` (composite so two rows
 * with location='All' but different nations resolve independently).
 */
export function venueResolutionKey(location: string, nation: string): string {
  return `${location.trim().toLowerCase()}::${nation.trim().toLowerCase()}`;
}

/**
 * Batch-resolves an array of `{location, nation}` pairs.
 *
 * - For specific locations (non-"All"): calls resolveVenue
 * - For location='All': calls resolveUmbrella filtered by nation
 *
 * Map key: `venueResolutionKey(location, nation)`.
 * Value: VenueResolution (ResolvedVenue | UmbrellaResolution) or null (no mapping found).
 */
export function buildVenueResolutionMap(
  locationNationPairs: Array<{ location: string; nation: string }>,
  mappings: VenueMapping[],
): Map<string, VenueResolution | null> {
  const result = new Map<string, VenueResolution | null>();

  for (const { location, nation } of locationNationPairs) {
    const key = venueResolutionKey(location, nation);
    if (result.has(key)) continue;

    const needle = location.trim().toLowerCase();
    if (needle === "all" || needle === "") {
      result.set(key, resolveUmbrella(nation, mappings));
    } else {
      result.set(key, resolveVenue(location, mappings));
    }
  }

  return result;
}
