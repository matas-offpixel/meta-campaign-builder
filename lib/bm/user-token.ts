import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * lib/bm/user-token.ts
 *
 * Resolves the operator's PERSONAL Facebook OAuth token for the BM tool.
 *
 * Deliberately reads ONLY `user_facebook_tokens` — there is NO META_ACCESS_TOKEN
 * env fallback here. The BM Asset Sync tool acts exclusively as Matas (his user
 * OAuth token) so we do not compound the fragility of the shared server token
 * (task-#10 memory). If the personal token is missing the caller must surface a
 * "connect Facebook" prompt rather than silently falling back to the app token.
 */

export interface ResolvedUserToken {
  token: string;
  updatedAt: string | null;
  expiresAt: string | null;
}

export class MissingUserFacebookTokenError extends Error {
  constructor() {
    super(
      "No personal Facebook token found. Connect your Facebook account in Account Setup (business_management scope required).",
    );
    this.name = "MissingUserFacebookTokenError";
  }
}

/**
 * Reads the stored personal OAuth token for `userId`. Throws
 * {@link MissingUserFacebookTokenError} when absent — never returns the env token.
 */
export async function resolveUserFacebookToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any, any, any>,
  userId: string,
): Promise<ResolvedUserToken> {
  const { data, error } = await supabase
    .from("user_facebook_tokens")
    .select("provider_token, updated_at, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[bm user-token] DB read error", error.message);
    throw new MissingUserFacebookTokenError();
  }
  const token = (data?.provider_token as string | undefined)?.trim();
  if (!token) {
    throw new MissingUserFacebookTokenError();
  }
  return {
    token,
    updatedAt: (data as { updated_at?: string | null }).updated_at ?? null,
    expiresAt: (data as { expires_at?: string | null }).expires_at ?? null,
  };
}
