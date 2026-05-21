/**
 * Parse and validate a freeform list of Meta video IDs.
 * No runtime dependencies — safe to import in tests and client components.
 */

/**
 * Maximum video IDs accepted by the video-ID input textarea.
 *
 * Raised from 50 (Meta's own manual-UI cap) to 200 — our tool isn't bound by
 * Meta's UI restriction, and the write path now splits batches that exceed
 * Meta's 200-video API limit into ≤200-video sibling audiences automatically
 * (see audience-write.ts writeSplitVideoViews / MAX_VIDEO_VIEWS_VIDEOS).
 * This unblocks large-library events like P26-OPENAIR (206 videos) in
 * video-ID input mode, not just campaign-walk mode.
 */
export const MAX_VIDEO_IDS = 200;

/**
 * Parse a freeform string of Meta video IDs.
 * Separators: comma, semicolon, or any whitespace (newline, space, tab).
 * Deduplicates, strips whitespace, ignores empty tokens.
 *
 * Returns:
 *   `ids`             — unique IDs, capped at MAX_VIDEO_IDS.
 *   `totalBeforeCap`  — count before the cap was applied; used to surface
 *                       an over-limit warning to the user.
 */
export function parseVideoIds(input: string): {
  ids: string[];
  totalBeforeCap: number;
} {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const token of input.split(/[\s,;]+/)) {
    const trimmed = token.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    deduped.push(trimmed);
  }

  const totalBeforeCap = deduped.length;
  return { ids: deduped.slice(0, MAX_VIDEO_IDS), totalBeforeCap };
}
