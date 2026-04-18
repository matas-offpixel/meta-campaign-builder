"use client";

/**
 * Connect Facebook OAuth for an already signed-in user.
 *
 * Uses `supabase.auth.linkIdentity()` — the correct Supabase API when the
 * user already has a session (email / magic-link sign-in).
 *
 * Why linkIdentity, not signInWithOAuth:
 *   - `signInWithOAuth` starts a brand-new sign-in flow.  For an
 *     already-authenticated user this creates a session conflict: two
 *     competing PKCE verifiers.  GoTrue's deferred Facebook token exchange
 *     then fails with "Unable to exchange external code".
 *   - `linkIdentity` hits `/user/identities/authorize` with the user's JWT.
 *     GoTrue builds the Facebook OAuth URL server-side and returns it directly
 *     (when `skipBrowserRedirect: true`).  This means `data.url` IS the
 *     actual Facebook dialog URL — we can read `redirect_uri` from it to
 *     confirm it points at the Supabase GoTrue callback, not our app.
 *   - Scopes are forwarded by GoTrue; no client-side URL manipulation needed.
 *
 * PKCE flow (browser → GoTrue → Facebook → GoTrue → app):
 *   1. SDK generates code_verifier, stores it in cookie (via @supabase/ssr
 *      CookieStorage), encodes code_challenge in the authorize URL.
 *   2. GoTrue constructs the Facebook dialog URL with
 *      redirect_uri = <Supabase GoTrue callback> and state = <flow state>.
 *   3. Facebook redirects to the Supabase GoTrue callback with the auth code.
 *   4. GoTrue stores the Facebook auth code in the flow state, generates a
 *      short-lived PKCE code, and redirects to our `redirectTo` URL.
 *   5. Our `/auth/facebook-callback` route calls exchangeCodeForSession with
 *      the PKCE code + verifier from the cookie.
 *   6. GoTrue exchanges the stored Facebook code and returns tokens.
 */

import { createClient } from "@/lib/supabase/client";

/**
 * The exact scopes we want Facebook to grant.  Single source of truth.
 *
 *   pages_show_list       — list Pages the user manages
 *   pages_read_engagement — read Page metadata; required to mint a Page
 *                           access token, which unlocks /{ig-user-id}/media
 *   ads_management        — create campaigns / ad sets / ads / creatives
 *   ads_read              — read ad account data (balances, delivery)
 *   instagram_basic       — read the linked IG account profile + media
 *   business_management   — required for BM-owned Pages / IG accounts
 *
 * Intentionally excluded:
 *   instagram_manage_insights — Facebook Login rejects it with
 *     "Invalid Scopes" unless explicitly approved. Not needed for posts.
 */
export const FB_SCOPES =
  "pages_show_list pages_read_engagement ads_management ads_read " +
  "instagram_basic business_management";

export type FacebookConnectOptions = {
  returnPath?: string;
  onScopeDebug?: (info: ScopeDebugInfo) => void;
};

export type ScopeDebugInfo = {
  /** `scope` param GoTrue put in the Facebook dialog URL */
  goTrueScope: string;
  /** Parsed tokens from goTrueScope */
  goTrueTokens: string[];
  /** Tokens from FB_SCOPES we requested */
  finalTokens: string[];
  /** FB_SCOPES string we requested */
  finalScope: string;
  /** The Facebook dialog URL the browser navigates to */
  finalUrl: string;
};

