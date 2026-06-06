/**
 * venue-resolve.ts
 *
 * Resolves an AssetSheetRow location label to a client_venue_mappings record.
 * When asset_name is available, three-tier matching prefers venue/city tokens
 * in the asset name over broad sheet location labels.
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

export interface EventVenueContext {
  eventCode: string;
  venueName: string | null;
  venueCity: string | null;
}

export interface ResolvedVenue {
  isUmbrella: false;
  eventCode: string;
  mappingId: string;
  /** True when asset_name narrowed candidates but multiple events still tied. */
  eventMatchAmbiguous: boolean;
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

const BROAD_GEO_NAMES = new Set([
  "scotland",
  "england",
  "wales",
  "northern ireland",
  "uk",
  "britain",
  "great britain",
  "all",
]);

interface ScoredToken {
  token: string;
  specificity: number;
}

function normalise(text: string): string {
  return text.trim().toLowerCase();
}

function assetHaystack(assetName: string): string {
  return normalise(assetName);
}

function containsToken(haystack: string, token: string): boolean {
  if (!token) return false;
  return haystack.includes(token);
}

/** Build venue-specific vocabulary for Tier 1 (excludes bare city names). */
export function buildVenueTokens(event: EventVenueContext): ScoredToken[] {
  const tokens: ScoredToken[] = [];
  const city = event.venueCity ? normalise(event.venueCity) : null;

  if (event.venueName) {
    const words = event.venueName
      .split(/[\s\-/,]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2);

    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j <= words.length; j++) {
        const phrase = words.slice(i, j).join(" ");
        const lowered = normalise(phrase);
        if (city && lowered === city) continue;
        const wordCount = j - i;
        tokens.push({
          token: lowered,
          specificity: phrase.length + (wordCount > 1 ? (wordCount - 1) * 10 : 0),
        });
      }
    }
  }

  const codeParts = event.eventCode.split("-");
  if (codeParts.length > 2) {
    for (const part of codeParts.slice(2)) {
      const lowered = normalise(part);
      if (lowered.length < 2) continue;
      if (city && lowered === city) continue;
      tokens.push({ token: lowered, specificity: lowered.length + 5 });
    }
  }

  const seen = new Map<string, number>();
  for (const t of tokens) {
    const prev = seen.get(t.token) ?? 0;
    if (t.specificity > prev) seen.set(t.token, t.specificity);
  }
  return [...seen.entries()].map(([token, specificity]) => ({ token, specificity }));
}

interface TierMatch {
  eventCode: string;
  bestSpecificity: number;
}

function pickBestTierMatches(matches: TierMatch[]): TierMatch[] {
  if (matches.length === 0) return [];
  const maxSpec = Math.max(...matches.map((m) => m.bestSpecificity));
  const top = matches.filter((m) => m.bestSpecificity === maxSpec);
  if (top.length === 1) return top;
  const sorted = [...top].sort((a, b) => a.eventCode.localeCompare(b.eventCode));
  return [sorted[0]!];
}

function tier1VenueMatches(
  assetName: string,
  events: EventVenueContext[],
): TierMatch[] {
  const haystack = assetHaystack(assetName);
  const matches: TierMatch[] = [];

  for (const event of events) {
    let best = 0;
    for (const { token, specificity } of buildVenueTokens(event)) {
      if (containsToken(haystack, token)) {
        best = Math.max(best, specificity);
      }
    }
    if (best > 0) matches.push({ eventCode: event.eventCode, bestSpecificity: best });
  }

  return pickBestTierMatches(matches);
}

function tier2CityMatches(
  assetName: string,
  events: EventVenueContext[],
): EventVenueContext[] {
  const haystack = assetHaystack(assetName);
  const matchedCities: string[] = [];

  for (const event of events) {
    const city = event.venueCity ? normalise(event.venueCity) : null;
    if (!city || BROAD_GEO_NAMES.has(city)) continue;
    if (containsToken(haystack, city) && !matchedCities.includes(city)) {
      matchedCities.push(city);
    }
  }

  if (matchedCities.length === 0) return [];

  const chosenCity =
    matchedCities.length === 1
      ? matchedCities[0]!
      : matchedCities.find((c) => !BROAD_GEO_NAMES.has(c)) ?? matchedCities[0]!;

  return events.filter((e) => normalise(e.venueCity ?? "") === chosenCity);
}

