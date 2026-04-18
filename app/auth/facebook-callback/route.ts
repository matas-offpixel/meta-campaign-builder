/**
 * GET /auth/facebook-callback
 *
 * Handles TWO callback modes that share the same URL:
 *
 * ── MODE A: Direct OAuth (preferred) ────────────────────────────────────────
 *   Triggered by /api/auth/facebook-start.
 *   Detected by the presence of the `fb_oauth_state` httpOnly cookie.
 *
 *   Flow:
 *     1. Verify `?state=` matches the `fb_oauth_state` cookie (CSRF).
 *     2. POST the `?code=` to Facebook's token endpoint with the same
 *        redirect_uri used in the authorization (no mismatch possible).
 *     3. Optionally extend the short-lived token to a 60-day long-lived token.
 *     4. Upsert the access_token into `user_facebook_tokens`.
 *     5. Redirect to `fb_oauth_next`.
 *
 *   Why this fixes "Unable to exchange external code":
 *     GoTrue's PKCE-deferred exchange calls Facebook's token endpoint with
 *     `redirect_uri = flowState.RedirectTo` (our app URL), but the
 *     authorization step used GoTrue's own callback URL — a redirect_uri
 *     mismatch.  Here WE own the entire loop so redirect_uri is always the
 *     same value.
 *
 * ── MODE B: Supabase PKCE (legacy / fallback) ────────────────────────────────
 *   Triggered by GoTrue's linkIdentity/signInWithOAuth redirects.
 *   Detected by the absence of the `fb_oauth_state` cookie.
 *   Preserved for backward compatibility while the old PKCE path is phased out.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Only allow same-app relative redirects. */
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

// ── Direct token exchange helper ──────────────────────────────────────────────

interface FacebookTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
}

async function exchangeCodeWithFacebook(
  code: string,
  redirectUri: string,
  origin: string,
): Promise<{ token: string; expiresIn: number | null } | { error: string }> {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    return {
      error:
        "FACEBOOK_APP_ID or FACEBOOK_APP_SECRET env vars are not set. " +
        "Add them to your .env.local (and Vercel environment) from the Meta app dashboard.",
    };
  }

  const url = new URL("https://graph.facebook.com/oauth/access_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);

  console.info("[fb-callback/direct] exchanging code with Facebook token endpoint");
  console.info("[fb-callback/direct] redirect_uri used in exchange:", redirectUri);

  const res = await fetch(url.toString(), { cache: "no-store" });
  const json = (await res.json()) as FacebookTokenResponse;

  if (!res.ok || json.error) {
    const msg = json.error?.message ?? `HTTP ${res.status}`;
    console.error("[fb-callback/direct] Facebook token exchange failed:", json);
    return { error: msg };
  }

  if (!json.access_token) {
    return { error: "Facebook returned no access_token in token response." };
  }

  return { token: json.access_token, expiresIn: json.expires_in ?? null };
}

