/**
 * Caption fact validator (roadmap §2 rules 1 and 8).
 *
 * A caption may state only what the event record holds:
 *   - names: every name the writer declares must be on the lineup
 *     (creative_lab_event_facts.lineup), or in the event name, venue or
 *     city. A capitalised-phrase check backs that up for names the writer
 *     did not declare; it skips a stoplist of words captions use in title
 *     case (Birthday, Boxing Day, Final Release, New Year, ...).
 *   - dates: a day + month (27 Dec, 27 December, 27.12, Dec 27th) must be
 *     the event date or one of allowed_dates (presale, general sale). A
 *     weekday next to a date must be that date's weekday; a bare weekday
 *     must be the event's. An ordinal alone ("4th Birthday") is not a date.
 *   - £ amounts must equal a tier price.
 *   - scarcity (style 'scarcity', or final / last / left / remaining /
 *     sold out) needs tier rows whose remaining stock is known. Remaining
 *     is quantity_available − quantity_sold: quantity_available holds the
 *     allocation (lib/db/ticketing.ts replaceEventTicketTiers).
 *     "final" / "last" only when exactly one tier has stock and it is the
 *     highest-priced; "under N" only when remaining < N; "N left" only
 *     when remaining ≤ N; "sold out" only when a tier has none left.
 *   - wrap at the style profile's characters per line (v1.json; 18), at
 *     most 4 lines. An overlay that does not fit those 4 lines, or that
 *     is 73–96 characters, uses the long size (up to 5 × 24). Over 96,
 *     or a single word longer than that size's line, is rejected. A lineup name that fits on one line is not
 *     broken. Lines are balanced: no single-word line except the last.
 *     four_line must be exactly 4 lines.
 *   - layout (wrap, emoji, '#', all caps) applies to the overlay only.
 *     Overlay emoji are never allowed. Primary text may use emoji when
 *     the client's style setting says so, and is capped at 125 characters.
 *   - a "Next:" list is at most 3 names. When headliners are set, each
 *     name is a headliner of this event or of an upcoming show (passed
 *     in as extra names). Support is not a Next name.
 *   - a crowd number ("2,000 people", "2,000 music lovers") needs the
 *     filmed show's tickets sold to be at least that number. No clip
 *     event, or no count, rejects it.
 *
 * facts_hash is sha256 over canonical JSON (sorted keys; tiers reduced to
 * name, price, remaining), so it changes when stock does.
 */

import { createHash } from "node:crypto";

import { CHARS_PER_LINE, profile } from "../../src/remotion/caption-style/profile.ts";
import type { ServiceRoleDb } from "./load.ts";
import type { CaptionStyle } from "./tags.ts";

export const DEFAULT_MAX_LINES = 4;

export type StyleProfile = { version: string; charsPerLine?: number; maxLines?: number };

export type FactTier = { name: string; price: number | null; remaining: number | null };

export type EventFacts = {
  eventId: string;
  eventName: string;
  /** YYYY-MM-DD */
  eventDate: string | null;
  venueName: string | null;
  venueCity: string | null;
  lineup: string[];
  /**
   * Artists worth singling out, in draw order. Each name is also in
   * lineup. Empty or omitted: the writer refuses rather than guessing.
   * Billing is per event.
   */
  headliners?: string[];
  /** False when creative_lab_event_facts has no row for the event. */
  hasFacts?: boolean;
  /** YYYY-MM-DD */
  allowedDates: string[];
  tiers: FactTier[];
};

/** on_sale uses ticket CTAs. upcoming and signup use signup CTAs. */
export type SaleStage = "on_sale" | "upcoming" | "signup";

/** Reads events.status. Does not look at the event name. Anything else is upcoming. */
export function saleStageFromStatus(status: string | null | undefined): SaleStage {
  const value = (status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "on_sale") return "on_sale";
  if (value === "signup") return "signup";
  return "upcoming";
}

export type CaptionErrorCode =
  | "empty"
  | "unknown_name"
  | "date_not_in_facts"
  | "weekday_mismatch"
  | "price_not_in_facts"
  | "scarcity_without_tiers"
  | "remaining_unknown"
  | "final_not_true"
  | "count_not_true"
  | "sold_out_not_true"
  | "too_long"
  | "word_too_long"
  | "four_line"
  | "emoji"
  | "hashtag"
  | "all_caps"
  | "crowd_unproven"
  | "next_list"
  | "primary_too_long"
  | "primary_emoji"
  | "signup_on_sale"
  | "ticket_before_sale"
  | "support_artist"
  | "generic_overlay"
  | "set_not_in_facts"
  | "footage_venue"
  | "pick_one"
  | "past_not_in_facts";

export type CaptionError = { code: CaptionErrorCode; detail: string };

export type CaptionValidation = {
  ok: boolean;
  errors: CaptionError[];
  lines: string[];
  factsHash: string;
  sizeVariant: "default" | "long";
};

/** Primary text cap. The overlay cap is the long size's maxChars. */
export const PRIMARY_TEXT_MAX = 125;

