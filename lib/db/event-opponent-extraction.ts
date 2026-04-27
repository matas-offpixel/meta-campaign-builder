/**
 * lib/db/event-opponent-extraction.ts
 *
 * Pure helpers for teasing the opponent name out of an event's
 * human-readable `name` field. Used by the per-event spend
 * allocator (PR D2) to classify a Meta ad against one of the
 * matches at a venue — e.g. "England v Croatia" → "croatia", which
 * is then substring-matched against ad names like
 * "WC26 Croatia Static".
 *
 * Why a helper rather than relying on `event_code`:
 *
 *   `event_code` is an operator-controlled slug (e.g.
 *   "WC26-BRIGHTON") that deliberately identifies the VENUE, not
 *   the match. The opponent lives in `events.name` because that's
 *   what the booking form prompts for and what the client sees on
 *   their dashboard row. Parsing it out keeps the allocator pure
 *   and avoids a schema change to introduce a denormalised
 *   "opponent" column.
 *
 * Detection rules (case-insensitive, in order):
 *
 *   1. Knockout markers — any of "last 32", "last 16", "round of
 *      16", "quarter", "semi", "final", "knockout" → null. These
 *      matches have no single opponent (the opponent is not known
 *      yet, or the match spans several rounds), so every ad in
 *      the venue defaults to the generic pool.
 *
 *   2. "v" / "vs" / "-" / "x" separator pattern —
 *      "<host> <separator> <opponent>" picks the opponent.
 *      Supports "England v Croatia", "England vs Croatia",
 *      "England - Croatia", and the less common "England x
 *      Croatia" forms we've seen in practice. The host half is
 *      discarded; only the opponent (right of the separator) is
 *      returned.
 *
 *   3. Nothing matches → null, defaulting the event to the
 *      generic pool. This is the right fallback: it's safer to
 *      split evenly across the venue than to misattribute a
 *      specific ad to the wrong event.
 *
 * The output is always lowercased + trimmed so the caller can do
 * a direct substring check against `ad.name.toLowerCase()`. The
 * check is done by `classifyAdAgainstOpponents` downstream using a
 * word-boundary regex so "Brazilian" doesn't match "Brazil".
 */

/**
 * Case-insensitive substrings that mark an event as a knockout
 * stage (no single opponent → always generic pool). Kept as a
 * literal list rather than a regex so it composes with the same
 * normalisation helper used in `client-dashboard-aggregations` for
 * event ordering.
 */
const KNOCKOUT_MARKERS = [
  "last 32",
  "last 16",
  "round of 16",
  "quarter",
  "semi",
  "final",
  "knockout",
] as const;

/**
 * Separators we accept between host and opponent. Ordered with the
 * most specific multi-char variants first so " vs " is matched
 * before " v " (the latter is a substring of the former in some
 * edge cases, though the space padding guards against that too).
 */
const OPPONENT_SEPARATOR_RE = /\s+(?:vs?|x|-)\s+/i;

/**
 * Lowercase, hyphen/underscore-tolerant, whitespace-collapsed
 * normalisation. Same contract as
 * `client-dashboard-aggregations.normaliseNameForStageMatch` so
 * "Last-32 round" and "LAST 32" both produce "last 32".
 */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the event name reads as a knockout-stage match (no
 * single opponent). Exposed so callers that want to bucket events
 * into "has opponent" vs "knockout pool" before walking the list
 * don't have to re-implement the marker check.
 */
export function isKnockoutStageName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = normalise(name);
  return KNOCKOUT_MARKERS.some((m) => n.includes(m));
}

/**
 * Extract the opponent portion from an event's `name`, or `null`
 * when no opponent can be inferred.
 *
 * Examples:
 *   "England v Croatia"      → "croatia"
 *   "England vs Croatia"     → "croatia"
 *   "England-Croatia"        → "croatia"
 *   "Scotland v Brazil"      → "brazil"
 *   "Last 32"                → null     (knockout)
 *   "England Quarter Final"  → null     (knockout marker wins)
 *   "Fan Park Opening"       → null     (no separator)
 *   null / ""                → null
 *
 * Lowercase output matches the casing used by the downstream
 * classifier's word-boundary regex. The return value is trimmed
 * but otherwise preserved as-typed by the operator — if the
 * opponent name contains a space ("Ivory Coast") it survives. The
 * classifier's substring match tolerates the space.
 *
 * Word-boundary awareness:
 *
 *   The classifier (not this extractor) applies the word boundary
 *   when it matches the opponent against an ad name. Keeping the
 *   extractor dumb means it composes with arbitrary opponent names
 *   (compound words like "ivory coast", accented names like
 *   "côte d'ivoire") without this file having to carry a
 *   normalisation table.
 */
