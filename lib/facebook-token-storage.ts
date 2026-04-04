/**
 * Browser localStorage helpers for Facebook provider_token.
 * Stores `{ userId, token }` so tokens never apply to the wrong Supabase user.
 */

export const FB_TOKEN_STORAGE_KEY = "facebook_provider_token";

export type StoredFacebookToken = {
  userId: string;
  token: string;
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
