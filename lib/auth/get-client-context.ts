import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  assertClientSlugMatch,
  ClientScopeError,
  resolveClientMembership,
  type ClientMembership,
  type MembershipDb,
} from "./client-context";

/**
 * lib/auth/get-client-context.ts
 *
 * Server entrypoint for client-dashboard authorisation (OP909). Called at
 * the top of EVERY /admin/{clientSlug}/* server component and EVERY admin
 * server action, before touching any resource.
 *
 * The proxy already enforces session + membership + slug match for page
 * navigations, but this helper is the defence-in-depth layer: server
 * actions and RSC data fetches must never rely on the middleware alone.
 *
 * Uses the SESSION-bound Supabase client — the client_users self-read RLS
 * policy (migration 137) plus the client-member read policy on clients
 * make the membership join resolvable without service-role.
 */

/**
 * Resolve the caller's client membership and (when a slug is given)
 * assert it matches. Redirects to /admin/login when there is no session
 * or no membership; throws ClientScopeError (→ let it bubble to the
 * error boundary as a hard failure) on slug mismatch.
 */
export async function requireClientContext(
  expectedSlug?: string,
): Promise<ClientMembership> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const membership = await resolveClientMembership(
    supabase as unknown as MembershipDb,
    user.id,
  );
  if (!membership) {
    // Authed Supabase user with no client_users row (e.g. an operator
    // hitting a client URL, or a revoked client). Not a login problem —
    // but there is nothing to show them on the client surface.
    redirect("/admin/login?error=no-client");
  }

  if (expectedSlug !== undefined) {
    assertClientSlugMatch(membership, expectedSlug);
  }
  return membership;
}

export { ClientScopeError };
export type { ClientMembership };