export type CaptionCheckOptions = {
  /** Lineup names from the client's other upcoming events. */
  extraNames?: readonly string[];
  /**
   * Tickets sold at the show the clip was filmed at.
   * Null, or leaving it out, rejects a crowd number.
   */
  crowdTicketsSold?: number | null;
  primaryText?: string | null;
  /** Default true. Overlay emoji are never allowed. */
  emojiInPrimary?: boolean;
  /** From events.status, or a stageOverride when that record lags. */
  saleStage?: SaleStage;
  /**
   * The round builder asked for one support artist. lineup, social_proof
   * and whats_next otherwise refuse an overlay that singles support out.
   */
  allowSupportArtist?: string;
  /**
   * The show the clip was filmed at. Footage claims ("same room", "just
   * dropped", "at [venue]" about the clip) need this, and its venue must
   * match. Omit it, or leave the venue empty, and those claims fail.
   */
  clipVenueName?: string | null;
  /**
   * Upcoming show names. "Pick one:" may use 2 or 3 of these, each a
   * different night. Artists on this event's bill are not options.
   */
  upcomingEvents?: readonly string[];
  /**
   * Artist-at-venue pairs the record already holds: a past event of this
   * client, or the show the clip was filmed at. "last season", "back at",
   * "returns to" and "last year" need one of these. A "back in [city]"
   * claim can also be held by the speaking artist's played cities.
   */
  pastAppearances?: readonly { artist: string; venue: string; city?: string | null }[];
  /**
   * Cities the speaking artist has played before, confirmed by the
   * operator, including shows another promoter ran. A city claim passes
   * when the city is in this list, or a past client event holds it.
   */
  playedCities?: readonly string[];
  /**
   * The artist speaking an artist_first_person caption. Past and city
   * claims, and the name check, use this artist when the sentence does
   * not name them.
   */
  speakingArtist?: string | null;
};

/** Case, punctuation and emoji folded, for the per-event dedupe. */
export function normaliseCaption(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Null when either count is unknown. */
export function remainingStock(quantitySold: number | null, quantityAvailable: number | null): number | null {
  if (quantitySold == null || quantityAvailable == null) return null;
  return Math.max(0, quantityAvailable - quantitySold);
}

/**
 * Service role only: event_ticket_tiers has RLS on and no authenticated
 * policy (migration 070). Call after the event's ownership is checked.
 */
export async function loadEventFacts(serviceRoleDb: ServiceRoleDb, eventId: string): Promise<EventFacts> {
  const [eventRes, factsRes, tiersRes] = await Promise.all([
    serviceRoleDb.from("events").select("id, name, event_date, venue_name, venue_city").eq("id", eventId).maybeSingle(),
    serviceRoleDb.from("creative_lab_event_facts").select("lineup, headliners, allowed_dates").eq("event_id", eventId).maybeSingle(),
    serviceRoleDb.from("event_ticket_tiers").select("tier_name, price, quantity_sold, quantity_available").eq("event_id", eventId),
  ]);
  if (eventRes.error) throw new Error(`events: ${eventRes.error.message}`);
  if (factsRes.error) throw new Error(`creative_lab_event_facts: ${factsRes.error.message}`);
  if (tiersRes.error) throw new Error(`event_ticket_tiers: ${tiersRes.error.message}`);
  const event = eventRes.data as {
    id: string;
    name: string;
    event_date: string | null;
    venue_name: string | null;
    venue_city: string | null;
  } | null;
  if (!event) throw new Error(`no event ${eventId}`);
  const facts = factsRes.data as { lineup: string[] | null; headliners?: string[] | null; allowed_dates: string[] | null } | null;
  const tiers = (tiersRes.data ?? []) as {
    tier_name: string;
    price: number | string | null;
    quantity_sold: number | null;
    quantity_available: number | null;
  }[];
  return {
    eventId: event.id,
    eventName: event.name,
    eventDate: event.event_date ? event.event_date.slice(0, 10) : null,
    venueName: event.venue_name,
    venueCity: event.venue_city,
    lineup: (facts?.lineup ?? []).map((n) => n.trim()).filter(Boolean),
    headliners: (facts?.headliners ?? []).map((n) => n.trim()).filter(Boolean),
    hasFacts: facts != null,
    allowedDates: (facts?.allowed_dates ?? []).map((d) => d.slice(0, 10)),
    tiers: tiers.map((t) => ({
      name: t.tier_name,
      price: t.price == null ? null : Number(t.price),
      remaining: remainingStock(t.quantity_sold, t.quantity_available),
    })),
  };
}

// ─── facts hash ──────────────────────────────────────────────────────────────

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function canonicalFactsJson(facts: EventFacts): string {
  return JSON.stringify(
    canonical({
      eventId: facts.eventId,
      eventName: facts.eventName,
      eventDate: facts.eventDate,
      venueName: facts.venueName,
      venueCity: facts.venueCity,
      lineup: [...facts.lineup].sort(),
      headliners: [...(facts.headliners ?? [])],
      allowedDates: [...facts.allowedDates].sort(),
      tiers: facts.tiers
        .map((t) => ({ name: t.name, price: t.price, remaining: t.remaining }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }),
  );
}

export function factsHash(facts: EventFacts): string {
  return createHash("sha256").update(canonicalFactsJson(facts)).digest("hex");
}

// ─── wrap ────────────────────────────────────────────────────────────────────

function tokenKey(raw: string): string {
  const core = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, "").replace(/['’]s$/u, "");
  return core.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "'");
}

/** Names that fit on one line become one atom, longest first, so a wrap cannot split them. */
function atomsOf(paragraph: string, names: readonly string[], width: number): string[] {
  const tokens = paragraph.split(/\s+/).filter(Boolean);
  const phrases = names
    .map((name) => name.split(/\s+/).map(tokenKey).filter(Boolean))
    .filter((parts) => parts.length > 0)
    .sort((a, b) => b.length - a.length);
  const atoms: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    const hit = phrases.find((parts) => {
      if (i + parts.length > tokens.length) return false;
      if (!parts.every((part, j) => tokenKey(tokens[i + j] ?? "") === part)) return false;
      return tokens.slice(i, i + parts.length).join(" ").length <= width;
    });
    if (hit) {
      atoms.push(tokens.slice(i, i + hit.length).join(" "));
      i += hit.length;
      continue;
    }
    atoms.push(tokens[i]);
    i += 1;
  }
  return atoms;
}

/**
 * Squared slack keeps the lines close in length. A single-word line that
 * is not the last pays a penalty larger than any slack, so "coming" rides
 * with the line above when it fits. An explicit newline is a hard break.
 */
function wrapAtoms(atoms: string[], width: number): string[] {
  const n = atoms.length;
  if (!n) return [];
  const cost = Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const brk = Array<number>(n + 1).fill(-1);
  cost[n] = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    if (atoms[i].length > width) {
      cost[i] = cost[i + 1] + width * width;
      brk[i] = i + 1;
      continue;
    }
    let len = 0;
    for (let j = i; j < n; j += 1) {
      len = j === i ? atoms[j].length : len + 1 + atoms[j].length;
      if (len > width) break;
      const slack = (width - len) ** 2 + (j === i && j !== n - 1 ? 10_000 : 0);
      // Equal cost keeps the longer line. A short line then falls to the end.
      if (cost[j + 1] + slack <= cost[i]) {
        cost[i] = cost[j + 1] + slack;
        brk[i] = j + 1;
      }
    }
  }
  const lines: string[] = [];
  for (let i = 0; i < n; ) {
    const next = brk[i];
    if (next <= i) break;
    lines.push(atoms.slice(i, next).join(" "));
    i = next;
  }
  return lines;
}

const DATE_WEEKDAYS = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";
const DATE_MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE_PHRASE = new RegExp(`\\b(?:(${DATE_WEEKDAYS})\\s+)?(\\d{1,2}(?:st|nd|rd|th)?)\\s+(${DATE_MONTHS})\\b`, "gi");

/** "27 December" and, when the line is wide enough, "Sunday 27 December". */
function datePhrases(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(DATE_PHRASE)) {
    found.push(match[0]);
    if (match[1]) found.push(`${match[2]} ${match[3]}`);
  }
  return found;
}

