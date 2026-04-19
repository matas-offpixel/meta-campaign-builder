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
import { storeFacebookToken } from "@/lib/db/facebook-tokens";

const DIRECT_STATE_PREFIX = "direct_";

/**
 * Graph API version used for the OAuth endpoints below.
 *
 * Both the auth-code exchange and `fb_exchange_token` accept versioned and
 * unversioned URLs, but every other Meta call we make is pinned to
 * `META_API_VERSION` (default v21.0).  Pin these too so an upstream API
 * deprecation surfaces consistently rather than only on Graph data calls.
 */
const META_API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const FB_OAUTH_BASE = `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`;

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

  const url = new URL(FB_OAUTH_BASE);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);

  console.info("[fb-callback/direct] exchanging code → token", `(api=${META_API_VERSION})`);
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

/**
 * Discriminated union — forces callers to handle failure before accessing the token.
 * This makes it structurally impossible to store a short-lived token when extension fails.
 */
type ExtendTokenResult =
  | {
      ok: true;
      /** Long-lived access token (~60 days) */
      token: string;
      /** ISO string; always set on success */
      expiresAt: string;
      /** Seconds until expiry as returned by Facebook */
      expiresInSeconds: number;
    }
  | {
      ok: false;
      /** Human-readable failure reason for logs and the error page detail param */
      error: string;
    };

/**
 * Exchange a short-lived token for a ~60-day long-lived token.
 *
 * Env vars used:
 *   FACEBOOK_APP_ID      — numeric Facebook App ID (Meta dashboard → Settings → Basic)
 *   FACEBOOK_APP_SECRET  — Facebook App Secret   (same location — keep server-only)
 *
 * Returns { ok: false } on ANY failure — caller MUST abort and NOT store the
 * short-lived token.
 */
