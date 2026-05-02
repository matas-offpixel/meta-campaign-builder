/**
 * lib/ticketing/link-discovery.ts
 *
 * Pure matching logic for ticketing link-discovery sweeps.
 * Keeps scoring + candidate ranking out of the route handler so it
 * stays unit-testable with no Supabase / no fetch.
 *
 * Algorithm:
 *   1. Venue token overlap is load-bearing (0.55). 4thefans can have
 *      many same-name/same-date events across venues, so a confident
 *      venue match is required for auto-confirm.
 *   2. Opponent overlap contributes 0.25. Same-day/same-venue events
 *      often only differ by opponent.
 *   3. Date proximity contributes 0.15: exact, within 1 day, within
 *      3 days, then zero.
 *   4. Name token overlap contributes 0.05 after stripping provider
 *      venue prefixes from names such as "Bristol – England v Croatia".
 */

import { extractOpponentName } from "../db/event-opponent-extraction.ts";
import { normalizeEventLabel } from "./fuzzy-match.ts";

export interface InternalEventForMatching {
  id: string;
  name: string;
  event_date: string | null;
  venue_name: string | null;
  venue_city: string | null;
  capacity?: number | null;
}

export interface ExternalEventForMatching {
  externalEventId: string;
  name: string;
  startsAt: string | null;
  url: string | null;
  /**
   * Optional — some providers (Eventbrite) don't expose venue in the
   * list endpoint. When present, venue tokens contribute to the
   * confidence score.
   */
  venue?: string | null;
  capacity?: number | null;
  status?: string | null;
}

export interface MatchCandidate {
  externalEventId: string;
  externalName: string;
  externalUrl: string | null;
  externalStartsAt: string | null;
  externalVenue: string | null;
  externalCapacity: number | null;
  /** Final weighted score: venue + opponent/date/name components. */
  confidence: number;
  /** Venue-token Jaccard score. Must be high for auto-confirm. */
  venueScore: number;
  /** Opponent-token Jaccard score. */
  opponentScore: number;
  /** Date proximity score (exact=1, <=1d=.7, <=3d=.3). */
  dateScore: number;
  /** Name-token Jaccard score after stripping external venue prefixes. */
  nameScore: number;
  /** True when dates match within the configured window. */
  dateMatch: boolean;
  /** True when both capacities exist and differ by no more than 5%. */
  capacityMatch: boolean;
  /** True when this row is safe to preselect for bulk linking. */
  autoConfirm: boolean;
  /**
   * True when scoring and deterministic tie-breaks still cannot separate
   * multiple candidates. UI should make the operator choose explicitly.
   */
  manualDisambiguationRequired: boolean;
}

export interface MatchResult {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  venueName: string | null;
  candidates: MatchCandidate[];
}

export interface ScoreCandidatesOptions {
  /** Minimum `confidence` to include a candidate. Defaults to 0.5. */
  minScore?: number;
  /** Max candidates per internal event. Defaults to 5. */
  maxPerEvent?: number;
  autoConfirmThreshold?: number;
  autoConfirmVenueThreshold?: number;
}

const DEFAULTS = {
  minScore: 0.55,
  maxPerEvent: 5,
  autoConfirmThreshold: 0.9,
  autoConfirmVenueThreshold: 0.8,
} as const;

const VENUE_STOPWORDS = new Set([
  "the",
  "of",
  "and",
  "club",
  "building",
  "park",
  "hall",
  "arena",
  "stadium",
  "centre",
  "center",
  "room",
  "bar",
  "pub",
  "venue",
  "fanpark",
  "fan",
  "zone",
  "square",
]);

const NAME_STOPWORDS = new Set([
  "v",
  "vs",
  "versus",
  "group",
  "stage",
  "premier",
  "league",
  "world",
  "cup",
  "wc",
  "wc26",
  "fifa",
  "live",
  "screening",
]);

const HOME_TEAMS = new Set(["england", "scotland", "wales", "northern ireland"]);

const KNOCKOUT_LABEL_RE =
  /\b(?:last\s*32|last\s*16|round\s*of\s*16|quarter(?:\s*final)?|semi(?:\s*final)?|final|knockout)\b/i;

const WEIGHTS_WITH_OPPONENT = {
  venue: 0.55,
  opponent: 0.25,
  date: 0.15,
  name: 0.05,
} as const;

const WEIGHTS_WITHOUT_OPPONENT = {
  venue: 0.55,
  date: 0.15,
  name: 0.3,
} as const;

