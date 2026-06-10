/**
 * venue-resolve.ts
 *
 * Resolves an AssetSheetRow location label to a client_venue_mappings record.
 * When asset_name is available, three-tier matching prefers venue/city tokens
 * in the asset name over broad sheet location labels.
 *
 * Resolution modes:
 *   - Single venue: location matches a specific venue label → ResolvedVenue
 *   - Umbrella:     location='All' OR country alias OR multi-city match → UmbrellaResolution
 *   - London hood:  known neighborhood labels → London event(s)
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
  venueCountry?: string | null;
}

export interface ResolvedVenue {
  isUmbrella: false;
  eventCode: string;
  mappingId: string;
  /** True when asset_name narrowed candidates but multiple events still tied. */
  eventMatchAmbiguous: boolean;
}

/** Returned when location spans N events (All, country, or multi-venue city). */
export interface UmbrellaResolution {
  isUmbrella: true;
  /** All event codes matched by this filter. */
  eventCodes: string[];
  /** Human-readable label for copy-generation (e.g. "All England venues") */
  label: string;
}

export type VenueResolution = ResolvedVenue | UmbrellaResolution;

/** Country alias → venue_country values stored inconsistently in events. */
export const COUNTRY_ALIASES: Record<string, readonly string[]> = {
  england: ["GB", "UK", "United Kingdom"],
  scotland: ["Scotland"],
  ireland: ["Ireland", "Republic of Ireland"],
  wales: ["Wales"],
  uk: ["GB", "UK", "United Kingdom", "Scotland", "Wales", "Northern Ireland"],
  britain: ["GB", "UK", "United Kingdom", "Scotland", "Wales"],
  "great britain": ["GB", "UK", "United Kingdom", "Scotland", "Wales"],
};

/** 4thefans English cities — used when venue_country is null or ambiguous. */
export const ENGLISH_CITIES = new Set([
  "birmingham",
  "bournemouth",
  "brighton",
  "bristol",
  "leeds",
  "london",
  "manchester",
  "margate",
  "newcastle",
  "nottingham",
]);

export const SCOTTISH_CITIES = new Set(["aberdeen", "edinburgh", "glasgow"]);

export const WELSH_CITIES = new Set(["cardiff"]);

export const ENGLAND_EXCLUDED_CITIES = new Set([
  ...SCOTTISH_CITIES,
  ...WELSH_CITIES,
  "belfast",
]);

export const LONDON_NEIGHBORHOODS = [
  "Shepards Bush",
  "Shepherd's Bush",
  "Soho",
  "Camden",
  "Brixton",
  "Hackney",
  "Islington",
  "Notting Hill",
  "Kensington",
  "Westminster",
] as const;

const LONDON_NEIGHBORHOOD_NORMALISED = new Set(
  LONDON_NEIGHBORHOODS.map((n) => normaliseLocationLabel(n)),
);

const BROAD_GEO_NAMES = new Set([
  "scotland",
  "england",
  "wales",
  "northern ireland",
  "uk",
  "britain",
  "great britain",
  "all",
  ...Object.keys(COUNTRY_ALIASES),
]);

interface ScoredToken {
  token: string;
  specificity: number;
}

function normalise(text: string): string {
  return text.trim().toLowerCase();
}