export async function connectFacebookAccount(
  options: FacebookConnectOptions = {},
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("connectFacebookAccount must run in the browser");
  }

  const supabase = createClient();

  const origin = window.location.origin;
  const baseCallback = `${origin}/auth/facebook-callback`;
  const next = options.returnPath ?? "/";
  const redirectTo = `${baseCallback}?next=${encodeURIComponent(next)}`;

  console.info("[connectFacebookAccount] ── START ────────────────────────────");
  console.info("[connectFacebookAccount] API: linkIdentity (for already-authenticated user)");
  console.info("[connectFacebookAccount] FB_SCOPES (requested):", FB_SCOPES);
  console.info("[connectFacebookAccount] redirectTo:", redirectTo);

  // linkIdentity requires an active session.  If the session has fully
  // expired (no refresh token) this will throw — in that case the user
  // should be logged out by middleware before reaching this point.
  const { data, error } = await supabase.auth.linkIdentity({
    provider: "facebook",
    options: {
      redirectTo,
      scopes: FB_SCOPES,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    console.error(
      "[connectFacebookAccount] linkIdentity error:",
      error.message,
      "status:", error.status,
      "code:", (error as unknown as Record<string, unknown>).code ?? "(none)",
    );
    throw error;
  }

  if (!data.url) {
    throw new Error(
      "Facebook OAuth did not return a redirect URL from linkIdentity. " +
        "Ensure the user has an active session before calling connectFacebookAccount.",
    );
  }

  // ── Audit: parse the actual Facebook dialog URL ───────────────────────────
  //
  // Unlike signInWithOAuth (which returns a GoTrue /authorize URL), linkIdentity
  // returns the Facebook dialog URL directly.  We can read redirect_uri from it
  // and confirm it points at Supabase GoTrue, not at our app.
  //
  const authUrl = new URL(data.url);

  const fbRedirectUri  = authUrl.searchParams.get("redirect_uri");
  const fbScope        = authUrl.searchParams.get("scope");
  const fbState        = authUrl.searchParams.get("state");
  const fbCodeChallenge = authUrl.searchParams.get("code_challenge");
  const fbResponseType = authUrl.searchParams.get("response_type");

  console.info("[connectFacebookAccount] — Facebook dialog URL analysis —");
  console.info("  url host:", authUrl.host);
  console.info("  url (first 500 chars):", data.url.slice(0, 500));
  console.info("  redirect_uri:", fbRedirectUri ?? "(not in URL — unusual)");
  console.info("  scope:", fbScope ?? "(not in URL)");
  console.info("  response_type:", fbResponseType ?? "(not in URL)");
  console.info("  state present:", !!fbState);
  console.info("  code_challenge present:", !!fbCodeChallenge);

  // ── redirect_uri consistency check ────────────────────────────────────────
  if (fbRedirectUri) {
    const isSupabase = fbRedirectUri.includes("supabase.co");
    const isAppOrigin = fbRedirectUri.startsWith(origin);
    if (isSupabase) {
      console.info(
        "[connectFacebookAccount] ✓ redirect_uri points to Supabase GoTrue" +
          " — Facebook will send code to GoTrue (correct for server-side PKCE).",
      );
    } else if (isAppOrigin) {
      console.error(
        "[connectFacebookAccount] ✗ redirect_uri points to APP origin" +
          " — Facebook will send the auth code directly to our app," +
          " bypassing GoTrue. exchangeCodeForSession will fail because" +
          " our app does not have a Supabase PKCE code, only a raw Facebook code." +
          " Fix: ensure the Supabase project's Facebook OAuth config uses" +
          " https://<project>.supabase.co/auth/v1/callback as the redirect URI.",
      );
    } else {
      console.warn(
        "[connectFacebookAccount] ⚠ redirect_uri is unexpected:",
        fbRedirectUri,
      );
    }
  } else {
    console.warn(
      "[connectFacebookAccount] ⚠ redirect_uri not found in Facebook URL." +
        " Full URL:", data.url,
    );
  }

  // ── Scope coverage check ──────────────────────────────────────────────────
  if (fbScope) {
    const grantedTokens = fbScope.split(/[\s,+]+/).filter(Boolean);
    const requestedTokens = FB_SCOPES.split(" ");
    const missing = requestedTokens.filter((s) => !grantedTokens.includes(s));
    if (missing.length > 0) {
      console.warn(
        "[connectFacebookAccount] ⚠ GoTrue did not include all requested scopes in the Facebook URL." +
          " Missing:", missing.join(", "),
        "(GoTrue may have a per-project scope override in the Supabase dashboard.)",
      );
    } else {
      console.info(
        "[connectFacebookAccount] ✓ All requested scopes present in Facebook URL.",
      );
    }

    options.onScopeDebug?.({
      goTrueScope: fbScope,
      goTrueTokens: grantedTokens,
      finalTokens: requestedTokens,
      finalScope: FB_SCOPES,
      finalUrl: data.url,
    });
  } else {
    options.onScopeDebug?.({
      goTrueScope: "",
      goTrueTokens: [],
      finalTokens: FB_SCOPES.split(" "),
      finalScope: FB_SCOPES,
      finalUrl: data.url,
    });
  }

  console.info("[connectFacebookAccount] ── REDIRECT ────────────────────────");
  window.location.assign(data.url);
}
