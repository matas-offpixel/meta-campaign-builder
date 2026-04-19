/**
 * lib/db/facebook-tokens.ts
 *
 * Server-only DB helper for `user_facebook_tokens`.
 *
 * Single write path used by the OAuth callback so the storage shape
 * (`user_id`, `provider_token`, `expires_at`, `updated_at`) is documented in
 * one place and Mode A (direct OAuth) + Mode B (Supabase PKCE fallback) can
 * never drift apart.
 *
 * Read access goes through `resolveServerMetaToken` in `lib/meta/server-token.ts`
 * — keep the read path there to avoid splitting the resolver across two files.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface StoreFacebookTokenArgs {
  userId: string;
  /** Long-lived (~60 day) access token returned by `fb_exchange_token`. */
  token: string;
  /**
   * ISO timestamp of the token's expiry. May be null when an extension wasn't
   * possible (legacy Mode B path before the unified extension landed) — new
   * writes always populate it.
   */
  expiresAt: string | null;
}

export interface StoreFacebookTokenResult {
  ok: boolean;
  error?: string;
  /** Postgres error code when the upsert fails — useful for "table missing" hints. */
  errorCode?: string | null;
}

export async function storeFacebookToken(
  supabase: SupabaseClient,
  { userId, token, expiresAt }: StoreFacebookTokenArgs,
): Promise<StoreFacebookTokenResult> {
  const { error } = await supabase
    .from("user_facebook_tokens")
    .upsert(
      {
        user_id: userId,
        provider_token: token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) {
    return { ok: false, error: error.message, errorCode: error.code };
  }
  return { ok: true };
}
