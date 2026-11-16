/**
 * Fail-open alias lookup for the public /j/{segment} route.
 *
 * Fail-open spans both invite-shaped and slug-shaped segments. Table
 * missing, DB unreachable, timeout, cache failure that escapes the lookup —
 * anything thrown — returns null so the route can still 302
 * chat.whatsapp.com/{segment} for an already-approved button. A broken
 * alias subsystem must never break a community link.
 *
 * Segments that match neither shape skip the lookup and stay a 404.
 */

import type { AliasLookupRow } from "./resolve.ts";
import { isWellFormedSegment } from "./slug.ts";

export async function lookupAliasFailOpen(
  segment: string,
  fetch: (slug: string) => Promise<AliasLookupRow | null>,
): Promise<{ alias: AliasLookupRow | null; lookupError: unknown | null }> {
  if (!isWellFormedSegment(segment)) {
    return { alias: null, lookupError: null };
  }
  try {
    const alias = await fetch(segment);
    return { alias, lookupError: null };
  } catch (err) {
    return { alias: null, lookupError: err };
  }
}
