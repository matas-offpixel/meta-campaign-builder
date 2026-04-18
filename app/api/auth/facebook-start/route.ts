/**
 * GET /api/auth/facebook-start
 *
 * Initiates a direct Facebook OAuth 2.0 authorization-code flow that is
 * entirely owned by this application — no GoTrue involvement.
 *
 * WHY NOT GoTrue / linkIdentity?
 *   GoTrue's PKCE flow defers the Facebook code exchange: the FB auth code is
 *   stored in the flow state and only exchanged when the app later calls
 *   `exchangeCodeForSession`.  During that deferred exchange GoTrue calls
 *   Facebook's token endpoint with `redirect_uri = flowState.RedirectTo` (our
 *   app URL), but the authorization step used GoTrue's own callback URL
 *   (supabase.co/auth/v1/callback) — a guaranteed redirect_uri mismatch that
 *   produces "Unable to exchange external code: AQBL…".
 *
 * THIS FLOW (server-controlled):
 *   1. Server generates a random CSRF state and stores it in an httpOnly cookie.
 *   2. Server builds the Facebook dialog URL with
 *        redirect_uri = <origin>/auth/facebook-callback
 *      matching what Meta has registered under Valid OAuth Redirect URIs.
 *   3. Server redirects browser to Facebook.
 *   4. Facebook redirects to /auth/facebook-callback with code + state.
 *   5. /auth/facebook-callback verifies the CSRF state, exchanges the code
 *      with Facebook directly (same redirect_uri — no mismatch possible),
 *      stores the access_token, and navigates the user onward.
 *
 * Required env vars (server-only):
 *   FACEBOOK_APP_ID      — numeric Facebook app id
 *   FACEBOOK_APP_SECRET  — Facebook app secret (keep this server-only)
 */

import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";

// Single source of truth for the scopes we request.
// Must match what is approved in the Meta app and what
// /auth/facebook-callback and the rest of the app expect.
const FB_SCOPES =
  "pages_show_list,pages_read_engagement,ads_management,ads_read," +
  "instagram_basic,business_management";

const COOKIE_MAX_AGE = 10 * 60; // 10 minutes — enough for the round-trip

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { origin, searchParams } = new URL(request.url);

  // ── Guard: user must be authenticated ────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    console.warn("[fb-start] unauthenticated request — redirecting to /login");
    return NextResponse.redirect(new URL("/login", origin));
  }

  // ── Validate env ──────────────────────────────────────────────────────────
  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) {
    console.error("[fb-start] FACEBOOK_APP_ID env var is not set");
    return NextResponse.redirect(
      new URL(
        `/auth/facebook-error?reason=config_error&detail=${encodeURIComponent(
          "FACEBOOK_APP_ID is not configured on the server.",
        )}`,
        origin,
      ),
    );
  }

  // ── Build the canonical redirect_uri ─────────────────────────────────────
  // This exact URL must appear in Meta → App → Facebook Login → Valid OAuth
  // Redirect URIs.  It MUST NOT have a query string because we store `next`
  // separately in a cookie.
  const redirectUri = `${origin}/auth/facebook-callback`;
  const next = searchParams.get("next") ?? "/";

  // ── CSRF state ────────────────────────────────────────────────────────────
  const state = crypto.randomBytes(20).toString("hex");

  // ── Facebook dialog URL ───────────────────────────────────────────────────
  const fbUrl = new URL("https://www.facebook.com/dialog/oauth");
  fbUrl.searchParams.set("client_id", appId);
  fbUrl.searchParams.set("redirect_uri", redirectUri);
  fbUrl.searchParams.set("scope", FB_SCOPES);
  fbUrl.searchParams.set("response_type", "code");
  fbUrl.searchParams.set("state", state);

  console.info("[fb-start] ── initiating direct Facebook OAuth ────────────");
  console.info("[fb-start] user id:", user.id);
  console.info("[fb-start] redirect_uri:", redirectUri);
  console.info("[fb-start] scope:", FB_SCOPES);
  console.info("[fb-start] next:", next);
  console.info("[fb-start] CSRF state (first 8):", state.slice(0, 8) + "…");

  // ── Redirect to Facebook with CSRF cookies ────────────────────────────────
  const response = NextResponse.redirect(fbUrl.toString());

  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    secure: origin.startsWith("https"),
  };

  // Three cookies the callback needs:
  //   fb_oauth_state       — CSRF token to validate against ?state= param
  //   fb_oauth_next        — where to send the user after success
  //   fb_oauth_redirect_uri — the exact redirect_uri we must echo in the exchange
  response.cookies.set("fb_oauth_state", state, cookieOpts);
  response.cookies.set("fb_oauth_next", next, cookieOpts);
  response.cookies.set("fb_oauth_redirect_uri", redirectUri, cookieOpts);

  return response;
}
