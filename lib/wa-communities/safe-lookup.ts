/**
 * Fail-open alias lookup for the public /j/{segment} route.
 *
 * Alias resolution must never take down raw-invite passthrough. Table missing,
 * DB unreachable, timeout, service-role misconfig — anything — returns null so
 * resolveInviteSegment can still 302 chat.whatsapp.com/{invite} for live
 * Meta-approved templates.
 */

import { isValidSlug } from "./slug.ts";
import type { AliasLookupRow } from "./resolve.ts";

export async function lookupAliasFailOpen(
  segment: string,
  fetch: (slug: string) => Promise<AliasLookupRow | null>,
): Promise<{ alias: AliasLookupRow | null; lookupError: unknown | null }> {
  if (!isValidSlug(segment)) {
    return { alias: null, lookupError: null };
  }
  try {
    const alias = await fetch(segment);
    return { alias, lookupError: null };
  } catch (err) {
    return { alias: null, lookupError: err };
  }
}