/** Word wrap. `names` and dates that fit at this width move down whole. A word longer than the line stands alone. */
export function wrapCaption(text: string, charsPerLine: number, names: readonly string[] = []): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const protectedPhrases = [...names, ...datePhrases(paragraph)];
    lines.push(...wrapAtoms(atomsOf(paragraph, protectedPhrases, charsPerLine), charsPerLine));
  }
  return lines;
}

function sameArtist(a: string, b: string): boolean {
  const left = a.split(/\s+/).map(tokenKey).filter(Boolean).join(" ");
  const right = b.split(/\s+/).map(tokenKey).filter(Boolean).join(" ");
  return left.length > 0 && left === right;
}

/** Headliners in draw order, then " & more" when the bill has support. */
export function formatBilling(facts: Pick<EventFacts, "lineup" | "headliners">): string {
  const headliners = facts.headliners ?? [];
  if (!headliners.length) return "";
  const support = facts.lineup.filter((name) => !headliners.some((head) => sameArtist(head, name)));
  return support.length ? `${headliners.join(", ")} & more` : headliners.join(", ");
}

// ─── names ───────────────────────────────────────────────────────────────────

const STOPWORDS = new Set(
  [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
    "birthday", "boxing", "day", "days", "night", "nights", "new", "year", "years", "eve", "christmas", "xmas",
    "easter", "halloween", "bank", "holiday", "weekend", "week",
    "final", "release", "last", "first", "early", "bird", "presale", "general", "admission", "sale", "on",
    "tickets", "ticket", "now", "live", "doors", "open", "lineup", "line", "up", "sold", "out", "left", "remaining",
    "limited", "next", "party", "part", "one", "two", "the", "a", "an", "you", "your", "we", "our", "us", "join",
    "don't", "dont", "miss", "it", "this", "that", "all", "see", "who", "what", "are", "ready", "get", "grab", "book",
    "in", "at", "for", "and", "with", "is", "be", "back", "here", "there", "dj", "djs", "b2b", "vip", "special",
    "guest", "guests", "plus", "more", "tba", "tbc", "free", "entry", "only", "under",
  ],
);

const PARTICLES = new Set(["de", "da", "del", "della", "di", "du", "van", "von", "der", "den", "le", "la", "el", "al", "y"]);

type Word = { core: string; key: string; capital: boolean; breakAfter: boolean };

function words(text: string): Word[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const core = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, "").replace(/['’]s$/u, "");
      return {
        core,
        key: normalise(core),
        capital: /^\p{Lu}/u.test(core),
        breakAfter: /[.,!?:;)\]"”–—-]$/u.test(raw),
      };
    });
}

function normalise(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "'")
    .trim();
}

function phraseKeys(s: string): string[] {
  return words(s)
    .map((w) => w.key)
    .filter(Boolean);
}

function containsPhrase(haystack: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((k, j) => haystack[i + j] === k)) return true;
  }
  return false;
}

