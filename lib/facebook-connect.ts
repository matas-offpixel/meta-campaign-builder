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

  // ── Audit + scope surgery ─────────────────────────────────────────────────
  //
  // Unlike signInWithOAuth (which returns a GoTrue /authorize URL), linkIdentity
  // returns the actual Facebook dialog URL. We CAN read and rewrite the `scope`
  // param here without touching `redirect_uri`, which GoTrue already set to the
  // correct Supabase GoTrue callback.
  //
  // WHY we need to rewrite scope:
  //   GoTrue's Facebook provider hardcodes `email` (and sometimes `public_profile`)
  //   as default scopes and appends them regardless of what we pass via the
  //   `scopes` option.  For Facebook apps that use "Facebook Login for Business"
  //   (or Marketing API-only apps), `email` is not a valid scope and Facebook
  //   rejects the authorization with "Invalid Scopes: email".  We strip any
  //   GoTrue-injected defaults and replace the scope with exactly FB_SCOPES.
  //   The PKCE `redirect_uri` and `state` params are left untouched — GoTrue
  //   owns those and the code exchange still flows through Supabase GoTrue.
  //
  const authUrl = new URL(data.url);

  // Log the raw URL before any modification
  const rawScope       = authUrl.searchParams.get("scope");
  const fbRedirectUri  = authUrl.searchParams.get("redirect_uri");
  const fbState        = authUrl.searchParams.get("state");
  const fbCodeChallenge = authUrl.searchParams.get("code_challenge");
  const fbResponseType = authUrl.searchParams.get("response_type");

  console.info("[connectFacebookAccount] — Facebook dialog URL (pre-rewrite) —");
  console.info("  url host:", authUrl.host);
  console.info("  url (first 500 chars):", data.url.slice(0, 500));
  console.info("  redirect_uri:", fbRedirectUri ?? "(not in URL)");
  console.info("  scope (GoTrue raw):", rawScope ?? "(not in URL)");
  console.info("  response_type:", fbResponseType ?? "(not in URL)");
  console.info("  state present:", !!fbState);
  console.info("  code_challenge present:", !!fbCodeChallenge);

  // ── redirect_uri consistency check ────────────────────────────────────────
  if (fbRedirectUri) {
    if (fbRedirectUri.includes("supabase.co")) {
      console.info(
        "[connectFacebookAccount] ✓ redirect_uri → Supabase GoTrue (correct).",
      );
    } else if (fbRedirectUri.startsWith(origin)) {
      console.error(
        "[connectFacebookAccount] ✗ redirect_uri → app origin. Facebook will" +
          " send the auth code directly to our app, bypassing GoTrue." +
          " Fix: set the Supabase project's Facebook Callback URL to" +
          " https://<project>.supabase.co/auth/v1/callback.",
      );
    } else {
      console.warn("[connectFacebookAccount] ⚠ redirect_uri unexpected:", fbRedirectUri);
    }
  }

  // ── Scope rewrite ─────────────────────────────────────────────────────────
  //
  // SCOPES_NOT_ALLOWED lists scopes that GoTrue injects but that our Facebook
  // app does not support (or that we do not want to request).
  //   - `email`         — GoTrue default; invalid for Marketing API / Business Login apps
  //   - `public_profile` — GoTrue default; not required for ads/pages access
  //
  const SCOPES_NOT_ALLOWED = new Set(["email", "public_profile"]);
  const desiredScopes = FB_SCOPES.split(" "); // authoritative list

  const rawScopeTokens = (rawScope ?? "").split(/[\s,+]+/).filter(Boolean);
  const goTrueInjected = rawScopeTokens.filter((s) => !desiredScopes.includes(s));
  const finalScopes    = desiredScopes.filter((s) => !SCOPES_NOT_ALLOWED.has(s));
  const finalScopeStr  = finalScopes.join(","); // Facebook accepts comma-separated

  if (goTrueInjected.length > 0) {
    console.warn(
      "[connectFacebookAccount] GoTrue injected extra scopes (stripping):",
      goTrueInjected.join(", "),
    );
  }

  // Replace scope with exactly our desired list (no extras)
  authUrl.searchParams.set("scope", finalScopeStr);

  const finalUrl = authUrl.toString();

  console.info("[connectFacebookAccount] — scope rewrite result —");
  console.info("  GoTrue raw scope:", rawScope ?? "(empty)");
  console.info("  GoTrue injected (stripped):", goTrueInjected.join(", ") || "(none)");
  console.info("  Final scope sent to Facebook:", finalScopeStr);
  console.info("  Final URL (first 500 chars):", finalUrl.slice(0, 500));

  const missingDesired = desiredScopes.filter((s) => !finalScopes.includes(s));
  if (missingDesired.length > 0) {
    console.warn(
      "[connectFacebookAccount] ⚠ Some desired scopes not in final scope" +
        " (check SCOPES_NOT_ALLOWED):", missingDesired.join(", "),
    );
  } else {
    console.info("[connectFacebookAccount] ✓ Final scope matches FB_SCOPES exactly.");
  }

  options.onScopeDebug?.({
    goTrueScope: rawScope ?? "",
    goTrueTokens: rawScopeTokens,
    finalTokens: finalScopes,
    finalScope: finalScopeStr,
    finalUrl,
  });

  console.info("[connectFacebookAccount] ── REDIRECT ────────────────────────");
  window.location.assign(finalUrl);
}
