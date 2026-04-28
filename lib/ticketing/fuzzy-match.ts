/**
 * lib/ticketing/fuzzy-match.ts
 *
 * Extracted from the PR #122 xlsx ticketing-import parser. Same
 * normalization + token-set Jaccard similarity originally inlined at
 * `app/api/clients/[id]/ticketing-import/parse/route.ts`, now shared
 * so PR 5's Eventbrite link-discovery tool can reuse the exact
 * scoring behaviour the operator is already calibrated on.
 *
 * Keep the implementation pure (no Supabase, no fetch) so it stays
 * test-friendly and can run in Edge runtimes.
 */

/**
 * Lowercase + strip non-alphanumerics to spaces + trim. Used as the
 * shared pre-processing step for both `similarityScore` and the
 * higher-level match heuristics (exact / substring fallbacks).
 */
export function normalizeEventLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Token-set Jaccard similarity in the range [0, 1]:
 *
 *   |A ∩ B| / |A ∪ B|
 *
 * 1.0 when the two strings normalize to the same bag of tokens (order
 * and punctuation irrelevant); 0 when no tokens overlap. Short tokens
 * count equally with long tokens — good enough for the event-name
 * domain where operators think in keywords ("England v Croatia") and
 * we don't want "the" vs "a" tipping the score.
 */
export function similarityScore(a: string, b: string): number {
  const ta = new Set(
    normalizeEventLabel(a).split(" ").filter(Boolean),
  );
  const tb = new Set(
    normalizeEventLabel(b).split(" ").filter(Boolean),
  );
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Combined exact/contains/Jaccard heuristic used for the initial
 * xlsx event matching. Kept here (rather than duplicated at each
 * call site) so downstream tooling can adopt the same scoring
 * semantics without re-tuning thresholds.
 *
 * Scoring ladder:
 *   - exact (normalised) match → 1.0
 *   - either string contains the other → 0.8
 *   - otherwise → raw `similarityScore` in [0, 1]
 */
export function labelMatchScore(a: string, b: string): number {
  const normA = normalizeEventLabel(a);
  const normB = normalizeEventLabel(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;
  if (normA.includes(normB) || normB.includes(normA)) return 0.8;
  return similarityScore(a, b);
}
