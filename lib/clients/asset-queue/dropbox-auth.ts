/**
 * dropbox-auth.ts
 *
 * Obtains a short-lived Dropbox access token by exchanging the long-lived
 * refresh token via the OAuth2 token endpoint. Access tokens are cached in
 * module scope (in-memory) with a 5-minute safety margin on the TTL.
 *
 * Required env vars (all set in Vercel; never in .env.local):
 *   DROPBOX_REFRESH_TOKEN  — long-lived, never expires unless revoked
 *   DROPBOX_APP_KEY        — public client_id for the Off Pixel DB app
 *   DROPBOX_APP_SECRET     — client_secret (treat as a secret — never log)
 *
 * DROPBOX_ACCESS_TOKEN has been removed. Do not read it anywhere.
 *
 * In-memory cache is intentional: Vercel function instances are ephemeral and
 * short-lived. Cross-invocation caching (Supabase, filesystem, KV) would add
 * complexity with no material benefit — the token call is cheap (~100ms).
 */

import { DropboxFetchError } from "./dropbox.ts";

// ─── In-memory token cache ────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string;
  /** Expiry as ms since Unix epoch, already reduced by the 5-min safety margin */
  expiresAt: number;
}

let _cache: CachedToken | null = null;

const SAFETY_MARGIN_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_ENDPOINT   = "https://api.dropbox.com/oauth2/token";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a fresh (or cached) Dropbox access token.
 *
 * Exchanges DROPBOX_REFRESH_TOKEN for an access token on first call (or after
 * TTL expiry). Subsequent calls within the TTL window return the cached token
 * without hitting the network.
 *
 * @throws {DropboxFetchError("config_missing")} when any env var is absent
 * @throws {DropboxFetchError("forbidden")}       when the refresh token / secret is rejected (400/401)
 * @throws {DropboxFetchError("network")}          on network error or unexpected non-200 response
 */
export async function getDropboxAccessToken(): Promise<string> {
  // Return cached token if still valid
  if (_cache && Date.now() < _cache.expiresAt) {
    return _cache.accessToken;
  }

  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const appKey       = process.env.DROPBOX_APP_KEY;
  const appSecret    = process.env.DROPBOX_APP_SECRET;

  if (!refreshToken || !appKey || !appSecret) {
    throw new DropboxFetchError(
      "config_missing",
      "Dropbox refresh token / app credentials not configured. " +
        "Set DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET in Vercel env.",
    );
  }

  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: refreshToken,
    client_id:     appKey,
    client_secret: appSecret,
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    throw new DropboxFetchError(
      "network",
      `Network error reaching Dropbox token endpoint: ${(err as Error).message}`,
    );
  }

  if (res.status === 400 || res.status === 401) {
    throw new DropboxFetchError(
      "forbidden",
      "Dropbox refresh token rejected — regenerate via OAuth offline flow and update " +
        "DROPBOX_REFRESH_TOKEN env var. App secret may also have been regenerated; " +
        "check DROPBOX_APP_SECRET matches the Off Pixel DB app console.",
    );
  }

  if (!res.ok) {
    let snippet = "";
    try { snippet = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    console.error("[dropbox-auth] token endpoint returned unexpected status", {
      status: res.status,
      body: snippet,
    });
    throw new DropboxFetchError(
      "network",
      `Dropbox token endpoint returned HTTP ${res.status}`,
    );
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };

  if (!data.access_token) {
    throw new DropboxFetchError("network", "Dropbox token endpoint returned no access_token");
  }

  const expiresInMs = (data.expires_in ?? 14400) * 1000;
  _cache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs - SAFETY_MARGIN_MS,
  };

  console.log("[dropbox-auth] access token fetched", {
    expiresAt: new Date(_cache.expiresAt).toISOString(),
  });

  return _cache.accessToken;
}

/**
 * Clears the in-memory token cache. Exposed for testing only.
 */
export function _clearTokenCache(): void {
  _cache = null;
}
