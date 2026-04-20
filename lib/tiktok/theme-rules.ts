/**
 * lib/tiktok/theme-rules.ts
 *
 * Coarse bucketing of TikTok search terms into music-adjacent themes.
 * Used by the search-term parser to group rows for dashboard display.
 * Stub — rule table is filled in by the next commit.
 */

/**
 * Bucket a search term into a coarse theme cluster (e.g. "techno",
 * "festival", "house"). Returns `null` when no rule fires — the UI
 * renders nulls under "Unbucketed".
 */
export function bucketSearchTerm(_term: string): string | null {
  return null;
}