function knownName(name: string, facts: EventFacts): boolean {
  const key = phraseKeys(name);
  if (!key.length) return false;
  if (facts.lineup.some((n) => phraseKeys(n).join(" ") === key.join(" "))) return true;
  return [facts.eventName, facts.venueName, facts.venueCity].some((s) => s && containsPhrase(phraseKeys(s), key));
}

function checkNames(text: string, declared: readonly string[], facts: EventFacts): CaptionError[] {
  const errors: CaptionError[] = [];
  for (const name of declared) {
    if (!knownName(name, facts)) errors.push({ code: "unknown_name", detail: `"${name}" is not on the lineup, event name or venue` });
  }

  const ws = words(text);
  const covered = ws.map((w) => !w.key || STOPWORDS.has(w.key));
  const fixedWords = new Set(
    [facts.eventName, facts.venueName ?? "", facts.venueCity ?? ""].flatMap((s) => phraseKeys(s)),
  );
  ws.forEach((w, i) => {
    if (fixedWords.has(w.key)) covered[i] = true;
  });
  for (const phrase of [...facts.lineup, ...declared.filter((n) => knownName(n, facts))].map(phraseKeys)) {
    for (let i = 0; i + phrase.length <= ws.length; i += 1) {
      if (phrase.every((k, j) => ws[i + j].key === k)) for (let j = 0; j < phrase.length; j += 1) covered[i + j] = true;
    }
  }

  let run: number[] = [];
  const flush = () => {
    if (run.filter((i) => ws[i].capital).length >= 2) {
      errors.push({ code: "unknown_name", detail: `"${run.map((i) => ws[i].core).join(" ")}" looks like a name not in the facts` });
    }
    run = [];
  };
  for (let i = 0; i < ws.length; i += 1) {
    const w = ws[i];
    const next = ws[i + 1];
    if (!covered[i] && w.capital) {
      run.push(i);
    } else if (
      run.length &&
      !covered[i] &&
      PARTICLES.has(w.key) &&
      !ws[i - 1].breakAfter &&
      next &&
      !covered[i + 1] &&
      next.capital
    ) {
      run.push(i);
      continue;
    } else {
      flush();
      continue;
    }
    if (w.breakAfter) flush();
  }
  flush();
  return errors;
}

// ─── dates ───────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const WEEKDAY_RE = "(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tues|Tue|Wed|Thurs|Thur|Thu|Fri|Sat|Sun)\\b\\.?";
const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

type DateClaim = { start: number; end: number; day: number; month: number; year: number | null; text: string };

function monthOf(token: string): number {
  return MONTHS[token.slice(0, 3).toLowerCase()];
}

function dateClaims(text: string): DateClaim[] {
  const claims: DateClaim[] = [];
  const push = (m: RegExpExecArray, day: number, month: number, year: string | undefined) => {
    if (day < 1 || day > 31 || month < 1 || month > 12) return;
    if (claims.some((c) => m.index < c.end && m.index + m[0].length > c.start)) return;
    claims.push({
      start: m.index,
      end: m.index + m[0].length,
      day,
      month,
      year: year ? Number(year.length === 2 ? `20${year}` : year) : null,
      text: m[0],
    });
  };
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?\\b`, "gi");
  for (let m; (m = dayMonth.exec(text)); ) push(m, Number(m[1]), monthOf(m[2]), m[3]);
  const monthDay = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "gi");
  for (let m; (m = monthDay.exec(text)); ) push(m, Number(m[2]), monthOf(m[1]), m[3]);
  const numeric = /(?<![£$€\d.,])\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?\b(?![.,]?\d)/g;
  for (let m; (m = numeric.exec(text)); ) push(m, Number(m[1]), Number(m[2]), m[3]);
  return claims.sort((a, b) => a.start - b.start);
}

function ymd(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function checkDates(text: string, facts: EventFacts): CaptionError[] {
  const errors: CaptionError[] = [];
  const factDates = [facts.eventDate, ...facts.allowedDates].filter((d): d is string => Boolean(d)).map(ymd);
  const claims = dateClaims(text);
  const resolved = new Map<DateClaim, { y: number; m: number; d: number }>();
  for (const c of claims) {
    const hit = factDates.find((f) => f.m === c.month && f.d === c.day && (c.year == null || c.year === f.y));
    if (hit) resolved.set(c, hit);
    else errors.push({ code: "date_not_in_facts", detail: `"${c.text}" is not the event date or an allowed date` });
  }

  const weekday = new RegExp(`\\b${WEEKDAY_RE}`, "g");
  for (let m; (m = weekday.exec(text)); ) {
    const day = WEEKDAYS[m[1].slice(0, 3).toLowerCase()];
    const after = m.index + m[0].length;
    const attached = claims.find((c) => c.start >= after && /^[\s,]{0,3}$/.test(text.slice(after, c.start)));
    if (attached) {
      const date = resolved.get(attached);
      if (date && weekdayOf(date.y, date.m, date.d) !== day) {
        errors.push({ code: "weekday_mismatch", detail: `"${m[1]}" is not the weekday of ${attached.text}` });
      }
      continue;
    }
    if (!facts.eventDate) {
      errors.push({ code: "date_not_in_facts", detail: `"${m[1]}" but the event has no date` });
      continue;
    }
    const e = ymd(facts.eventDate);
    if (weekdayOf(e.y, e.m, e.d) !== day) {
      errors.push({ code: "weekday_mismatch", detail: `"${m[1]}" is not the event's weekday` });
    }
  }
  return errors;
}

