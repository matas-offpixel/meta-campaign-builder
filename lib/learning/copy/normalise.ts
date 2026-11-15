/**
 * Turn one ad line into a template another event can refill.
 *
 * Order: generic slots (url, handle, phone, price, time, date; hashtags
 * are dropped), then names, then claims. Names go before claims so an
 * event called "AZYR b2b Partiboi69" is one {event}, not "azyr {b2b}
 * partiboi69". The ad's own event is matched first (lineup, venue, city,
 * event, client). Global lists come after, in the same order: artist,
 * venue, city, series/event, promoter. An event name with a suffix after
 * a dash, pipe or colon ("Mall Grab - Sheffield") also matches by its
 * first part. A venue name that is really a city ("London") is a city.
 * A claim (final tickets, percent sold, b2b, debut, years, opening)
 * stays a named slot and is removed later when the target event cannot
 * support it.
 *
 * A time of day ("12PM", "12:00", "10 am") is {time}. A weekday on its
 * own or abbreviated ("Friday", "Wed"), a month with a lead word ("this
 * December", "in October") or a full month name on its own is {date}, and
 * a run of date slots ("this Friday 28th August") is one {date}.
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
  /** Lower case, emoji and punctuation removed (sentence punctuation becomes a space, so "Sheffield.Tickets" is two words), placeholders kept. */
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

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";
/** Full month names that are never ordinary words. "May" only counts with a day number or a lead word. */
const MONTHS_ALONE = "january|february|march|april|june|july|august|september|october|november|december";
const WEEKDAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat|sun";
/** A weekday on its own. The three-letter forms need a dot or a following time or day number, so "sat" the verb and "sun" stay words. */
const WEEKDAYS_ALONE = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|tues|weds|thurs|thur";
const TIME = "\\d{1,2}(?::[0-5]\\d)?\\s*(?:am|pm)|\\d{1,2}:[0-5]\\d(?:\\s*(?:am|pm))?";

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

/**
 * Voice is which Page posted the ad. A page on the client's promoter list
 * is the promoter. Any other page is an artist page. Unknown only when
 * the ad has no page id.
 */
export function voiceOf(
  storyId: string | null | undefined,
  promoterPageIds: readonly string[],
): { voice: Voice; pageId: string | null } {
  const page = pageIdOf(storyId);
  if (!page) return { voice: "unknown", pageId: null };
  const promoter = promoterPageIds.some((id) => id.trim() === page);
  return { voice: promoter ? "promoter" : "artist", pageId: page };
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
  next = next.replace(/(^|[^\p{L}\p{N}])#[\p{L}\p{N}_]+/gu, "$1");
  next = next.replace(/\+?\d[\d\s().-]{7,}\d/g, (match) => (match.replace(/\D/g, "").length >= 9 ? "{phone}" : match));
  next = next.replace(/£\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s*gbp\b/gi, "{price}");
  next = next.replace(new RegExp(`\\b(?:${TIME})\\b`, "gi"), "{time}");
  const date = [
    new RegExp(`\\b(?:this|next|every)\\s+(?:${WEEKDAYS})\\b\\.?`, "gi"),
    new RegExp(`\\b(?:${WEEKDAYS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s+(?:of\\s+)?(?:${MONTHS}))?(?:\\s+\\d{4})?\\b`, "gi"),
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})(?:\\s+\\d{4})?\\b`, "gi"),
    /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g,
    new RegExp(`\\b(?:this|next|in|every|until|from|for)\\s+(?:${MONTHS})\\b`, "gi"),
    new RegExp(`\\b(?:${MONTHS_ALONE})\\b`, "gi"),
    new RegExp(`\\b(?:${WEEKDAYS_ALONE})\\b`, "gi"),
    new RegExp(`\\b(?:mon|tue|wed|thu|fri|sat|sun)\\b(?=\\.|\\s+\\{time\\})`, "gi"),
  ];
  for (const pattern of date) next = next.replace(pattern, "{date}");
  next = next.replace(/\{date\}(?:[\s,]+\{date\})+/g, "{date}");
  return next;
}

/** "Mall Grab - Sheffield" → ["Mall Grab - Sheffield", "Mall Grab"]. The whole name is tried first. */
function eventNameParts(name: string): string[] {
  const parts = name.split(/\s+[-–—|:]\s+|:\s+/).map((part) => part.trim()).filter((part) => part.length >= 3);
  return parts.length > 1 ? [name, parts[0]!] : [name];
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
  let next = applyGenerics(raw);
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
  if (eventName && !artistNames.has(eventName.toLowerCase())) {
    for (const part of eventNameParts(eventName)) {
      if (isCity(part, cities) || artistNames.has(part.toLowerCase())) continue;
      next = replaceName(next, part, "{event}");
    }
  }
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

  const claims = applyClaims(next);
  next = claims.text.replace(/\s+/g, " ").trim();
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
    .replace(/[.!?,;:]/g, " ")
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
