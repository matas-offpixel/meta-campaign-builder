/**
 * Turn one ad line into a template another event can refill.
 *
 * The ad's own event is matched first (lineup, venue, city, event, client).
 * Global lists come after, in the same order: artist, venue, city,
 * series/event, promoter. A venue name that is really a city ("London")
 * is a city. A claim (final tickets, percent sold, b2b, debut, years,
 * opening) stays a named slot and is removed later when the target event
 * cannot support it.
 */

export type ClaimSlot = "final_tickets" | "percent_sold" | "b2b" | "debut" | "years" | "opening";

export type CopyDictionaries = {
  lineup: readonly string[];
  venueName: string | null;
  venueCity: string | null;
  eventName: string | null;
  clientName: string | null;
  globalArtists: readonly string[];
  globalVenues: readonly string[];
  globalCities: readonly string[];
  globalEvents: readonly string[];
  globalPromoters: readonly string[];
};

export type ClaimFacts = {
  finalTickets?: boolean;
  percentSold?: boolean;
  b2b?: boolean;
  debut?: boolean;
  years?: boolean;
  opening?: boolean;
};

export type NormalisedCopy = {
  /** Placeholders kept, original casing outside them. */
  template: string;
  /** Lower case, emoji and punctuation removed, placeholders kept. */
  key: string;
  claims: ClaimSlot[];
};

const CLAIM_FACT: Record<ClaimSlot, keyof ClaimFacts> = {
  final_tickets: "finalTickets",
  percent_sold: "percentSold",
  b2b: "b2b",
  debut: "debut",
  years: "years",
  opening: "opening",
};

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const WEEKDAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";

const CLAIM_PATTERNS: { slot: ClaimSlot; pattern: RegExp }[] = [
  { slot: "final_tickets", pattern: /\bfinal\s+\d[\d,]*\s+tickets\b/gi },
  { slot: "percent_sold", pattern: /\b\d[\d,]*(?:\.\d+)?\s*%\s*sold(?:\s+out)?\b/gi },
  { slot: "years", pattern: /\b\d[\d,]*\s+years?\s+of\b/gi },
  { slot: "b2b", pattern: /\bb2b\b/gi },
  { slot: "debut", pattern: /\bdebut\b/gi },
  { slot: "opening", pattern: /\b(?:venue\s+)?opening\b/gi },
];

export function emptyDictionaries(overrides: Partial<CopyDictionaries> = {}): CopyDictionaries {
  return {
    lineup: [],
    venueName: null,
    venueCity: null,
    eventName: null,
    clientName: null,
    globalArtists: [],
    globalVenues: [],
    globalCities: [],
    globalEvents: [],
    globalPromoters: [],
    ...overrides,
  };
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function isCity(name: string, cities: readonly string[]): boolean {
  return cities.some((city) => sameName(city, name));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Page id from an existing-post story id `{page}_{post}`. */
export function pageIdOf(storyId: string | null | undefined): string | null {
  const page = storyId?.split("_")[0]?.trim() ?? "";
  return /^\d{5,}$/.test(page) ? page : null;
}

export type Voice = "promoter" | "artist" | "unknown";

/** Voice is which Page posted the ad, not how the line is written. */
export function voiceOf(storyId: string | null | undefined, promoterPageIds: readonly string[], artistPageIds: readonly string[]): Voice {
  const page = pageIdOf(storyId);
  if (!page) return "unknown";
  const has = (ids: readonly string[]) => ids.some((id) => id.trim() === page);
  if (has(promoterPageIds)) return "promoter";
  if (has(artistPageIds)) return "artist";
  return "unknown";
}

function applyClaims(text: string): { text: string; claims: ClaimSlot[] } {
  const claims: ClaimSlot[] = [];
  let next = text;
  for (const claim of CLAIM_PATTERNS) {
    if (!claim.pattern.test(next)) {
      claim.pattern.lastIndex = 0;
      continue;
    }
    claim.pattern.lastIndex = 0;
    claims.push(claim.slot);
    next = next.replace(claim.pattern, `{${claim.slot}}`);
  }
  return { text: next, claims };
}

function applyGenerics(text: string): string {
  let next = text;
  next = next.replace(/https?:\/\/\S+|www\.\S+/gi, "{url}");
  next = next.replace(/(^|[^\p{L}\p{N}])@[\p{L}\p{N}._]+/gu, "$1{handle}");
  next = next.replace(/£\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s*gbp\b/gi, "{price}");
  const date = [
    new RegExp(`\\bthis\\s+(?:${WEEKDAYS})\\b`, "gi"),
    new RegExp(`\\b(?:${WEEKDAYS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s+(?:of\\s+)?(?:${MONTHS}))?(?:\\s+\\d{4})?\\b`, "gi"),
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})(?:\\s+\\d{4})?\\b`, "gi"),
    /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g,
  ];
  for (const pattern of date) next = next.replace(pattern, "{date}");
  return next;
}

function replaceName(text: string, name: string, slot: string): string {
  const trimmed = clean(name);
  if (!trimmed || trimmed.length < 2) return text;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?=$|[^\\p{L}\\p{N}])`, "giu");
  return text.replace(pattern, `$1${slot}`);
}