// ─── prices and scarcity ─────────────────────────────────────────────────────

function checkPrices(text: string, facts: EventFacts): CaptionError[] {
  const errors: CaptionError[] = [];
  const prices = facts.tiers.map((t) => t.price).filter((p): p is number => p != null);
  for (const m of text.matchAll(/£\s?(\d{1,5}(?:[.,]\d{1,2})?)/g)) {
    const amount = Number(m[1].replace(",", "."));
    if (!prices.some((p) => Math.abs(p - amount) < 0.005)) {
      errors.push({ code: "price_not_in_facts", detail: `${m[0]} is not a tier price` });
    }
  }
  return errors;
}

/** "last season" is a corpus shape, not a stock claim. "selling fast" and "% sold" are. */
function scarcityClaim(text: string): boolean {
  if (/\b(final|left|remaining|sold\s+out|selling\s+fast)\b/i.test(text)) return true;
  if (/%\s*sold|\bpercent(?:age)?\s+sold\b/i.test(text)) return true;
  return /\blast\b(?!\s+(?:season|year|weekend|night|time|month|week)\b)/i.test(text);
}

function checkScarcity(text: string, style: CaptionStyle, facts: EventFacts): CaptionError[] {
  if (style !== "scarcity" && !scarcityClaim(text)) return [];
  if (!facts.tiers.length) return [{ code: "scarcity_without_tiers", detail: "the event has no ticket tiers" }];
  if (facts.tiers.some((t) => t.remaining == null)) {
    return [{ code: "remaining_unknown", detail: "a tier's remaining stock is not known" }];
  }
  const errors: CaptionError[] = [];
  const remaining = facts.tiers.reduce((s, t) => s + (t.remaining as number), 0);

  if (/\b(final|last)\b/i.test(text)) {
    const inStock = facts.tiers.filter((t) => (t.remaining as number) > 0);
    const top = Math.max(...facts.tiers.map((t) => t.price ?? Number.NEGATIVE_INFINITY));
    if (inStock.length !== 1 || inStock[0].price == null || inStock[0].price !== top) {
      errors.push({
        code: "final_not_true",
        detail: `${inStock.length} tier(s) in stock; "final"/"last" needs exactly one, the highest-priced`,
      });
    }
  }
  for (const m of text.matchAll(/\b(?:under|less than|fewer than)\s+(\d+)\b/gi)) {
    if (!(remaining < Number(m[1]))) errors.push({ code: "count_not_true", detail: `"${m[0]}" but ${remaining} remain` });
  }
  for (const m of text.matchAll(/\b(?:only\s+)?(\d+)\s+(?:tickets?\s+)?(?:left|remaining)\b/gi)) {
    if (/\b(?:under|less than|fewer than)\s+$/i.test(text.slice(0, m.index))) continue;
    if (!(remaining <= Number(m[1]))) errors.push({ code: "count_not_true", detail: `"${m[0]}" but ${remaining} remain` });
  }
  if (/\bsold\s+out\b/i.test(text) && !facts.tiers.some((t) => t.remaining === 0)) {
    errors.push({ code: "sold_out_not_true", detail: "no tier has sold out" });
  }
  return errors;
}

// ─── crowd, next lists, size ─────────────────────────────────────────────────

const CROWD_RE = /\b(\d{1,3}(?:,\d{3})+|\d+)\s+(?:music\s+lovers|people)\b/gi;

function crowdClaims(text: string): { raw: string; n: number }[] {
  return [...text.matchAll(CROWD_RE)].map((m) => ({ raw: m[0], n: Number(m[1].replace(/,/g, "")) }));
}

/** Why a crowd number cannot be said for this filmed show. Null when the text makes no claim, or the count covers it. */
export function crowdBlock(text: string, ticketsSold: number | null): string | null {
  return checkCrowd(text, ticketsSold)[0]?.detail ?? null;
}

function checkCrowd(text: string, ticketsSold: number | null | undefined): CaptionError[] {
  const claims = crowdClaims(text);
  if (!claims.length) return [];
  if (ticketsSold == null) {
    return claims.map((c) => ({
      code: "crowd_unproven" as const,
      detail: `"${c.raw}" needs the filmed show's tickets sold, and this clip has no filmed show`,
    }));
  }
  return claims
    .filter((c) => ticketsSold < c.n)
    .map((c) => ({ code: "crowd_unproven" as const, detail: `"${c.raw}" but the filmed show sold ${ticketsSold}` }));
}

/** Names after "Next:", "& more" stripped. Null when the caption has no Next list. */
export function nextListItems(text: string): string[] | null {
  const at = /\bnext\s*:/i.exec(text);
  if (!at) return null;
  return text
    .slice(at.index + at[0].length)
    .split(",")
    .map((item) => item.replace(/\s*&?\s*\bmore\b\.?$/i, "").trim())
    .filter(Boolean);
}

function itemIsName(item: string, name: string): boolean {
  const wanted = phraseKeys(name);
  if (!wanted.length) return false;
  const have = new Set(phraseKeys(item));
  return wanted.every((key) => have.has(key));
}

