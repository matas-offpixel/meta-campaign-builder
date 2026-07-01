import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  resolveLandingPageContext,
  type LandingPagesDb,
} from "@/lib/landing-pages/context";
import type { LandingPageContext } from "@/lib/landing-pages/types";

/**
 * lib/db/landing-pages.ts
 *
 * Production entrypoint for the PUBLIC landing-page lookup
 * (app/l/[clientSlug]/[eventSlug]). Uses the SERVICE-ROLE client — there is
 * no fan session on /l, so RLS cannot be the authorisation source; instead
 * authorisation is the slug-resolution chain enforced in
 * lib/landing-pages/context.ts (which is pure/DI so node:test can exercise
 * the real chain, including the multi-tenant isolation test, without a
 * Supabase connection).
 */

/**
 * Resolve the joined tuple for a public landing-page URL, or null (→ 404).
 *
 * @param db test seam — production callers omit it and get the
 *           service-role client.
 */
export async function getLandingPageContext(
  clientSlug: string,
  eventSlug: string,
  db?: LandingPagesDb,
): Promise<LandingPageContext | null> {
  const client = db ?? (createServiceRoleClient() as unknown as LandingPagesDb);
  return resolveLandingPageContext(client, clientSlug, eventSlug);
}