/**
 * Returns true when the two ISO date strings fall within
 * `windowDays` of each other. Both values are parsed leniently —
 * any unparseable string yields false rather than throwing.
 */
export function datesWithinWindow(
  a: string | null,
  b: string | null,
  windowDays: number,
): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  const diffMs = Math.abs(ta - tb);
  return diffMs <= windowDays * 24 * 60 * 60 * 1000;
}

export function dateProximityScore(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  const days = Math.abs(ta - tb) / (24 * 60 * 60 * 1000);
  if (days < 1) return 1;
  if (days <= 1) return 0.7;
  if (days <= 3) return 0.3;
  return 0;
}

/**
 * Compose a combined "name + venue" label used when the external
 * list lacks a structured venue field. Eventbrite list responses
 * concat the venue into the name (e.g. "England v Croatia · Brighton
 * Fanpark"), so feeding the raw name into the matcher already
 * captures this. We keep the helper pure so the internal tooling can
 * override it when providers evolve.
 */
export function composeMatchableExternalLabel(
  external: ExternalEventForMatching,
): string {
  return external.venue
    ? `${external.name} ${external.venue}`
    : external.name;
}

/**
 * Compose an internal-side label that includes the venue name +
 * city so external candidates that carry venue in their name score
 * higher. Keeping venue out of the raw event name (the canonical
 * shape in the DB) means every internal row is "England v Croatia";
 * the venue context is attached here only for matching.
 */
export function composeMatchableInternalLabel(
  event: InternalEventForMatching,
): string {
  const parts = [event.name, event.venue_name, event.venue_city].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  return parts.join(" ");
}

export function tokenJaccard(
  a: string | null | undefined,
  b: string | null | undefined,
  stopwords: Set<string>,
): number {
  const ta = tokenSet(a, stopwords);
  const tb = tokenSet(b, stopwords);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const token of ta) if (tb.has(token)) intersection += 1;
  return intersection / (ta.size + tb.size - intersection);
}