async function extendToLongLivedToken(
  shortToken: string,
): Promise<{ token: string } | { error: string }> {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return { token: shortToken }; // skip silently if missing

  const url = new URL("https://graph.facebook.com/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);

  const res = await fetch(url.toString(), { cache: "no-store" });
  const json = (await res.json()) as FacebookTokenResponse;

  if (!res.ok || json.error || !json.access_token) {
    console.warn(
      "[fb-callback/direct] long-lived token extension failed (using short-lived):",
      json.error?.message ?? `HTTP ${res.status}`,
    );
    return { token: shortToken }; // fall back to short-lived
  }

  console.info(
    "[fb-callback/direct] token extended to long-lived (~60 days)," +
      " expires_in:", json.expires_in,
  );
  return { token: json.access_token };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const oauthError =
    searchParams.get("error_description") ?? searchParams.get("error");

  // ── Entry diagnostics ─────────────────────────────────────────────────────
  console.info("[fb-callback] ── HIT ────────────────────────────────────────");
  console.info("[fb-callback] full URL:", request.url);
  console.info("[fb-callback] origin:", origin);
  console.info(
    "[fb-callback] code present:", !!code,
    code ? `(length ${code.length}, starts ${code.slice(0, 6)}…)` : "",
  );
  console.info("[fb-callback] oauth_error param:", oauthError ?? "(none)");

  const allCookieNames = request.cookies.getAll().map((c) => c.name);
  console.info("[fb-callback] cookies present:", allCookieNames.join(", ") || "(none)");

  // ── Detect mode ───────────────────────────────────────────────────────────
  const csrfStateCookie = request.cookies.get("fb_oauth_state")?.value;
  const isDirectMode = !!csrfStateCookie;
  console.info(
    "[fb-callback] mode:", isDirectMode ? "DIRECT (app-owned OAuth)" : "SUPABASE PKCE (GoTrue)",
  );

  // ── OAuth-level error ─────────────────────────────────────────────────────
  if (!code && oauthError) {
    console.error("[fb-callback] OAuth provider error:", oauthError);
    return errorRedirect(origin, "oauth_denied", oauthError);
  }

  if (!code) {
    console.error("[fb-callback] no code in URL");
    return errorRedirect(
      origin,
      "no_code",
      "No authorisation code in callback URL.",
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MODE A — Direct Facebook OAuth
  // ══════════════════════════════════════════════════════════════════════════
  if (isDirectMode) {
    // CSRF verification
    if (stateParam !== csrfStateCookie) {
      console.error(
        "[fb-callback/direct] CSRF mismatch!",
        "state param:", stateParam?.slice(0, 8),
        "cookie:", csrfStateCookie.slice(0, 8),
      );
      return errorRedirect(origin, "csrf_mismatch", "State parameter mismatch.");
    }
    console.info("[fb-callback/direct] CSRF state verified ✓");

    const storedRedirectUri = request.cookies.get("fb_oauth_redirect_uri")?.value;
    const next = safeNext(request.cookies.get("fb_oauth_next")?.value);

    if (!storedRedirectUri) {
      return errorRedirect(
        origin,
        "missing_redirect_uri_cookie",
        "fb_oauth_redirect_uri cookie missing — OAuth session may have expired.",
      );
    }

    console.info("[fb-callback/direct] redirect_uri from cookie:", storedRedirectUri);
    console.info("[fb-callback/direct] next:", next);

    // Exchange code → short-lived access_token
    const exchangeResult = await exchangeCodeWithFacebook(code, storedRedirectUri, origin);
    if ("error" in exchangeResult) {
      return errorRedirect(origin, "exchange_failed", exchangeResult.error);
    }

    // Extend to long-lived token (~60 days)
    const extendResult = await extendToLongLivedToken(exchangeResult.token);
    const finalToken = "token" in extendResult ? extendResult.token : exchangeResult.token;

    console.info(
      "[fb-callback/direct] access_token obtained," +
        " length:", finalToken.length,
      " short-lived expires_in:", exchangeResult.expiresIn,
    );

    // Build redirect response (cookies must be written onto it)
    const redirectResponse = NextResponse.redirect(`${origin}${next}`);

    // Supabase client to persist the token
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll(); },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            cookiesToSet.forEach(({ name, value, options }) =>
              redirectResponse.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? null;

    if (!userId) {
      console.error("[fb-callback/direct] no authenticated user — cannot persist token");
      return errorRedirect(
        origin,
        "no_user",
        "No active session. Please sign in and try connecting Facebook again.",
      );
    }

    const { error: dbError } = await supabase
      .from("user_facebook_tokens")
      .upsert(
        {
          user_id: userId,
          provider_token: finalToken,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (dbError) {
      console.error("[fb-callback/direct] DB upsert failed:", dbError.message);
      const hint =
        dbError.code === "42P01" || dbError.message?.includes("does not exist")
          ? " Apply supabase/migrations/002_user_facebook_tokens.sql."
          : "";
      return errorRedirect(origin, "db_write_failed", `${dbError.message}${hint}`);
    }

    // Clear the CSRF cookies
    const clearOpts = { path: "/", maxAge: 0 };
    redirectResponse.cookies.set("fb_oauth_state", "", clearOpts);
    redirectResponse.cookies.set("fb_oauth_next", "", clearOpts);
    redirectResponse.cookies.set("fb_oauth_redirect_uri", "", clearOpts);

    console.info("[fb-callback/direct] token persisted ✓ — redirecting to", next);
    return redirectResponse;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MODE B — Supabase PKCE (legacy GoTrue-mediated flow)
  // ══════════════════════════════════════════════════════════════════════════
  const next = safeNext(searchParams.get("next"));

  const pkceVerifierCookie = allCookieNames.find(
    (n) => n.includes("code-verifier") || n.toLowerCase().includes("pkce"),
  );
  console.info(
    "[fb-callback/supabase] PKCE code-verifier cookie:",
    pkceVerifierCookie ?? "NOT FOUND",
    pkceVerifierCookie
      ? "✓"
      : "✗ — exchangeCodeForSession will fail if verifier is missing",
  );

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
            successRedirect.cookies.set(name, value, options),
          );
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
      name: exchangeError.name,
      code: errAny.code ?? "?",
    });
    console.error(
      "[fb-callback/supabase] If 'Unable to exchange external code': this is a" +
        " GoTrue PKCE redirect_uri mismatch.  Switch to /api/auth/facebook-start" +
        " (the direct OAuth path) instead of linkIdentity/signInWithOAuth." +
        "  PKCE verifier cookie:", pkceVerifierCookie ?? "NOT FOUND",
    );
    return errorRedirect(origin, "exchange_failed", exchangeError.message);
  }

  const session       = data.session;
  const userId        = session?.user?.id ?? null;
  const providerToken = session?.provider_token ?? null;

  console.info("[fb-callback/supabase] session:", !!session, "user id:", userId ?? "(none)");
  console.info("[fb-callback/supabase] provider_token:", providerToken ? "present" : "missing");

  if (!userId) {
    return errorRedirect(origin, "no_user", "Session established but no user id returned.");
  }

  if (!providerToken) {
    console.warn("[fb-callback/supabase] provider_token missing after exchange");
    return errorRedirect(
      origin,
      "no_provider_token",
      "Facebook connected but no provider_token was returned.",
    );
  }

  const { error: dbError } = await supabase
    .from("user_facebook_tokens")
    .upsert(
      { user_id: userId, provider_token: providerToken, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );

  if (dbError) {
    console.error("[fb-callback/supabase] DB upsert failed:", dbError.message);
    const hint =
      dbError.code === "42P01" || dbError.message?.includes("does not exist")
        ? " Apply supabase/migrations/002_user_facebook_tokens.sql."
        : "";
    return errorRedirect(origin, "db_write_failed", `${dbError.message}${hint}`);
  }

  console.info("[fb-callback/supabase] provider_token persisted ✓ — redirecting to", next);
  return successRedirect;
}
