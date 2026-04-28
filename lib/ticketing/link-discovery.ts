/**
 * lib/ticketing/link-discovery.ts
 *
 * Pure matching logic for PR 5's Eventbrite link-discovery sweep.
 * Keeps scoring + candidate ranking out of the route handler so it
 * stays unit-testable with no Supabase / no fetch.
 *
 * Algorithm:
 *   1. For each internal event, compute `labelMatchScore` against
 *      every external event name AND against "<external name>
 *      <venue>" if a venue is passed (so e.g. "England v Croatia" can
 *      match "England v Croatia · Brighton Fanpark" even though the
 *      external name is longer).
 *   2. Optionally promote candidates that share a date window — an
 *      external event whose `startsAt` falls within +/- DATE_WINDOW
 *      days of the internal `event_date` gets a small confidence
 *      bump. This is an addition over the raw Jaccard score (which
 *      otherwise ignores dates) and reflects operator intuition
 *      ("it's the right opponent AND the right weekend").
 *   3. Sort descending by final score, keep top N candidates above
 *      `minScore` (default 0.5 — matches the brief).
 */

import { labelMatchScore } from "./fuzzy-match.ts";

export interface InternalEventForMatching {
  id: string;
  name: string;
  event_date: string | null;
  venue_name: string | null;
  venue_city: string | null;
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
  status?: string | null;
}

export interface MatchCandidate {
  externalEventId: string;
  externalName: string;
  externalUrl: string | null;
  externalStartsAt: string | null;
  /** Final composite score after date bonus. Capped at 1. */
  confidence: number;
  /** Underlying Jaccard/contains score (pre-date-bonus). */
  nameScore: number;
  /** True when dates match within the configured window. */
  dateMatch: boolean;
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
  /**
   * Days of wiggle room around the internal event_date for the date
   * bonus. Defaults to 3 (cover weekend drift / time-zone edges).
   */
  dateWindowDays?: number;
  /**
   * Additional confidence added when `dateMatch` is true. Defaults to
   * 0.1 — enough to tip ties but not enough to rescue a weak name
   * match.
   */
  dateBonus?: number;
}

const DEFAULTS = {
  minScore: 0.5,
  maxPerEvent: 5,
  dateWindowDays: 3,
  dateBonus: 0.1,
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
  const dateWindowDays = options.dateWindowDays ?? DEFAULTS.dateWindowDays;
  const dateBonus = options.dateBonus ?? DEFAULTS.dateBonus;

  const internalLabel = composeMatchableInternalLabel(event);

  const scored: MatchCandidate[] = [];
  for (const ext of externals) {
    const externalLabel = composeMatchableExternalLabel(ext);
    const nameScore = labelMatchScore(internalLabel, externalLabel);
    if (nameScore <= 0) continue;
    const dateMatch = datesWithinWindow(
      event.event_date,
      ext.startsAt,
      dateWindowDays,
    );
    const confidence = Math.min(1, nameScore + (dateMatch ? dateBonus : 0));
    if (confidence < minScore) continue;
    scored.push({
      externalEventId: ext.externalEventId,
      externalName: ext.name,
      externalUrl: ext.url,
      externalStartsAt: ext.startsAt,
      confidence,
      nameScore,
      dateMatch,
    });
  }

  scored.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.externalEventId.localeCompare(b.externalEventId);
  });

  return scored.slice(0, maxPerEvent);
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
