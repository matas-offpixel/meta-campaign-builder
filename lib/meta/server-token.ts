/**
 * lib/meta/server-token.ts
 *
 * Server-only helper that resolves the best available Facebook / Meta access
 * token for the current authenticated user.
 *
 * Priority order
 *   1. User's personal OAuth token from `user_facebook_tokens` (Supabase DB)
 *   2. META_ACCESS_TOKEN env-var fallback
 *
 * Import ONLY from Route Handlers or Server Components — never from client
 * components.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type TokenSource = "db" | "env";

export interface ResolvedToken {
  token: string;
  source: TokenSource;
}

/**
 * Resolves the freshest Meta access token available for `userId`.
 *
 * Logs a diagnostic line for each resolution step so server logs show exactly
 * which source was used for every API call:
 *   [resolveToken] source=db  len=240 prefix=EAABwzL…
 *   [resolveToken] source=env len=185 prefix=EAABwzL…
 *
 * @throws if neither source has a token — surfaces a user-friendly message.
 */
export async function resolveServerMetaToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<ResolvedToken> {
  // ── 1. User's OAuth token from DB ────────────────────────────────────────
  try {
    const { data, error } = await supabase
      .from("user_facebook_tokens")
      .select("provider_token")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data?.provider_token) {
      const tok = data.provider_token as string;
      console.info(
        `[resolveToken] source=db len=${tok.length} prefix=${tok.slice(0, 8)}… expired=false (freshness unknown — use Meta /debug_token to verify)`,
      );
      return { token: tok, source: "db" };
    }

    if (error) {
      console.warn(
        "[resolveToken] DB read error — falling back to env.",
        error.message,
        `code=${error.code ?? "n/a"}`,
      );
    } else {
      console.info("[resolveToken] DB: no token row for user", userId, "— falling back to env.");
    }
  } catch (err) {
    console.warn("[resolveToken] DB exception — falling back to env:", err);
  }

  // ── 2. Env-var fallback ──────────────────────────────────────────────────
  const envToken = process.env.META_ACCESS_TOKEN;
  if (envToken) {
    console.info(
      `[resolveToken] source=env len=${envToken.length} prefix=${envToken.slice(0, 8)}…`,
    );
    return { token: envToken, source: "env" };
  }

  // ── 3. Nothing available ─────────────────────────────────────────────────
  throw new Error(
    "No Meta access token available. Connect your Facebook account in Account Setup.",
  );
}
