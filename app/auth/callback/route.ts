import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";

/** Only allow same-app relative redirects after login (no open redirects). */
function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

/**
 * Supabase auth callback — two arrival modes:
 *
 * 1. PKCE (magic link / OAuth):
 *    ?code=<auth_code>                       → exchangeCodeForSession(code)
 *
 * 2. Token-hash (email OTP / recovery):
 *    ?token_hash=<hash>&type=<EmailOtpType>  → verifyOtp({ token_hash, type })
 *
 * The `{{ .TokenHash }}` template variable is a hashed OTP, NOT a PKCE auth
 * code. Passing it to exchangeCodeForSession() always fails. The correct call
 * is verifyOtp() — see https://supabase.com/docs/guides/auth/auth-email-templates
 * ("Redirecting the user to a server-side endpoint").
 *
 * Both paths write the resulting session into cookies on the redirect response,
 * so downstream server components see the session immediately.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));

  // Supabase may redirect here with an error (e.g. access_denied from OAuth).
  const authError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (!code && !token_hash && authError) {
    const errorUrl = new URL("/login", origin);
    errorUrl.searchParams.set("error", "auth");
    return NextResponse.redirect(errorUrl);
  }

  // Build a server Supabase client that writes session cookies onto `response`.
  // Must be built against the specific response object — setAll() must write
  // cookies onto the object the browser will actually receive. Creating the
  // response first and passing it in is critical; constructing a new
  // NextResponse.redirect() after the session exchange loses the cookies.
  function buildClient(response: NextResponse) {
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );
  }

  // Path 1: PKCE flow — magic link or OAuth code exchange.
  if (code) {
    const redirectResponse = NextResponse.redirect(`${origin}${next}`);
    const { error } = await buildClient(redirectResponse).auth.exchangeCodeForSession(code);
    if (!error) return redirectResponse;
  }

  // Path 2: Token-hash flow — email OTP verification (recovery, signup, etc.).
  // The email template uses {{ .TokenHash }} which is a hashed OTP token,
  // verified here with verifyOtp. The ?type= param tells Supabase which kind
  // of OTP it is (recovery | signup | invite | magiclink | email_change).
  if (token_hash && type) {
    const redirectResponse = NextResponse.redirect(`${origin}${next}`);
    const { error } = await buildClient(redirectResponse).auth.verifyOtp({
      token_hash,
      type,
    });
    if (!error) return redirectResponse;
  }

  // Missing token or exchange failed — send back to login with an error hint.
  const errorUrl = new URL("/login", origin);
  errorUrl.searchParams.set("error", "auth");
  return NextResponse.redirect(errorUrl);
}