function checkNextList(text: string, allowedNames: readonly string[]): CaptionError[] {
  const items = nextListItems(text);
  if (!items) return [];
  const errors: CaptionError[] = [];
  if (items.length > 3) {
    errors.push({ code: "next_list", detail: `${items.length} names after Next:; at most 3` });
  }
  for (const item of items) {
    if (!allowedNames.some((name) => itemIsName(item, name))) {
      errors.push({ code: "unknown_name", detail: `"${item}" is not on an upcoming lineup for this client` });
    }
  }
  return errors;
}

function withExtraNames(facts: EventFacts, extra: readonly string[]): EventFacts {
  return extra.length ? { ...facts, lineup: [...facts.lineup, ...extra] } : facts;
}

function nextAllowed(facts: EventFacts, extra: readonly string[]): string[] {
  const own = facts.headliners?.length ? facts.headliners : facts.lineup;
  return [...own, ...extra];
}

function factErrors(
  text: string,
  style: CaptionStyle,
  declared: readonly string[],
  facts: EventFacts,
  extra: readonly string[],
  ticketsSold: number | null | undefined,
): CaptionError[] {
  const named = withExtraNames(facts, extra);
  return [
    ...checkNames(text, declared, named),
    ...checkDates(text, facts),
    ...checkPrices(text, facts),
    ...checkScarcity(text, style, facts),
    ...checkCrowd(text, ticketsSold),
    ...checkNextList(text, nextAllowed(facts, extra)),
  ];
}

const SIGNUP_RE = /\bsign[\s-]?up\b|\bget on the list\b|\bpriority access\b|\bpresale\b/i;
const TICKET_RE = /\btickets?\b|\bgrab yours\b|\bon sale\b|\bbuy\b/i;
const GENERIC_OVERLAY = /\bsign up now\b|\bfour years deep\b|\bthis one matters\b/i;

function checkStage(text: string, stage: SaleStage): CaptionError[] {
  if (!text.trim()) return [];
  if (stage === "on_sale" && SIGNUP_RE.test(text)) {
    return [{ code: "signup_on_sale", detail: "tickets are on sale; the caption asks people to sign up" }];
  }
  if (stage !== "on_sale" && TICKET_RE.test(text)) {
    return [{ code: "ticket_before_sale", detail: "tickets are not on sale; the caption asks people to buy" }];
  }
  return [];
}

function mentionsArtist(text: string, name: string): boolean {
  return containsPhrase(phraseKeys(text), phraseKeys(name));
}

function checkBilling(text: string, style: CaptionStyle, facts: EventFacts, allowSupport?: string): CaptionError[] {
  if (!facts.headliners || !["lineup", "social_proof", "whats_next"].includes(style)) return [];
  const support = facts.lineup.filter((name) => !facts.headliners!.some((head) => sameArtist(head, name)));
  const mentioned = support.filter((name) => mentionsArtist(text, name));
  if (!mentioned.length) return [];
  const full = facts.lineup.every((name) => mentionsArtist(text, name));
  if (full) return [];
  if (allowSupport && mentioned.length === 1 && sameArtist(mentioned[0], allowSupport)) return [];
  return [{
    code: "support_artist",
    detail: `"${mentioned[0]}" is support; name the headliners, the full lineup, or "& more"`,
  }];
}

/** A line whose only idea is that the brand turns N. */
function bareBirthday(line: string): boolean {
  const trimmed = line.trim().replace(/[.!]+$/g, "");
  return /^(?:\d+\s+years(?:\s+of\s+[\p{L}\s]+)?|[\p{L}\s]{0,40}?\bturns?\s+\d+)$/iu.test(trimmed);
}

/** No set-time column exists yet, so a slot claim cannot be true. */
const SET_RE = /\b(closing out|closing|opening|first track|last track|headlining|b2b|all night long|sunrise set|\d+\s*-?\s*hours?\s+set)\b/i;

