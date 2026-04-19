/**
 * Browser localStorage helpers for Facebook provider_token.
 * Stores `{ userId, token }` so tokens never apply to the wrong Supabase user.
 *
 * `expiresAt` is the canonical server-side field — it lives on
 * `user_facebook_tokens.expires_at`. Mirroring it here is forward-compat: the
 * dashboard widget reads expiry from the DB, so client code may continue to
 * leave this field undefined.
 */

export const FB_TOKEN_STORAGE_KEY = "facebook_provider_token";

export type StoredFacebookToken = {
  userId: string;
  token: string;
  /** Optional ISO timestamp mirroring `user_facebook_tokens.expires_at`. */
  expiresAt?: string | null;
};

export function parseStoredFacebookToken(raw: string | null): StoredFacebookToken | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredFacebookToken;
    if (parsed && typeof parsed.userId === "string" && typeof parsed.token === "string") {
      return parsed;
    }
  } catch {
    // Legacy plain string (pre–user-scoped) — ignore; useFacebookToken refetches from API
  }
  return null;
}

export function serializeStoredFacebookToken(entry: StoredFacebookToken): string {
  return JSON.stringify(entry);
}

export function clearFacebookTokenStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(FB_TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Returns true when an error string is a Facebook/Meta token-expiry or
 * invalid-token response — i.e. the problem is a stale credential, not a
 * missing permission, a rate limit, or any other Meta API error.
 *
 * Patterns detected:
 *   "Session has expired on…"        — OAuthException code 190
 *   "Error validating access token"  — generic invalid token
 *   "Invalid OAuth access token"     — malformed token
 *   "(#190)"                         — Meta error-code prefix
 */
export function isFacebookTokenExpiredError(error: string | null | undefined): boolean {
  if (!error) return false;
  const msg = error.toLowerCase();
  return (
    msg.includes("session has expired") ||
    msg.includes("error validating access token") ||
    msg.includes("invalid oauth access token") ||
    /\(#190\)/.test(error)
  );
}
