/**
 * Collapses duplicated adjacent URL path segments, e.g.
 * `.../additional-spend/additional-spend` → `.../additional-spend`.
 *
 * Used client-side before fetch when a parent passes a path that already
 * ends with a resource segment and the child appends it again (same
 * failure mode as tier-channel `apiBase` double suffix, PR #283).
 */
export function dedupeAdjacentApiPathSegment(
  url: string,
  segment: string,
): string {
  const escaped = segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Next char may be another path segment, end, or query string (share routes).
  const re = new RegExp(`/${escaped}/${escaped}(?=/|$|\\?)`, "g");
  let prev: string;
  let out = url;
  do {
    prev = out;
    out = out.replace(re, `/${segment}`);
  } while (out !== prev);
  return out;
}