function checkSet(text: string): CaptionError[] {
  const claim = text.match(SET_RE);
  if (!claim) return [];
  return [{ code: "set_not_in_facts", detail: `"${claim[1]}" is a set time, and the event record has none` }];
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sameVenue(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * A claim that the clip was filmed in the room. Future lines about the
 * show ("is playing Circuit", "are taking over Circuit", "{artist} at
 * {venue}") are the booking, not the footage.
 */
function checkFootage(text: string, facts: EventFacts, clipVenue: string | null | undefined): CaptionError[] {
  const promoted = facts.venueName?.trim() ?? "";
  const clip = clipVenue?.trim() ?? "";
  const errors: CaptionError[] = [];
  const room = text.match(/\b(same room|this room|in here)\b/i);
  if (room && (!clip || !promoted || !sameVenue(clip, promoted))) {
    errors.push({ code: "footage_venue", detail: `"${room[1]}" needs a clip filmed at ${promoted || "this event's venue"}` });
  }
  const cue = text.match(/\b(just dropped|right now)\b/i);
  const atPromoted = promoted ? new RegExp(`\\bat\\s+${escapeReg(promoted)}\\b`, "i").test(text) : false;
  const thisIsPromoted = promoted ? new RegExp(`\\bthis is\\s+${escapeReg(promoted)}\\b`, "i").test(text) : false;
  const footage = Boolean(cue || thisIsPromoted || (atPromoted && cue));
  if (footage && (!clip || !promoted || !sameVenue(clip, promoted))) {
    const phrase = cue?.[1] ?? `this is ${promoted}`;
    errors.push({ code: "footage_venue", detail: `"${phrase}" needs a clip filmed at ${promoted || "this event's venue"}` });
  }
  return errors;
}

function checkPickOne(text: string, facts: EventFacts, upcoming: readonly string[]): CaptionError[] {
  const found = text.match(/\bpick one\s*:\s*(.+)$/i);
  if (!found) return [];
  const tail = found[1].trim();
  if (/\bnext\s*:/i.test(tail)) {
    return [{ code: "pick_one", detail: `"Pick one:" cannot introduce a Next list` }];
  }
  const shows = [...new Set(upcoming.map((name) => name.trim()).filter(Boolean))];
  if (shows.length < 2) {
    return [{ code: "pick_one", detail: `"Pick one:" needs 2 upcoming shows and this client has ${shows.length}` }];
  }
  const options = tail
    .split(/\s*,\s*|\s+\bor\b\s+|\s+\band\b\s+/i)
    .map((option) => option.replace(/[.!?]+$/g, "").trim())
    .filter(Boolean);
  if (options.length < 2 || options.length > 3) {
    return [{ code: "pick_one", detail: `"Pick one:" needs 2 or 3 options and has ${options.length}` }];
  }
  const keys = options.map((option) => phraseKeys(option).join(" "));
  if (new Set(keys).size !== keys.length) {
    return [{ code: "pick_one", detail: `"Pick one:" options have to be different nights` }];
  }
  const bill = [...facts.lineup, ...(facts.headliners ?? [])];
  for (const option of options) {
    const key = phraseKeys(option).join(" ");
    if (bill.some((name) => phraseKeys(name).join(" ") === key)) {
      return [{ code: "pick_one", detail: `"${option}" is on this event's bill, not another night` }];
    }
    if (!shows.some((name) => phraseKeys(name).join(" ") === key)) {
      return [{ code: "pick_one", detail: `"${option}" is not an upcoming show` }];
    }
  }
  return [];
}

const PAST_CUE = /\blast season\b|\blast year\b|\bback at\b|\bback in\b|\breturns to\b/i;

function venueAfter(text: string, cue: string): string | null {
  const match = text.match(new RegExp(`\\b${cue}\\s+([\\p{L}\\p{N}'’.-]+(?:\\s+[\\p{L}\\p{N}'’.-]+){0,3})`, "iu"));
  if (!match) return null;
  const stop = /^(on|to|for|last|this|at|with|the|and|w)$/i;
  const kept: string[] = [];
  for (const word of match[1].split(/\s+/)) {
    if (stop.test(word)) break;
    kept.push(word.replace(/[.!,]+$/g, ""));
  }
  return kept.join(" ").trim() || null;
}

/**
 * "last season", "back at", "returns to" and "last year" are a past
 * appearance. Allowed only when a past show, or the clip's filmed show,
 * has that artist on the lineup at that venue. "back in [city]" also
 * passes when that city is in the speaking artist's played cities.
 */
function checkPast(
  text: string,
  facts: EventFacts,
  declared: readonly string[],
  past: readonly { artist: string; venue: string; city?: string | null }[] | undefined,
  speakingArtist?: string | null,
  playedCities?: readonly string[],
): CaptionError[] {
  if (!PAST_CUE.test(text)) return [];
  const claimed = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => PAST_CUE.test(sentence))
    .join(" ");
  const speaker = speakingArtist?.trim() ?? "";
  const known = [...facts.lineup, ...(facts.headliners ?? []), ...declared, speaker].filter(Boolean);
  const named = known.filter((name) => mentionsArtist(claimed, name));
  const artists = named.length ? named : speaker ? [speaker] : [];
  const city = venueAfter(claimed, "back in");
  if (city) {
    if (!artists.length) {
      return [{ code: "past_not_in_facts", detail: "a past appearance needs an artist and a city the record holds" }];
    }
    const held = past ?? [];
    const played = playedCities ?? [];
    for (const artist of artists) {
      const pastShow = held.some((row) => sameArtist(row.artist, artist) && sameVenue(row.city ?? "", city));
      const confirmed = Boolean(speaker) && sameArtist(artist, speaker) && played.some((row) => sameVenue(row, city));
      if (!pastShow && !confirmed) return [{ code: "past_not_in_facts", detail: `no past show has ${artist} in ${city}` }];
    }
    return [];
  }
  let venue = venueAfter(claimed, "back at") ?? venueAfter(claimed, "returns to");
  const season = claimed.match(/\bat\s+([\p{L}\p{N}'’.-]+(?:\s+[\p{L}\p{N}'’.-]+){0,3})\s+last season\b/iu);
  if (season) venue = season[1].replace(/[.!,]+$/g, "").trim();
  if (!venue && facts.venueName && new RegExp(`\\bat\\s+${escapeReg(facts.venueName)}\\b`, "i").test(claimed)) {
    venue = facts.venueName;
  }
  if (!artists.length || !venue) {
    return [{ code: "past_not_in_facts", detail: "a past appearance needs an artist and a venue the record holds" }];
  }
  const held = past ?? [];
  for (const artist of artists) {
    const hit = held.some((row) => sameArtist(row.artist, artist) && sameVenue(row.venue, venue!));
    if (!hit) {
      return [{ code: "past_not_in_facts", detail: `no past show has ${artist} at ${venue}` }];
    }
  }
  return [];
}

function checkVoice(text: string, lines: string[]): CaptionError[] {
  if (GENERIC_OVERLAY.test(text)) {
    return [{ code: "generic_overlay", detail: "the overlay is a generic line" }];
  }
  const bare = lines.find(bareBirthday);
  if (bare) return [{ code: "generic_overlay", detail: `"${bare}" only says the brand turns a number` }];
  return [];
}

function layoutErrors(text: string, lines: string[], maxLines: number, charsPerLine: number, style: CaptionStyle): CaptionError[] {
  const errors: CaptionError[] = [];
  const over = text.split(/\s+/).find((word) => word.length > charsPerLine);
  if (over) errors.push({ code: "word_too_long", detail: `"${over}" is longer than ${charsPerLine} characters` });
  if (style === "four_line" && lines.length !== 4) {
    errors.push({ code: "four_line", detail: `four_line needs exactly 4 lines and wrapped to ${lines.length}` });
  } else if (lines.length > maxLines) {
    errors.push({ code: "too_long", detail: `${lines.length} lines at ${charsPerLine} characters; at most ${maxLines}` });
  }
  if (/\p{Extended_Pictographic}/u.test(text)) errors.push({ code: "emoji", detail: "emoji are not allowed on the overlay" });
  if (text.includes("#")) errors.push({ code: "hashtag", detail: "'#' is not allowed" });
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length >= 4 && !/\p{Ll}/u.test(text)) errors.push({ code: "all_caps", detail: "all capitals" });
  return errors;
}