function mappingForEvent(
  eventCode: string,
  location: string,
  mappings: VenueMapping[],
): VenueMapping | null {
  const loc = normalise(location);
  const exact = mappings.find(
    (m) => m.eventCode === eventCode && normalise(m.sheetLabel) === loc,
  );
  if (exact) return exact;
  return mappings.find((m) => m.eventCode === eventCode) ?? null;
}

function resolveFromAssetName(
  assetName: string,
  location: string,
  mappings: VenueMapping[],
  events: EventVenueContext[],
): ResolvedVenue | null {
  if (!assetName.trim() || events.length === 0) return null;

  const mappedCodes = new Set(mappings.map((m) => m.eventCode));
  const candidates = events.filter((e) => mappedCodes.has(e.eventCode));
  if (candidates.length === 0) return null;

  const tier1 = tier1VenueMatches(assetName, candidates);
  if (tier1.length === 1) {
    const mapping = mappingForEvent(tier1[0]!.eventCode, location, mappings);
    if (!mapping) return null;
    return {
      isUmbrella: false,
      eventCode: tier1[0]!.eventCode,
      mappingId: mapping.id,
      eventMatchAmbiguous: false,
    };
  }

  const tier2Pool = tier2CityMatches(assetName, candidates);
  if (tier2Pool.length > 0) {
    const tier1OnPool = tier1VenueMatches(assetName, tier2Pool);
    const pool =
      tier1OnPool.length === 1
        ? tier2Pool.filter((e) => e.eventCode === tier1OnPool[0]!.eventCode)
        : tier2Pool;

    if (pool.length === 1) {
      const mapping = mappingForEvent(pool[0]!.eventCode, location, mappings);
      if (!mapping) return null;
      return {
        isUmbrella: false,
        eventCode: pool[0]!.eventCode,
        mappingId: mapping.id,
        eventMatchAmbiguous: false,
      };
    }

    const sorted = [...pool].sort((a, b) => a.eventCode.localeCompare(b.eventCode));
    const picked = sorted[0]!;
    const mapping = mappingForEvent(picked.eventCode, location, mappings);
    if (!mapping) return null;
    return {
      isUmbrella: false,
      eventCode: picked.eventCode,
      mappingId: mapping.id,
      eventMatchAmbiguous: true,
    };
  }

  return null;
}

/**
 * Resolves a single specific location label (non-All).
 * Returns null if no mapping found; callers should log status='error'.
 */
export function resolveVenue(
  location: string,
  mappings: VenueMapping[],
  opts?: { assetName?: string; events?: EventVenueContext[] },
): ResolvedVenue | null {
  const needle = location.trim().toLowerCase();
  if (needle === "all" || needle === "") return null;

  if (opts?.assetName && opts.events && opts.events.length > 0) {
    const fromAsset = resolveFromAssetName(opts.assetName, location, mappings, opts.events);
    if (fromAsset) return fromAsset;
  }

  const match = mappings.find((m) => m.sheetLabel.trim().toLowerCase() === needle);
  if (!match) return null;

  return {
    isUmbrella: false,
    eventCode: match.eventCode,
    mappingId: match.id,
    eventMatchAmbiguous: false,
  };
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

export interface RowVenueInput {
  location: string;
  nation: string;
  assetName?: string;
}

/**
 * Batch-resolves rows with optional per-row asset_name for Tier 1/2 matching.
 *
 * Map key: `venueResolutionKey(location, nation)` for location-only cache,
 * or `${key}::${assetName}` when asset-aware resolution is used.
 */
export function buildVenueResolutionMap(
  rows: RowVenueInput[],
  mappings: VenueMapping[],
  events: EventVenueContext[] = [],
): Map<string, VenueResolution | null> {
  const result = new Map<string, VenueResolution | null>();

  for (const { location, nation, assetName } of rows) {
    const key = assetName
      ? `${venueResolutionKey(location, nation)}::${assetName.trim().toLowerCase()}`
      : venueResolutionKey(location, nation);
    if (result.has(key)) continue;

    const needle = location.trim().toLowerCase();
    if (needle === "all" || needle === "") {
      result.set(key, resolveUmbrella(nation, mappings));
    } else {
      result.set(
        key,
        resolveVenue(location, mappings, {
          assetName,
          events: assetName ? events : undefined,
        }),
      );
    }
  }

  return result;
}