/** Location labels with apostrophe variants normalised for neighborhood match. */
export function normaliseLocationLabel(text: string): string {
  return text.trim().toLowerCase().replace(/'/g, "");
}

function assetHaystack(assetName: string): string {
  return normalise(assetName);
}

function containsToken(haystack: string, token: string): boolean {
  if (!token) return false;
  return haystack.includes(token);
}

export function isCountryAliasLocation(location: string): boolean {
  const key = normalise(location);
  return key in COUNTRY_ALIASES;
}

export function isLondonNeighborhoodLocation(location: string): boolean {
  return LONDON_NEIGHBORHOOD_NORMALISED.has(normaliseLocationLabel(location));
}

function normaliseCountryValue(country: string | null | undefined): string {
  return (country ?? "").trim().toLowerCase();
}

function countryMatches(event: EventVenueContext, aliases: readonly string[]): boolean {
  const vc = normaliseCountryValue(event.venueCountry);
  if (!vc) return false;
  return aliases.some((a) => normaliseCountryValue(a) === vc);
}

function cityInSet(event: EventVenueContext, cities: Set<string>): boolean {
  return cities.has(normalise(event.venueCity ?? ""));
}

function mappedEvents(
  events: EventVenueContext[],
  mappings: VenueMapping[],
): EventVenueContext[] {
  const mappedCodes = new Set(mappings.map((m) => m.eventCode));
  return events.filter((e) => mappedCodes.has(e.eventCode));
}

function toUmbrellaResolution(
  matched: EventVenueContext[],
  label: string,
): UmbrellaResolution | null {
  if (matched.length === 0) return null;
  const eventCodes = [...new Set(matched.map((e) => e.eventCode))].sort();
  return { isUmbrella: true, eventCodes, label };
}

function toSingleOrUmbrella(
  matched: EventVenueContext[],
  mappings: VenueMapping[],
  location: string,
  umbrellaLabel: string,
): VenueResolution | null {
  if (matched.length === 0) return null;
  const eventCodes = [...new Set(matched.map((e) => e.eventCode))].sort();
  if (eventCodes.length === 1) {
    const mapping = mappingForEvent(eventCodes[0]!, location, mappings);
    if (!mapping) return null;
    return {
      isUmbrella: false,
      eventCode: eventCodes[0]!,
      mappingId: mapping.id,
      eventMatchAmbiguous: false,
    };
  }
  return { isUmbrella: true, eventCodes, label: umbrellaLabel };
}

/** Filter mapped events for a normalised country alias key. */
export function filterEventsForCountryKey(
  countryKey: string,
  events: EventVenueContext[],
  mappings: VenueMapping[],
): EventVenueContext[] {
  const candidates = mappedEvents(events, mappings);
  const key = normalise(countryKey);

  if (key === "england") {
    return candidates.filter((e) => {
      const city = normalise(e.venueCity ?? "");
      if (ENGLAND_EXCLUDED_CITIES.has(city)) return false;
      if (ENGLISH_CITIES.has(city)) return true;
      return countryMatches(e, COUNTRY_ALIASES.england);
    });
  }

  if (key === "scotland") {
    return candidates.filter(
      (e) => cityInSet(e, SCOTTISH_CITIES) || countryMatches(e, COUNTRY_ALIASES.scotland),
    );
  }

  if (key === "wales") {
    return candidates.filter(
      (e) => cityInSet(e, WELSH_CITIES) || countryMatches(e, COUNTRY_ALIASES.wales),
    );
  }

  if (key === "ireland") {
    return candidates.filter((e) => countryMatches(e, COUNTRY_ALIASES.ireland));
  }

  if (key === "uk" || key === "britain" || key === "great britain") {
    const aliases = COUNTRY_ALIASES[key]!;
    return candidates.filter((e) => {
      const city = normalise(e.venueCity ?? "");
      if (
        ENGLISH_CITIES.has(city) ||
        SCOTTISH_CITIES.has(city) ||
        WELSH_CITIES.has(city)
      ) {
        return true;
      }
      return countryMatches(e, aliases);
    });
  }

  return [];
}

function resolveCountryAliasLocation(
  location: string,
  mappings: VenueMapping[],
  events: EventVenueContext[],
): UmbrellaResolution | null {
  const key = normalise(location);
  if (!(key in COUNTRY_ALIASES)) return null;

  const matched = filterEventsForCountryKey(key, events, mappings);
  const label =
    key === "uk" || key === "britain" || key === "great britain"
      ? "All UK venues"
      : `All ${location.trim()} venues`;
  return toUmbrellaResolution(matched, label);
}

function resolveLondonNeighborhood(
  location: string,
  mappings: VenueMapping[],
  events: EventVenueContext[],
): VenueResolution | null {
  if (!isLondonNeighborhoodLocation(location)) return null;
  const matched = mappedEvents(events, mappings).filter(
    (e) => normalise(e.venueCity ?? "") === "london",
  );
  return toSingleOrUmbrella(matched, mappings, location, "All London venues");
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
 * Returns umbrella for country aliases and multi-London matches.
 * Returns null if no mapping found; callers should log status='error'.
 */
export function resolveVenue(
  location: string,
  mappings: VenueMapping[],
  opts?: { assetName?: string; events?: EventVenueContext[] },
): VenueResolution | null {
  const needle = location.trim().toLowerCase();
  if (needle === "all" || needle === "") return null;

  const events = opts?.events ?? [];

  // Tier 1/2: asset_name tokens win over broad location labels.
  if (opts?.assetName && events.length > 0) {
    const fromAsset = resolveFromAssetName(opts.assetName, location, mappings, events);
    if (fromAsset) return fromAsset;
  }

  // London neighborhood → London event(s).
  if (events.length > 0) {
    const fromLondon = resolveLondonNeighborhood(location, mappings, events);
    if (fromLondon) return fromLondon;
  }

  // Country alias → umbrella across matching venues.
  if (events.length > 0 && isCountryAliasLocation(location)) {
    return resolveCountryAliasLocation(location, mappings, events);
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
 */
export function resolveUmbrella(
  nation: string,
  mappings: VenueMapping[],
): UmbrellaResolution | null {
  const nationNeedle = nation.trim().toLowerCase();

  const matched =
    nationNeedle === "all" || nationNeedle === ""
      ? mappings
      : mappings.filter((m) => m.nationLabel?.trim().toLowerCase() === nationNeedle);

  if (matched.length === 0) return null;

  const eventCodes = [...new Set(matched.map((m) => m.eventCode))].sort();
  const label =
    nationNeedle === "all" || nationNeedle === ""
      ? "All venues"
      : `All ${nation.trim()} venues`;

  return { isUmbrella: true, eventCodes, label };
}

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
          events: events.length > 0 ? events : undefined,
        }),
      );
    }
  }

  return result;
}