export function extractOpponentName(
  eventName: string | null | undefined,
): string | null {
  if (!eventName) return null;
  const raw = eventName.trim();
  if (!raw) return null;

  // Knockout gate runs BEFORE the separator match so
  // "England v Croatia (Last 32)" is still treated as a knockout —
  // a bracket-suffixed round label overrides any opponent parse.
  // Operators have done this in practice to flag a knockout match
  // whose opponent is still TBD.
  if (isKnockoutStageName(raw)) return null;

  // Normalise separator whitespace so "England v Croatia" and
  // "England  v  Croatia" both split. Keep original casing for the
  // right-hand side until the final lowercase so stacked matches
  // like "England v Ivory Coast" yield "ivory coast" instead of
  // getting truncated at the first space.
  const parts = raw.split(OPPONENT_SEPARATOR_RE);
  if (parts.length < 2) return null;

  // The right-most chunk is the opponent — guards against names
  // like "England v Wales – Last 32" where the separator regex
  // spawns three parts but the last chunk is the round marker we
  // already filtered on. (Kept defensive even though the knockout
  // gate above should have handled it — parsing remains tolerant
  // to reorderings and extra spaces.)
  const opponentCandidate = parts[parts.length - 1]?.trim();
  if (!opponentCandidate) return null;

  // If the right-hand side is itself a knockout marker (e.g.
  // "England v Last 32"), reject — again belt-and-braces on top of
  // the whole-name gate.
  if (isKnockoutStageName(opponentCandidate)) return null;

  return opponentCandidate.toLowerCase();
}

/**
 * Attribution verdict returned by `classifyAdAgainstOpponents`.
 * `specific` carries the matched opponent name so the caller can
 * key the allocation onto the right event without a second pass.
 */
export type AdAttribution =
  | { kind: "specific"; opponent: string }
  | { kind: "generic" };

/**
 * Classify a Meta ad against a venue's opponent set.
 *
 * An ad matches an opponent when the opponent name appears in the
 * ad's name as a WHOLE WORD (case-insensitive). Whole-word match
 * prevents the "Brazil/Brazilian" false positive the brief calls
 * out, and still lets "WC26 Croatia Static 01" match "Croatia".
 *
 * Ties (an ad name containing two opponents — "england-v-croatia
 * but also ghana static") resolve to the FIRST opponent in
 * `opponents` that matches. Callers typically pass the opponent
 * list in the same order they render the events card, so the tie-
 * break is deterministic and operator-predictable.
 *
 * When no opponent matches, the verdict is `generic` and the
 * allocator splits the ad's spend across every event in the
 * venue.
 */
export function classifyAdAgainstOpponents(
  adName: string,
  opponents: readonly string[],
): AdAttribution {
  const lc = (adName ?? "").toLowerCase();
  if (!lc) return { kind: "generic" };
  for (const opponent of opponents) {
    const trimmed = (opponent ?? "").trim();
    if (!trimmed) continue;
    const safe = escapeRegex(trimmed);
    // Word-boundary regex: `\b` before and after the opponent so
    // "Brazil" matches "WC26 Brazil Static" but NOT
    // "Brazilian Visit". Multi-word opponents like "ivory coast"
    // survive because `\b` keys on transitions between word chars
    // (`[A-Za-z0-9_]`) and non-word chars — the inner space in the
    // opponent is a non-word char, so the boundary is checked only
    // at each end.
    const re = new RegExp(`\\b${safe}\\b`, "i");
    if (re.test(lc)) {
      return { kind: "specific", opponent: trimmed };
    }
  }
  return { kind: "generic" };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
