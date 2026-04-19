import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Cookie-bound Supabase client for server components and authenticated route
 * handlers. Reads the user's session from cookies and respects RLS.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll is called from a Server Component where cookies
            // cannot be set — this is expected during initial page load.
          }
        },
      },
    },
  );
}

/**
 * Service-role Supabase client. BYPASSES RLS — never use from a context that
 * trusts user input as the authorisation source. Only safe inside server-side
 * route handlers / server components where the route itself enforces the
 * access rule (e.g. the public share route validates a one-shot token before
 * issuing any read).
 *
 * Reasons to reach for this client:
 *   - Public share route resolves a `report_shares.token` → event_id +
 *     user_id without an authenticated session.
 *   - Public share route reads the owner's `user_facebook_tokens` row to
 *     hit the Meta Graph API on their behalf.
 *
 * NOT for general dashboard reads — those must use {@link createClient} so
 * RLS continues to enforce per-user scoping.
 *
 * Reads `SUPABASE_SERVICE_ROLE_KEY` from the environment. Throws at call
 * time if missing so the failure surfaces in the route's try/catch rather
 * than crashing module load (the env var is only required for the public
 * share path; rest of the app must keep booting without it).
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured. Required by the public " +
        "share route (app/share/report/[token]) to bypass RLS.",
    );
  }

  return createSupabaseClient(url, serviceKey, {
    auth: {
      // Service role is stateless — never persist a session, never refresh
      // tokens, never auto-detect URL state. The only role of this client is
      // server-side admin reads/writes for the share route.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
