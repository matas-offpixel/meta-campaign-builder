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
  /** ISO string from DB row; null if not stored or env fallback was used. */
  updatedAt: string | null;
  /** ISO string from DB row; null if not yet stored (pre-migration rows). */
  expiresAt: string | null;
}

// ── Token validation via Meta /debug_token ────────────────────────────────────

export interface TokenValidation {
  valid: boolean;
  appId?: string;
  userId?: string;
  /** Unix epoch seconds — convert with `new Date(expiresAt * 1000)` */
  expiresAt?: number;
  scopes?: string[];
  error?: string;
}

/**
 * Calls Meta's /debug_token endpoint to inspect whether a token is valid,
 * its expiry, and granted scopes.
 *
 * Requires FACEBOOK_APP_ID and FACEBOOK_APP_SECRET to construct the app
 * access token used as the inspector credential.  Returns `valid: false`
 * with an `error` field if the call cannot be made or fails.
 *
 * This call is non-blocking for launch — call it in a try/catch and log the
 * result; do not gate launch on it.
 */
export async function validateMetaToken(token: string): Promise<TokenValidation> {
  const appId     = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    return {
      valid: false,
      error: "FACEBOOK_APP_ID or FACEBOOK_APP_SECRET not configured — cannot call /debug_token",
    };
  }

  // App access token format: {app_id}|{app_secret}
  const appToken = `${appId}|${appSecret}`;

  const url = new URL("https://graph.facebook.com/debug_token");
  url.searchParams.set("input_token", token);
  url.searchParams.set("access_token", appToken);

  try {
    const res  = await fetch(url.toString(), { cache: "no-store" });
    const json = (await res.json()) as {
      data?: {
        is_valid?: boolean;
        app_id?: string;
        user_id?: string;
        /** Unix epoch seconds */
        expires_at?: number;
        scopes?: string[];
        error?: { message?: string; code?: number };
      };
      error?: { message?: string; code?: number };
    };

    if (!res.ok || json.error) {
      return { valid: false, error: json.error?.message ?? `HTTP ${res.status}` };
    }

    const d = json.data ?? {};
    if (d.error) {
      return { valid: false, error: d.error.message ?? "Meta returned data.error" };
    }

    return {
      valid:     d.is_valid   ?? false,
      appId:     d.app_id,
      userId:    d.user_id,
      expiresAt: d.expires_at,
      scopes:    d.scopes,
    };
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}

// ── Token resolver ─────────────────────────────────────────────────────────────

/**
 * Resolves the freshest Meta access token available for `userId`.
 *
 * Now selects `updated_at` and `expires_at` from the DB row so callers can
 * log exactly how old and how fresh the stored token is.
 *
 * Logs a diagnostic line for each resolution step:
 *   [resolveToken] source=db  len=240 prefix=EAABwzL… updated_at=… expires_at=… expired=false
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
      .select("provider_token, updated_at, expires_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data?.provider_token) {
      const tok        = data.provider_token as string;
      const updatedAt  = (data as { updated_at?: string | null }).updated_at ?? null;
      const expiresAt  = (data as { expires_at?: string | null }).expires_at ?? null;

      // Detect expiry from stored value (best-effort; run validateMetaToken for authoritative check)
      const nowMs      = Date.now();
      const expMs      = expiresAt ? new Date(expiresAt).getTime() : null;
      const isExpired  = expMs !== null && expMs < nowMs;
      const expiresInH = expMs !== null ? ((expMs - nowMs) / 3_600_000).toFixed(1) : "unknown";

      console.info(
        `[resolveToken] source=db` +
        ` len=${tok.length}` +
        ` prefix=${tok.slice(0, 12)}…` +
        ` updated_at=${updatedAt ?? "unknown"}` +
        ` expires_at=${expiresAt ?? "unknown"}` +
        ` expires_in_h=${expiresInH}` +
        ` expired=${isExpired}`,
      );

      if (isExpired) {
        console.error(
          "[resolveToken] ⚠️  DB token has ALREADY EXPIRED!" +
          ` expires_at=${expiresAt} — user must reconnect Facebook.`,
        );
      }

      return { token: tok, source: "db", updatedAt, expiresAt };
    }

    if (error) {
      console.warn(
        "[resolveToken] DB read error — falling back to env.",
        error.message,
        `code=${error.code ?? "n/a"}`,
      );
    } else {
      console.info(
        "[resolveToken] DB: no token row for user", userId, "— falling back to env.",
      );
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
    return { token: envToken, source: "env", updatedAt: null, expiresAt: null };
  }

  // ── 3. Nothing available ─────────────────────────────────────────────────
  throw new Error(
    "No Meta access token available. Connect your Facebook account in Account Setup.",
  );
}