function replaceAll(text: string, names: readonly string[], slot: string): string {
  const ordered = [...new Set(names.map((name) => name.trim()).filter((name) => name.length >= 2))];
  ordered.sort((a, b) => b.length - a.length);
  let next = text;
  for (let start = 0; start < ordered.length; start += 80) {
    const chunk = ordered.slice(start, start + 80);
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(?:${chunk.map(escapeRegExp).join("|")})(?=$|[^\\p{L}\\p{N}])`, "giu");
    next = next.replace(pattern, `$1${slot}`);
  }
  return next;
}

function citySet(dict: CopyDictionaries): string[] {
  return [dict.venueCity, ...dict.globalCities].filter((name): name is string => Boolean(clean(name)));
}

export function normaliseCopy(text: string, dict: CopyDictionaries): NormalisedCopy | null {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const claims = applyClaims(raw);
  let next = applyGenerics(claims.text);
  const cities = citySet(dict);
  const venue = clean(dict.venueName);
  const eventArtists = dict.lineup.map((name) => name.trim()).filter(Boolean);
  const eventName = clean(dict.eventName);
  const clientName = clean(dict.clientName);
  const artistNames = new Set(
    [...eventArtists, ...dict.globalArtists].map((name) => name.trim().toLowerCase()).filter(Boolean),
  );

  next = replaceAll(next, eventArtists, "{artist}");
  if (venue && !isCity(venue, cities)) next = replaceName(next, venue, "{venue}");
  if (clean(dict.venueCity)) next = replaceName(next, dict.venueCity!, "{city}");
  if (eventName && !artistNames.has(eventName.toLowerCase())) next = replaceName(next, eventName, "{event}");
  if (clientName && !artistNames.has(clientName.toLowerCase())) next = replaceName(next, clientName, "{promoter}");

  next = replaceAll(next, dict.globalArtists, "{artist}");
  next = replaceAll(
    next,
    dict.globalVenues.filter((name) => !isCity(name, cities)),
    "{venue}",
  );
  next = replaceAll(next, dict.globalCities, "{city}");
  next = replaceAll(
    next,
    dict.globalEvents.filter((name) => !artistNames.has(name.trim().toLowerCase())),
    "{event}",
  );
  next = replaceAll(next, dict.globalPromoters, "{promoter}");

  next = next.replace(/\s+/g, " ").trim();
  const key = templateKey(next);
  if (!key) return null;
  return { template: next, key, claims: claims.claims };
}

export function templateKey(template: string): string {
  const slots: string[] = [];
  const marked = template.replace(/\{[a-z0-9_]+\}/gi, (token) => {
    slots.push(token.toLowerCase());
    return `\u0000${slots.length - 1}\u0000`;
  });
  const stripped = marked
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[^\p{L}\p{N}\s\u0000]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.replace(/\u0000(\d+)\u0000/g, (_, index: string) => slots[Number(index)] ?? "");
}

/** Drop a claim slot the target event's facts do not support. The library keeps the slot. */
export function dropUnsupportedClaims(template: string, facts: ClaimFacts): string {
  let next = template;
  for (const slot of Object.keys(CLAIM_FACT) as ClaimSlot[]) {
    if (facts[CLAIM_FACT[slot]]) continue;
    next = next.replace(new RegExp(`\\{${slot}\\}`, "g"), "");
  }
  return next.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}
