"use client";

/**
 * Connect Facebook OAuth for an already signed-in user.
 *
 * Navigates to /api/auth/facebook-start, which is the app-owned OAuth flow:
 *
 *   1. /api/auth/facebook-start builds the Facebook dialog URL with
 *        redirect_uri = <origin>/auth/facebook-callback
 *      (the same URL registered in Meta → App → Facebook Login → Valid OAuth
 *      Redirect URIs) and stores a CSRF state token in an httpOnly cookie.
 *
 *   2. Facebook redirects to /auth/facebook-callback with ?code=… &state=…
 *
 *   3. /auth/facebook-callback verifies the CSRF cookie, calls Facebook's
 *      token endpoint directly (no GoTrue involvement) with the same
 *      redirect_uri → no redirect_uri mismatch → no "Unable to exchange
 *      external code" errors.
 *
 * Why not GoTrue / linkIdentity?
 *   GoTrue's PKCE flow defers the Facebook code exchange.  When GoTrue later
 *   calls Facebook's token endpoint it uses flowState.RedirectTo (our app URL)
 *   as redirect_uri, but the authorization step used GoTrue's own callback URL
 *   (supabase.co/auth/v1/callback) — a mismatch that Facebook rejects with
 *   "Unable to exchange external code".
 *
 * Required server-side env vars (set in .env.local + Vercel):
 *   FACEBOOK_APP_ID      — from Meta app dashboard → Settings → Basic
 *   FACEBOOK_APP_SECRET  — from Meta app dashboard → Settings → Basic
 *
 * Required Meta App configuration:
 *   Facebook Login → Valid OAuth Redirect URIs must include:
 *     https://<your-domain>/auth/facebook-callback
 *   (NOT the Supabase GoTrue callback — that is only needed if you also use
 *    Supabase's built-in Facebook OAuth.)
 */

/**
 * The exact scopes we request from Facebook.  Single source of truth.
 * This is mirrored server-side in /api/auth/facebook-start.
 *
 *   pages_show_list       — list Pages the user manages
 *   pages_read_engagement — read Page metadata; required to mint a Page
 *                           access token for /{page-id}/feed and
 *                           /{ig-user-id}/media endpoints
 *   ads_management        — create campaigns / ad sets / ads / creatives
 *   ads_read              — read ad account data (balances, delivery)
 *   instagram_basic       — read the linked IG account profile + media
 *   business_management   — required for BM-owned Pages / IG accounts
 *
 * Intentionally excluded:
 *   email / public_profile       — GoTrue injects these; our Facebook app
 *                                  does not support them → "Invalid Scopes"
 *   instagram_manage_insights    — advanced scope; requires explicit approval
 */
export const FB_SCOPES =
  "pages_show_list,pages_read_engagement,ads_management,ads_read," +
  "instagram_basic,business_management";

export type FacebookConnectOptions = {
  returnPath?: string;
  /** @deprecated — no longer used in the direct-OAuth flow */
  onScopeDebug?: (info: ScopeDebugInfo) => void;
};

/** @deprecated — kept for callers that still pass onScopeDebug */
export type ScopeDebugInfo = {
  goTrueScope: string;
  goTrueTokens: string[];
  finalTokens: string[];
  finalScope: string;
  finalUrl: string;
};

/**
 * Kick off the Facebook OAuth flow by navigating to the server-side
 * facebook-start route.  The server generates the CSRF state, builds the
 * Facebook dialog URL, and sets the required cookies before redirecting the
 * browser to Facebook.
 */
export function connectFacebookAccount(
  options: FacebookConnectOptions = {},
): void {
  if (typeof window === "undefined") {
    throw new Error("connectFacebookAccount must run in the browser");
  }

  const next = options.returnPath ?? window.location.pathname;
  const startUrl = `/api/auth/facebook-start?next=${encodeURIComponent(next)}`;

  console.info(
    "[connectFacebookAccount] navigating to facebook-start →", startUrl,
  );

  window.location.assign(startUrl);
}