export function stripExternalVenuePrefix(name: string): string {
  const parts = name
    .split(/\s+(?:[-–—|])\s+|\s*[–—|]\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

export function opponentLabelForMatching(name: string): string | null {
  const stripped = stripExternalVenuePrefix(name).trim();
  const extracted = extractOpponentName(stripped);
  if (extracted && !HOME_TEAMS.has(extracted)) return extracted;

  if (extracted && HOME_TEAMS.has(extracted)) {
    const parts = stripped
      .split(/\s+(?:vs?|x|-)\s+/i)
      .map((part) => part.trim())
      .filter(Boolean);
    const left = parts[0]?.toLowerCase() ?? "";
    if (left && !HOME_TEAMS.has(left)) return left;
  }

  const knockout = stripped.match(KNOCKOUT_LABEL_RE)?.[0];
  if (knockout) return normalizeEventLabel(knockout);

  const tokens = tokenSet(stripped, NAME_STOPWORDS);
  const nonHome = [...tokens].filter((token) => !HOME_TEAMS.has(token));
  return nonHome.length === 1 ? nonHome[0] : null;
}

function tokenSet(
  value: string | null | undefined,
  stopwords: Set<string>,
): Set<string> {
  return new Set(
    normalizeEventLabel(value ?? "")
      .split(" ")
      .filter((token) => token.length > 1 && !stopwords.has(token)),
  );
}

function externalVenueLabel(external: ExternalEventForMatching): string | null {
  if (external.venue?.trim()) return external.venue;
  const parts = external.name
    .split(/\s+(?:[-–—|])\s+|\s*[–—|]\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts[0] : null;
}

function internalVenueLabel(event: InternalEventForMatching): string {
  return [event.venue_name, event.venue_city]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ");
}

function capacityWithinFivePercent(
  internalCapacity: number | null | undefined,
  externalCapacity: number | null | undefined,
): boolean {
  if (
    internalCapacity == null ||
    externalCapacity == null ||
    internalCapacity <= 0 ||
    externalCapacity <= 0
  ) {
    return false;
  }
  return Math.abs(internalCapacity - externalCapacity) / internalCapacity <= 0.05;
}

function startsAtTime(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function sameManualTieGroup(a: MatchCandidate, b: MatchCandidate): boolean {
  return (
    Math.abs(a.confidence - b.confidence) < 0.000001 &&
    startsAtTime(a.externalStartsAt) === startsAtTime(b.externalStartsAt) &&
    a.capacityMatch === b.capacityMatch
  );
}

/**
 * Score every external event against a single internal event,
 * returning the top `maxPerEvent` candidates with `confidence >=
 * minScore`. Deterministic: sorts by confidence desc, tie-breaks on
 * externalEventId lexicographically so snapshot tests stay stable.
 */
export function scoreCandidatesForEvent(
  event: InternalEventForMatching,
  externals: ExternalEventForMatching[],
  options: ScoreCandidatesOptions = {},
): MatchCandidate[] {
  const minScore = options.minScore ?? DEFAULTS.minScore;
  const maxPerEvent = options.maxPerEvent ?? DEFAULTS.maxPerEvent;
  const autoConfirmThreshold =
    options.autoConfirmThreshold ?? DEFAULTS.autoConfirmThreshold;
  const autoConfirmVenueThreshold =
    options.autoConfirmVenueThreshold ?? DEFAULTS.autoConfirmVenueThreshold;
  const internalVenue = internalVenueLabel(event);

  const scored: MatchCandidate[] = [];
  for (const ext of externals) {
    const extVenue = externalVenueLabel(ext);
    const venueScore = tokenJaccard(internalVenue, extVenue, VENUE_STOPWORDS);
    const dateScore = dateProximityScore(event.event_date, ext.startsAt);
    const nameScore = tokenJaccard(
      event.name,
      stripExternalVenuePrefix(ext.name),
      NAME_STOPWORDS,
    );
    const internalOpponent = opponentLabelForMatching(event.name);
    const externalOpponent = opponentLabelForMatching(ext.name);
    const hasOpponentScore = Boolean(internalOpponent && externalOpponent);
    const opponentScore = hasOpponentScore
      ? tokenJaccard(internalOpponent, externalOpponent, new Set())
      : 0;
    const confidence = hasOpponentScore
      ? venueScore * WEIGHTS_WITH_OPPONENT.venue +
        opponentScore * WEIGHTS_WITH_OPPONENT.opponent +
        dateScore * WEIGHTS_WITH_OPPONENT.date +
        nameScore * WEIGHTS_WITH_OPPONENT.name
      : venueScore * WEIGHTS_WITHOUT_OPPONENT.venue +
        dateScore * WEIGHTS_WITHOUT_OPPONENT.date +
        nameScore * WEIGHTS_WITHOUT_OPPONENT.name;
    if (confidence < minScore) continue;
    const capacityMatch = capacityWithinFivePercent(
      event.capacity,
      ext.capacity,
    );
    scored.push({
      externalEventId: ext.externalEventId,
      externalName: ext.name,
      externalUrl: ext.url,
      externalStartsAt: ext.startsAt,
      externalVenue: extVenue,
      externalCapacity: ext.capacity ?? null,
      confidence,
      venueScore,
      opponentScore,
      dateScore,
      nameScore,
      dateMatch: dateScore > 0,
      capacityMatch,
      autoConfirm:
        confidence >= autoConfirmThreshold &&
        venueScore >= autoConfirmVenueThreshold,
      manualDisambiguationRequired: false,
    });
  }

  scored.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const dateDiff =
      startsAtTime(a.externalStartsAt) - startsAtTime(b.externalStartsAt);
    if (dateDiff !== 0) return dateDiff;
    if (a.capacityMatch !== b.capacityMatch) return a.capacityMatch ? -1 : 1;
    return a.externalEventId.localeCompare(b.externalEventId);
  });

  if (scored.length > 1) {
    const top = scored[0];
    const unresolvedTopTies = scored.filter((candidate) =>
      sameManualTieGroup(candidate, top),
    );
    if (unresolvedTopTies.length > 1) {
      for (const candidate of unresolvedTopTies) {
        candidate.manualDisambiguationRequired = true;
        candidate.autoConfirm = false;
      }
    }
  }

  const sliced = scored.slice(0, maxPerEvent);
  const cutoff = sliced[sliced.length - 1];
  if (!cutoff) return sliced;
  const extraTies = scored
    .slice(maxPerEvent)
    .filter((candidate) => sameManualTieGroup(candidate, cutoff));
  return [...sliced, ...extraTies];
}

/**
 * Top-level discovery: scores every internal event against the
 * external list and returns one `MatchResult` per internal event
 * (including events with zero candidates — the UI still displays
 * them so the operator knows nothing matched).
 */
export function discoverMatches(
  events: InternalEventForMatching[],
  externals: ExternalEventForMatching[],
  options: ScoreCandidatesOptions = {},
): MatchResult[] {
  return events.map((event) => ({
    eventId: event.id,
    eventName: event.name,
    eventDate: event.event_date,
    venueName: event.venue_name,
    candidates: scoreCandidatesForEvent(event, externals, options),
  }));
}
