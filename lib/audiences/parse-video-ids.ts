/**
 * Parse and validate a freeform list of Meta video IDs.
 * No runtime dependencies — safe to import in tests and client components.
 */

/** Maximum video IDs per bulk batch — mirrors Meta's own "enter up to 50 video IDs" UI limit. */
export const MAX_VIDEO_IDS = 50;

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