async function extendToken(shortToken: string): Promise<ExtendTokenResult> {
  const appId     = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  // ── Step 1: Validate env vars ─────────────────────────────────────────────
  console.info("[fb-callback/direct] extendToken — starting long-lived token extension");
  console.info(
    "[fb-callback/direct] extendToken — env vars:",
    `FACEBOOK_APP_ID=${appId ? `set (${appId})` : "MISSING"}`,
    `FACEBOOK_APP_SECRET=${appSecret ? `set (len=${appSecret.length})` : "MISSING"}`,
  );

  if (!appId || !appSecret) {
    const reason =
      !appId && !appSecret
        ? "FACEBOOK_APP_ID and FACEBOOK_APP_SECRET are both missing from server environment"
        : !appId
          ? "FACEBOOK_APP_ID is missing from server environment"
          : "FACEBOOK_APP_SECRET is missing from server environment";
    console.error(
      "[fb-callback/direct] extendToken FAILED —", reason,
      "\n  ACTION: Add both env vars from Meta app dashboard → Settings → Basic.",
      "\n  DB write SKIPPED — short-lived token NOT stored.",
    );
    return { ok: false, error: reason };
  }

  // ── Step 2: Log short-lived token receipt ─────────────────────────────────
  console.info(
    "[fb-callback/direct] extendToken — short-lived token received:",
    `len=${shortToken.length} prefix=${shortToken.slice(0, 12)}…`,
  );

  // ── Step 3: Call fb_exchange_token ────────────────────────────────────────
  const url = new URL(FB_OAUTH_BASE);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);

  console.info(
    "[fb-callback/direct] extendToken — calling fb_exchange_token…",
    `(api=${META_API_VERSION})`,
  );

  let res: Response;
  let json: FbTokenResponse;
  try {
    res  = await fetch(url.toString(), { cache: "no-store" });
    json = (await res.json()) as FbTokenResponse;
  } catch (err) {
    const reason = `Network error calling Facebook token endpoint: ${String(err)}`;
    console.error("[fb-callback/direct] extendToken FAILED —", reason,
      "\n  DB write SKIPPED — short-lived token NOT stored.");
    return { ok: false, error: reason };
  }

  // ── Step 4: Handle Facebook API error ────────────────────────────────────
  if (!res.ok || json.error || !json.access_token) {
    const fbErrMsg  = json.error?.message ?? "(no message)";
    const fbErrType = json.error?.type    ?? "(no type)";
    const fbErrCode = json.error?.code    ?? "(no code)";
    const reason = `Facebook rejected extension: ${fbErrMsg} (type=${fbErrType} code=${fbErrCode} HTTP=${res.status})`;
    console.error(
      "[fb-callback/direct] extendToken FAILED —", reason,
      "\n  Most likely cause: FACEBOOK_APP_SECRET does not match Meta dashboard",
      "\n  or the app is in development mode with restricted token operations.",
      "\n  full response:", JSON.stringify(json),
      "\n  DB write SKIPPED — short-lived token NOT stored.",
    );
    return { ok: false, error: reason };
  }

  // ── Step 5: Success ───────────────────────────────────────────────────────
  const expiresInSeconds = json.expires_in ?? 5_183_944; // 60 days minus a minute as fallback
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  console.info(
    "[fb-callback/direct] extendToken SUCCEEDED ✓",
    `\n  expires_in=${expiresInSeconds}s (~${(expiresInSeconds / 86400).toFixed(1)} days)`,
    `\n  expires_at=${expiresAt}`,
    `\n  token_len=${json.access_token.length}`,
    `\n  token_prefix=${json.access_token.slice(0, 12)}…`,
  );
  return { ok: true, token: json.access_token, expiresAt, expiresInSeconds };
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

    // ── Stage 1: Exchange auth code for short-lived token ─────────────────
    const exchangeResult = await exchangeCodeWithFacebook(code, storedRedirectUri);
    if ("error" in exchangeResult) {
      return errorRedirect(origin, "exchange_failed", exchangeResult.error);
    }
    console.info(
      "[fb-callback/direct] short-lived token received from Facebook ✓",
      `len=${exchangeResult.token.length} prefix=${exchangeResult.token.slice(0, 12)}…`,
      `expires_in=${exchangeResult.expiresIn ?? "unknown"}s`,
    );

    // ── Stage 2: Extend to long-lived token (REQUIRED — fail closed) ───────
    //
    // POLICY: We NEVER store a short-lived (~2h) token.  If extension fails,
    // the reconnect is aborted entirely and the user is sent to the error page.
    // This prevents the "Session has expired" crash that was occurring hours
    // after a reconnect where extension had silently failed.
    const extResult = await extendToken(exchangeResult.token);

    if (!extResult.ok) {
      // Extension failed — abort, do NOT write to DB.
      console.error(
        "[fb-callback/direct] ⛔ Aborting reconnect — extension failed, DB write SKIPPED.",
        `reason: ${extResult.error}`,
      );
      return errorRedirect(origin, "extension_failed", extResult.error);
    }

    // extResult.ok === true — TypeScript now knows token/expiresAt are present
    console.info(
      "[fb-callback/direct] long-lived token ready for DB write ✓",
      `len=${extResult.token.length} prefix=${extResult.token.slice(0, 12)}…`,
      `expires_at=${extResult.expiresAt} (~${(extResult.expiresInSeconds / 86400).toFixed(1)}d)`,
    );

    // ── Stage 3: Build redirect response, load Supabase session ───────────
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

    // ── Stage 4: Persist long-lived token to DB ────────────────────────────
    // Only reached when extResult.ok === true.  Short-lived tokens are NEVER
    // written here.
    const stored = await storeFacebookToken(supabase, {
      userId: user.id,
      token: extResult.token,        // always the long-lived token
      expiresAt: extResult.expiresAt, // always set on success
    });

    if (!stored.ok) {
      console.error("[fb-callback/direct] DB upsert failed:", stored.error);
      const hint =
        stored.errorCode === "42P01" || stored.error?.includes("does not exist")
          ? " Apply supabase/migrations/002_user_facebook_tokens.sql."
          : "";
      return errorRedirect(origin, "db_write_failed", `${stored.error ?? "unknown"}${hint}`);
    }

    // Clear the OAuth cookies
    const clearOpts = { path: "/", maxAge: 0 };
    redirectResponse.cookies.set("fb_oauth_state",        "", clearOpts);
    redirectResponse.cookies.set("fb_oauth_next",          "", clearOpts);
    redirectResponse.cookies.set("fb_oauth_redirect_uri", "", clearOpts);

    console.info(
      `[fb-callback/direct] ✓ Long-lived token persisted — redirecting to ${next}`,
      `expires_at=${extResult.expiresAt}`,
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

  // MODE B's `provider_token` is the raw short-lived (~1-2h) token returned by
  // Supabase's PKCE exchange. Run it through `fb_exchange_token` to convert it
  // into a 60-day long-lived token before persisting — same fail-closed
  // contract as Mode A: if the extension fails we redirect to the error page
  // and never write the short-lived token to the DB.
  const ext = await extendToken(providerToken);
  if (!ext.ok) {
    console.error(
      "[fb-callback/supabase] long-lived token exchange FAILED:",
      ext.error,
    );
    return errorRedirect(
      origin,
      "token_exchange_failed",
      ext.error ?? "fb_exchange_token failed",
    );
  }

  const stored = await storeFacebookToken(supabase, {
    userId,
    token: ext.token,
    expiresAt: ext.expiresAt,
  });

  if (!stored.ok) {
    console.error("[fb-callback/supabase] DB upsert failed:", stored.error);
    const hint =
      stored.errorCode === "42P01" || stored.error?.includes("does not exist")
        ? " Apply supabase/migrations/002_user_facebook_tokens.sql."
        : "";
    return errorRedirect(origin, "db_write_failed", `${stored.error ?? "unknown"}${hint}`);
  }

  console.info(
    "[fb-callback/supabase] long-lived provider_token persisted ✓",
    `expires_at=${ext.expiresAt}`,
    "— redirecting to", next,
  );
  return successRedirect;
}