// ─── validate ────────────────────────────────────────────────────────────────

export function validateCaption(
  text: string,
  style: CaptionStyle,
  declaredNames: readonly string[],
  facts: EventFacts,
  styleProfile: StyleProfile,
  options: CaptionCheckOptions = {},
): CaptionValidation {
  const errors: CaptionError[] = [];
  // four_line uses the writer's line breaks. Every other style is reflowed,
  // so a newline cannot leave a one-word line in the middle.
  const trimmed = (style === "four_line" ? text : text.replace(/[\r\n]+/g, " ")).trim().replace(/[ \t]+/g, " ");
  const extra = options.extraNames ?? [];
  const speaker = style === "artist_first_person" ? options.speakingArtist?.trim() ?? "" : "";
  const declared = speaker && !declaredNames.some((name) => sameArtist(name, speaker)) ? [...declaredNames, speaker] : declaredNames;
  if (!trimmed) errors.push({ code: "empty", detail: "no text" });

  const chars = trimmed.length;
  if (chars > profile.long.maxChars) {
    errors.push({ code: "too_long", detail: `${chars} characters; an overlay is at most ${profile.long.maxChars}` });
  }
  const protectedNames = [...facts.lineup, ...(facts.headliners ?? []), ...declared, ...extra];
  const defaultWidth = styleProfile.charsPerLine ?? CHARS_PER_LINE;
  const defaultLines = style === "four_line" ? [] : wrapCaption(trimmed, defaultWidth, protectedNames);
  const long = style !== "four_line" && (chars >= profile.long.minChars || defaultLines.length > (styleProfile.maxLines ?? DEFAULT_MAX_LINES));
  const charsPerLine = long ? profile.long.charsPerLine : defaultWidth;
  const maxLines = long ? profile.long.maxLines : (styleProfile.maxLines ?? DEFAULT_MAX_LINES);
  const lines = long ? wrapCaption(trimmed, charsPerLine, protectedNames) : style === "four_line" ? wrapCaption(trimmed, charsPerLine, protectedNames) : defaultLines;
  const sizeVariant = long ? "long" : "default";

  errors.push(...factErrors(trimmed, style, declared, facts, extra, options.crowdTicketsSold));
  errors.push(...layoutErrors(trimmed, lines, maxLines, charsPerLine, style));
  errors.push(...checkBilling(trimmed, style, facts, options.allowSupportArtist));
  errors.push(...checkVoice(trimmed, lines));
  errors.push(...checkSet(trimmed));
  errors.push(...checkFootage(trimmed, facts, options.clipVenueName));
  errors.push(...checkPickOne(trimmed, facts, options.upcomingEvents ?? []));
  errors.push(...checkPast(trimmed, facts, declared, options.pastAppearances, speaker, options.playedCities));
  if (options.saleStage) errors.push(...checkStage(trimmed, options.saleStage));

  const primary = options.primaryText?.trim() ?? "";
  if (options.primaryText != null) {
    if (primary.length > PRIMARY_TEXT_MAX) {
      errors.push({ code: "primary_too_long", detail: `${primary.length} characters; primary text is at most ${PRIMARY_TEXT_MAX}` });
    }
    if ((options.emojiInPrimary ?? true) === false && /\p{Extended_Pictographic}/u.test(primary)) {
      errors.push({ code: "primary_emoji", detail: "this client does not allow emoji in primary text" });
    }
    errors.push(...factErrors(primary, style, declared, facts, extra, options.crowdTicketsSold));
    errors.push(...checkSet(primary));
    errors.push(...checkFootage(primary, facts, options.clipVenueName));
    errors.push(...checkPickOne(primary, facts, options.upcomingEvents ?? []));
    errors.push(...checkPast(primary, facts, declared, options.pastAppearances, speaker, options.playedCities));
    if (options.saleStage) errors.push(...checkStage(primary, options.saleStage));
  }

  return { ok: errors.length === 0, errors, lines, factsHash: factsHash(facts), sizeVariant };
}
