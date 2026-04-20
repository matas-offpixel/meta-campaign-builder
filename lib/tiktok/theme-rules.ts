/**
 * lib/tiktok/theme-rules.ts
 *
 * Coarse bucketing of TikTok search terms into music-adjacent themes.
 * Used by the search-term parser to group rows for dashboard display.
 *
 * Rules are evaluated as case-insensitive regex on the trimmed search
 * term. Order matters — the first rule whose regex matches wins (so
 * place narrower / more-specific rules above broader ones, e.g. the
 * "drum & bass" alias bundle ahead of generic "rap" or "house"). The
 * table is exported so tests (and future tooling) can iterate it.
 *
 * A search term matching no rule returns `null` and renders under
 * "Unbucketed" in the UI.
 */

export interface ThemeRule {
  /** Bucket label assigned when the regex matches. */
  bucket: string;
  /** Case-insensitive regex evaluated against the search term. */
  pattern: RegExp;
}

export const THEME_RULES: readonly ThemeRule[] = [
  { bucket: "drum & bass", pattern: /\b(drum and bass|d&b|dnb)\b/i },
  { bucket: "techno", pattern: /\b(techno|melodic techno)\b/i },
  {
    bucket: "house",
    pattern: /\b(house|afro house|deep house|tech house)\b/i,
  },
  { bucket: "festival", pattern: /\b(festival|fest)\b/i },
  { bucket: "r&b / soul", pattern: /\b(rnb|r&b|soul)\b/i },
  { bucket: "rap / hip-hop", pattern: /\b(rap|hip[-\s]?hop)\b/i },
  { bucket: "garage", pattern: /\b(garage|uk garage)\b/i },
  { bucket: "nightlife", pattern: /\b(club|nightlife|party)\b/i },
] as const;

/**
 * Bucket a search term into a coarse theme cluster (e.g. "techno",
 * "festival", "house"). Returns `null` when no rule fires — the UI
 * renders nulls under "Unbucketed".
 */
export function bucketSearchTerm(term: string): string | null {
  if (!term) return null;
  const trimmed = term.trim();
  if (!trimmed) return null;
  for (const rule of THEME_RULES) {
    if (rule.pattern.test(trimmed)) return rule.bucket;
  }
  return null;
}
