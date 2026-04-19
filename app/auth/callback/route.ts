import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Only allow same-app relative redirects after login (no open redirects). */
function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Recovery links should land on /reset-password, not the homepage.
  // We honour ?next= when the email template includes it; as a fallback
  // we also route on ?type=recovery (which Supabase forwards from the
  // verify endpoint when the link was generated for password reset). If
  // both are absent the default is "/", matching plain magic-link logins.
  const isRecovery = searchParams.get("type") === "recovery";
  const explicitNext = safeNextPath(searchParams.get("next"));
  const next =
    isRecovery && explicitNext === "/" ? "/reset-password" : explicitNext;

  // Supabase may redirect here with error in query (e.g. access_denied)
  const authError = searchParams.get("error_description") ?? searchParams.get("error");
  if (!code && authError) {
    const errorUrl = new URL("/login", origin);
    errorUrl.searchParams.set("error", "auth");
    return NextResponse.redirect(errorUrl);
  }

  if (code) {
    // Build the redirect response BEFORE creating the Supabase client.
    // This is critical: Supabase's setAll() callback must write the session
    // cookies directly onto the response object that the browser will receive.
    // Returning a new NextResponse.redirect() after the fact loses those cookies,
    // causing the session never to be established and looping back to /login.
    const redirectResponse = NextResponse.redirect(`${origin}${next}`);

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            // Read the PKCE code verifier (and any other cookies) from the
            // incoming request, where the browser stored them.
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            // Write the new session tokens onto the redirect response so the
            // browser receives them as Set-Cookie headers on this response.
            cookiesToSet.forEach(({ name, value, options }) =>
              redirectResponse.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return redirectResponse;
    }
  }

  // Code missing or exchange failed — send back to login with an error hint
  const errorUrl = new URL("/login", origin);
  errorUrl.searchParams.set("error", "auth");
  return NextResponse.redirect(errorUrl);
}
