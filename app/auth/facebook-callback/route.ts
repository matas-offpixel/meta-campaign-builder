/**
 * GET /auth/facebook-callback
 *
 * Server-side PKCE exchange for Facebook `linkIdentity` OAuth flow.
 *
 * Why server-side (not a client page):
 *   - `exchangeCodeForSession` runs in the same request that writes session
 *     cookies onto the response, so the session is immediately available for
 *     the DB upsert that follows — no race between browser cookie storage and
 *     server auth state.
 *   - `provider_token` is present on the `data.session` returned by
 *     `exchangeCodeForSession` before any redirect happens.
 *
 * Flow:
 *   1. Read `code`, `next`, and any OAuth error from query params.
 *   2. Build the redirect response first (critical for cookie propagation).
 *   3. Create a Supabase server client that writes cookies onto that response.
 *   4. Call `exchangeCodeForSession(code)`.
 *   5. If provider_token is present, upsert it into `user_facebook_tokens`.
 *   6. Redirect to `next` on success, or `/auth/facebook-error?reason=...` on failure.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Only allow same-app relative redirects (no open redirects). */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function errorRedirect(origin: string, reason: string, detail?: string): NextResponse {
  const url = new URL("/auth/facebook-error", origin);
  url.searchParams.set("reason", reason);
  if (detail) url.searchParams.set("detail", detail.slice(0, 300));
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code    = searchParams.get("code");
  const next    = safeNext(searchParams.get("next"));
  const oauthError =
    searchParams.get("error_description") ?? searchParams.get("error");

  // ── Comprehensive entry diagnostics ─────────────────────────────────────
  console.info("[fb-callback] ── HIT ────────────────────────────────────────");
  console.info("[fb-callback] full URL:", request.url);
  console.info("[fb-callback] origin:", origin);
  console.info("[fb-callback] next:", next);
  console.info(
    "[fb-callback] code present:", !!code,
    code ? `(length ${code.length}, starts ${code.slice(0, 6)}…)` : "",
  );
  console.info("[fb-callback] oauth_error param:", oauthError ?? "(none)");

  // Log all cookie names so we can confirm the PKCE code-verifier cookie is present.
  const allCookieNames = request.cookies.getAll().map((c) => c.name);
  const pkceVerifierCookie = allCookieNames.find(
    (n) => n.includes("code-verifier") || n.toLowerCase().includes("pkce"),
  );
  const supabaseAuthCookies = allCookieNames.filter((n) => n.startsWith("sb-"));
  console.info("[fb-callback] all cookie names:", allCookieNames.join(", ") || "(none)");
  console.info(
    "[fb-callback] PKCE code-verifier cookie:",
    pkceVerifierCookie ?? "NOT FOUND",
    pkceVerifierCookie
      ? "✓"
      : "✗ — exchangeCodeForSession will fail if verifier is missing",
  );
  console.info("[fb-callback] Supabase auth cookies:", supabaseAuthCookies.join(", ") || "(none)");

  // ── Facebook / Supabase returned an OAuth-level error ────────────────────
  if (!code && oauthError) {
    console.error("[fb-callback] OAuth provider error:", oauthError);
    return errorRedirect(origin, "oauth_denied", oauthError);
  }

  if (!code) {
    console.error("[fb-callback] no code in URL");
    return errorRedirect(
      origin,
      "no_code",
      "No authorisation code in callback URL. Check redirect URI in your Facebook app settings.",
    );
  }

  // ── Build the redirect response BEFORE the Supabase client ───────────────
  // All cookie writes from exchangeCodeForSession must land on this response.
  const successRedirect = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write cookies onto both the request (for subsequent calls in this
          // handler) and the redirect response (for the browser).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            successRedirect.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // ── Exchange the PKCE code for a session ──────────────────────────────────
  console.info("[fb-callback] calling exchangeCodeForSession…");
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    // Log the full error object — "Unable to exchange external code" means GoTrue
    // tried to exchange the stored Facebook authorization code with Facebook's
    // token endpoint and Facebook rejected it.  Common causes:
    //   1. redirect_uri mismatch — the Supabase project's Facebook OAuth config
    //      uses a different callback URL than the one registered in Meta's app.
    //   2. Code expired — Facebook auth codes expire quickly; timing issue.
    //   3. Wrong API — signInWithOAuth was used for an already-authenticated
    //      user, creating a PKCE session conflict.  Should use linkIdentity.
    const errAny = exchangeError as unknown as Record<string, unknown>;
    console.error("[fb-callback] exchangeCodeForSession FAILED:", {
      message: exchangeError.message,
      status: errAny.status ?? "?",
      name: exchangeError.name,
      code: errAny.code ?? "?",
    });
    console.error(
      "[fb-callback] Diagnosis hint:" +
        "\n  — If 'Unable to exchange external code': check Supabase dashboard → Auth → Providers → Facebook." +
        "\n    The 'Callback URL' shown there must be added to Meta app → Facebook Login → Valid OAuth Redirect URIs." +
        "\n    Our app callback URL should be in Supabase Auth → URL Configuration → Redirect URLs (not in Meta)." +
        "\n  — PKCE verifier cookie present:", pkceVerifierCookie ?? "NOT FOUND",
    );
    return errorRedirect(origin, "exchange_failed", exchangeError.message);
  }

  const session      = data.session;
  const userId       = session?.user?.id ?? null;
  const providerToken = session?.provider_token ?? null;

  console.info("[fb-callback] session:", !!session);
  console.info("[fb-callback] user id:", userId ?? "(none)");
  console.info("[fb-callback] provider_token:", providerToken ? `present (${providerToken.length} chars)` : "missing");
  console.info("[fb-callback] provider_refresh_token:", session?.provider_refresh_token ? "present" : "missing");
  console.info(
    "[fb-callback] identities:",
    session?.user?.identities?.map((i) => i.provider).join(", ") ?? "(none)",
  );

  if (!userId) {
    console.error("[fb-callback] no user id after exchange — aborting");
    return errorRedirect(origin, "no_user", "Session established but no user id was returned.");
  }

  if (!providerToken) {
    // Log the full safe shape so we can diagnose from server logs
    console.warn("[fb-callback] provider_token missing — session keys:", Object.keys(session ?? {}));
    console.warn(
      "[fb-callback] Supabase does NOT persist provider_token across sessions. " +
        "It is only returned immediately after the OAuth exchange. " +
        "If it is missing here, Facebook may not have included it. " +
        "Ensure the app requests pages_show_list and that Facebook has approved those permissions.",
    );
    return errorRedirect(
      origin,
      "no_provider_token",
      "Facebook connected but no provider_token was returned. " +
        "Check your Facebook app scopes (pages_show_list, ads_management) " +
        "and try connecting again.",
    );
  }

  // ── Persist the provider_token to the DB ─────────────────────────────────
  // The supabase client has the fresh session in memory at this point, so the
  // upsert is authenticated automatically via the just-exchanged session.
  console.info("[fb-callback] upserting provider_token to user_facebook_tokens…");
  const { error: dbError } = await supabase
    .from("user_facebook_tokens")
    .upsert(
      {
        user_id: userId,
        provider_token: providerToken,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (dbError) {
    console.error(
      "[fb-callback] DB upsert failed:",
      dbError.message,
      "code:", dbError.code,
      "details:", dbError.details,
      "hint:", dbError.hint,
    );

    const hint =
      dbError.code === "42P01" || dbError.message?.includes("does not exist")
        ? " Apply supabase/migrations/002_user_facebook_tokens.sql."
        : "";

    return errorRedirect(
      origin,
      "db_write_failed",
      `${dbError.message}${hint}`,
    );
  }

  console.info("[fb-callback] provider_token persisted ✓ — redirecting to", next);
  return successRedirect;
}
