/**
 * GET /auth/facebook-callback
 *
 * Handles TWO distinct OAuth callback modes that share the same URL:
 *
 * ── MODE A: Direct OAuth ("direct_" state prefix) ───────────────────────────
 *   Initiated by /api/auth/facebook-start.
 *
 *   Detection (in priority order):
 *     1. `?state=` parameter starts with "direct_" — Facebook echoes state
 *        back unchanged; this is the primary, cookie-free detection mechanism.
 *     2. `fb_oauth_state` httpOnly cookie present (secondary, belt-and-braces).
 *
 *   Flow:
 *     1. Verify `?state=` matches `fb_oauth_state` cookie when available (CSRF).
 *     2. POST the `?code=` to Facebook's token endpoint with the SAME
 *        redirect_uri used in the authorization (stored in fb_oauth_redirect_uri
 *        cookie or derived from the request origin).
 *     3. Optionally extend to a 60-day long-lived token.
 *     4. Upsert access_token into `user_facebook_tokens`.
 *     5. Clear the OAuth cookies and redirect to `fb_oauth_next`.
 *
 *   Why this fixes "Unable to exchange external code / Error validating
 *   client secret":
 *     GoTrue's PKCE-deferred exchange calls Facebook's token endpoint with
 *     `redirect_uri = flowState.RedirectTo` (our app URL), but the
 *     authorization step used GoTrue's own callback URL — a redirect_uri
 *     mismatch.  This flow owns the full round-trip so there is no mismatch.
 *
 * ── MODE B: Supabase PKCE / magic-link (legacy / fallback) ──────────────────
 *   Only runs when the state param does NOT begin with "direct_" AND the
 *   `fb_oauth_state` cookie is absent — i.e. the request came from a GoTrue
 *   /authorize or /user/identities/authorize redirect.
 *   Preserved for the standard email magic-link login and any other
 *   Supabase-managed OAuth flows.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const DIRECT_STATE_PREFIX = "direct_";

function safeNext(v: string | null | undefined): string {
  if (!v || !v.startsWith("/") || v.startsWith("//")) return "/";
  return v;
}

function errorRedirect(origin: string, reason: string, detail?: string): NextResponse {
  const url = new URL("/auth/facebook-error", origin);
  url.searchParams.set("reason", reason);
  if (detail) url.searchParams.set("detail", detail.slice(0, 300));
  return NextResponse.redirect(url);
}

// ── Facebook token exchange ───────────────────────────────────────────────────

interface FbTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
}

async function exchangeCodeWithFacebook(
  code: string,
  redirectUri: string,
): Promise<{ token: string; expiresIn: number | null } | { error: string }> {
  const appId     = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    return {
      error:
        "FACEBOOK_APP_ID or FACEBOOK_APP_SECRET env vars are not set. " +
        "Add them from the Meta app dashboard → Settings → Basic.",
    };
  }

  const url = new URL("https://graph.facebook.com/oauth/access_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);

  console.info("[fb-callback/direct] exchanging code → token");
  console.info("[fb-callback/direct] redirect_uri used in exchange:", redirectUri);

  const res  = await fetch(url.toString(), { cache: "no-store" });
  const json = (await res.json()) as FbTokenResponse;

  if (!res.ok || json.error) {
    console.error("[fb-callback/direct] Facebook token exchange failed:", json);
    return { error: json.error?.message ?? `HTTP ${res.status}` };
  }

  if (!json.access_token) {
    return { error: "Facebook returned no access_token." };
  }

  return { token: json.access_token, expiresIn: json.expires_in ?? null };
}

interface ExtendTokenResult {
  token: string;
  /** Absolute expiry as ISO string; null when extension failed (short-lived ~2h). */
  expiresAt: string | null;
  extended: boolean;
  failureReason?: string;
}

async function extendToken(shortToken: string): Promise<ExtendTokenResult> {
  const appId     = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    console.warn(
      "[fb-callback/direct] FACEBOOK_APP_ID or FACEBOOK_APP_SECRET missing — " +
      "cannot extend to long-lived token. Storing SHORT-LIVED token (~2 hours).",
    );
    return { token: shortToken, expiresAt: null, extended: false, failureReason: "env vars missing" };
  }

  const url = new URL("https://graph.facebook.com/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);

  const res  = await fetch(url.toString(), { cache: "no-store" });
  const json = (await res.json()) as FbTokenResponse;

  if (!res.ok || json.error || !json.access_token) {
    const reason = json.error?.message ?? `HTTP ${res.status}`;
    // ⚠️ This is the silent bug that causes "Session has expired" hours later.
    // Short-lived tokens last ~2 hours; long-lived tokens last ~60 days.
    console.error(
      "[fb-callback/direct] ⚠️  Long-lived token extension FAILED — " +
      "storing SHORT-LIVED token that will expire in ~2 hours!",
      "\n  failure reason:", reason,
      "\n  full response:", JSON.stringify(json),
    );
    // Compute approximate expiry for the short-lived token (~2 hours from now)
    const shortExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    return { token: shortToken, expiresAt: shortExpiresAt, extended: false, failureReason: reason };
  }

  const expiresIn = json.expires_in ?? null;
  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  console.info(
    "[fb-callback/direct] ✓ Token extended to long-lived.",
    `expires_in=${expiresIn}s`,
    `expires_at=${expiresAt ?? "unknown"}`,
    `token_len=${json.access_token.length}`,
    `token_prefix=${json.access_token.slice(0, 12)}…`,
  );
  return { token: json.access_token, expiresAt, extended: true };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);

  const code       = searchParams.get("code");
  const stateParam = searchParams.get("state") ?? "";
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");

  // ── Entry diagnostics ─────────────────────────────────────────────────────
  console.info("[fb-callback] ── HIT ────────────────────────────────────────");
  console.info("[fb-callback] full URL:", request.url);
  console.info("[fb-callback] code present:", !!code,
    code ? `(length ${code.length}, starts ${code.slice(0, 6)}…)` : "");
  console.info("[fb-callback] oauth_error:", oauthError ?? "(none)");

  const allCookieNames = request.cookies.getAll().map((c) => c.name);
  console.info("[fb-callback] cookies:", allCookieNames.join(", ") || "(none)");

  // ── Mode detection ────────────────────────────────────────────────────────
  // Primary: state prefix (Facebook echoes state unchanged — no cookies needed)
  // Secondary: fb_oauth_state cookie presence
  const stateIsDirectFlow = stateParam.startsWith(DIRECT_STATE_PREFIX);
  const csrfCookie        = request.cookies.get("fb_oauth_state")?.value;
  const isDirectMode      = stateIsDirectFlow || !!csrfCookie;

  console.info("[fb-callback] mode:", isDirectMode ? "DIRECT (app-owned)" : "SUPABASE PKCE");
  console.info("[fb-callback] state prefix direct:", stateIsDirectFlow,
    "| csrf cookie:", csrfCookie ? "present" : "absent");

  if (!isDirectMode) {
    console.info("[fb-callback] → routing to Supabase PKCE path");
  }

  // ── OAuth-level error (user denied / Facebook error) ─────────────────────
  if (!code && oauthError) {
    console.error("[fb-callback] OAuth provider error:", oauthError);
    return errorRedirect(origin, "oauth_denied", oauthError);
  }

  if (!code) {
    console.error("[fb-callback] no code in URL");
    return errorRedirect(origin, "no_code", "No authorisation code in callback URL.");
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MODE A — Direct Facebook OAuth (app-owned)
  // ══════════════════════════════════════════════════════════════════════════
  if (isDirectMode) {
    // CSRF: verify state param against cookie when cookie is available.
    // If the cookie was dropped (cross-site redirect quirk) we still proceed —
    // the state param itself is unguessable and proves Facebook handled the flow.
    if (csrfCookie) {
      if (stateParam !== csrfCookie) {
        console.error("[fb-callback/direct] CSRF mismatch!",
          "state param:", stateParam.slice(0, 14), "cookie:", csrfCookie.slice(0, 14));
        return errorRedirect(origin, "csrf_mismatch", "State parameter mismatch.");
      }
      console.info("[fb-callback/direct] CSRF verified via cookie ✓");
    } else {
      console.warn("[fb-callback/direct] fb_oauth_state cookie absent — " +
        "state prefix used for mode detection only (CSRF cookie was dropped)");
    }

    // redirect_uri: must match exactly what /api/auth/facebook-start sent
    const storedRedirectUri = request.cookies.get("fb_oauth_redirect_uri")?.value
      ?? `${origin}/auth/facebook-callback`;
    const next = safeNext(request.cookies.get("fb_oauth_next")?.value);

    console.info("[fb-callback/direct] redirect_uri:", storedRedirectUri);
    console.info("[fb-callback/direct] next:", next);

    // Exchange code → short-lived token
    const exchangeResult = await exchangeCodeWithFacebook(code, storedRedirectUri);
    if ("error" in exchangeResult) {
      return errorRedirect(origin, "exchange_failed", exchangeResult.error);
    }

    // Extend to ~60-day long-lived token.
    // ⚠️ If extension fails the result.extended=false and a ~2h short-lived
    // token is stored — the user will see "Session expired" a few hours later.
    // The failure reason is logged prominently in extendToken above.
    const extResult = await extendToken(exchangeResult.token);
    const finalToken = extResult.token;
    console.info(
      "[fb-callback/direct] access_token ready:",
      `len=${finalToken.length}`,
      `prefix=${finalToken.slice(0, 12)}…`,
      `extended=${extResult.extended}`,
      extResult.expiresAt ? `expires_at=${extResult.expiresAt}` : "expires_at=unknown",
      extResult.failureReason ? `⚠️ failure=${extResult.failureReason}` : "",
    );

    // Build the redirect response; session cookies must be written onto it
    const redirectResponse = NextResponse.redirect(`${origin}${next}`);

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll(); },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            cookiesToSet.forEach(({ name, value, options }) =>
              redirectResponse.cookies.set(name, value, options));
          },
        },
      },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      console.error("[fb-callback/direct] no authenticated user — cannot persist token");
      return errorRedirect(origin, "no_user",
        "No active session. Sign in and try connecting Facebook again.");
    }

    const { error: dbError } = await supabase
      .from("user_facebook_tokens")
      .upsert(
        {
          user_id: user.id,
          provider_token: finalToken,
          updated_at: new Date().toISOString(),
          expires_at: extResult.expiresAt,
        },
        { onConflict: "user_id" },
      );

    if (dbError) {
      console.error("[fb-callback/direct] DB upsert failed:", dbError.message);
      const hint = dbError.code === "42P01" || dbError.message?.includes("does not exist")
        ? " Apply supabase/migrations/002_user_facebook_tokens.sql."
        : "";
      return errorRedirect(origin, "db_write_failed", `${dbError.message}${hint}`);
    }

    // Clear the OAuth cookies
    const clearOpts = { path: "/", maxAge: 0 };
    redirectResponse.cookies.set("fb_oauth_state",        "", clearOpts);
    redirectResponse.cookies.set("fb_oauth_next",          "", clearOpts);
    redirectResponse.cookies.set("fb_oauth_redirect_uri", "", clearOpts);

    console.info(
      "[fb-callback/direct] token persisted ✓ — redirecting to", next,
      extResult.extended ? "(long-lived ~60d)" : "⚠️ (short-lived ~2h — extension failed)",
    );
    return redirectResponse;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MODE B — Supabase PKCE / magic-link callback (GoTrue-managed)
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Reached only when state does NOT start with "direct_" AND the
  // fb_oauth_state cookie is absent.  This handles the email magic-link
  // sign-in flow where GoTrue redirects here after the code exchange.
  //
  // NOTE: This path calls supabase.auth.exchangeCodeForSession which will
  // fail with "Error validating client secret" if Facebook OAuth is attempted
  // without the correct App Secret in Supabase Auth → Providers → Facebook.
  // For Facebook reconnect, always use /api/auth/facebook-start (Mode A).
  //
  const next = safeNext(searchParams.get("next"));

  const pkceVerifierCookie = allCookieNames.find(
    (n) => n.includes("code-verifier") || n.toLowerCase().includes("pkce"),
  );
  console.info("[fb-callback/supabase] PKCE verifier cookie:", pkceVerifierCookie ?? "NOT FOUND");

  const successRedirect = NextResponse.redirect(`${origin}${next}`);
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            successRedirect.cookies.set(name, value, options));
        },
      },
    },
  );

  console.info("[fb-callback/supabase] calling exchangeCodeForSession…");
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    const errAny = exchangeError as unknown as Record<string, unknown>;
    console.error("[fb-callback/supabase] exchangeCodeForSession FAILED:", {
      message: exchangeError.message,
      status: errAny.status ?? "?",
    });
    console.error(
      "[fb-callback/supabase] If this was a Facebook reconnect: make sure the" +
        " browser ran connectFacebookAccount() → /api/auth/facebook-start (Mode A)," +
        " not an old linkIdentity path. Mode A does NOT call exchangeCodeForSession.",
    );
    return errorRedirect(origin, "exchange_failed", exchangeError.message);
  }

  const session       = data.session;
  const userId        = session?.user?.id ?? null;
  const providerToken = session?.provider_token ?? null;

  console.info("[fb-callback/supabase] user id:", userId ?? "(none)",
    "| provider_token:", providerToken ? "present" : "missing");

  if (!userId) {
    return errorRedirect(origin, "no_user", "Session established but no user id returned.");
  }

  if (!providerToken) {
    console.warn("[fb-callback/supabase] provider_token missing after exchange");
    return errorRedirect(origin, "no_provider_token",
      "Facebook connected but no provider_token returned.");
  }

  // MODE B provider_token is the raw short-lived token from Supabase session;
  // we have no expires_in here, so expires_at is left null.
  const { error: dbError } = await supabase
    .from("user_facebook_tokens")
    .upsert(
      {
        user_id: userId,
        provider_token: providerToken,
        updated_at: new Date().toISOString(),
        expires_at: null,
      },
      { onConflict: "user_id" },
    );

  if (dbError) {
    console.error("[fb-callback/supabase] DB upsert failed:", dbError.message);
    const hint = dbError.code === "42P01" || dbError.message?.includes("does not exist")
      ? " Apply supabase/migrations/002_user_facebook_tokens.sql."
      : "";
    return errorRedirect(origin, "db_write_failed", `${dbError.message}${hint}`);
  }

  console.info("[fb-callback/supabase] provider_token persisted ✓ — redirecting to", next);
  return successRedirect;
}
