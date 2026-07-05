import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * app/admin/auth/callback/route.ts
 *
 * Supabase code exchange for the CLIENT admin dashboard's magic links
 * (OP909). Mirrors app/auth/callback/route.ts exactly except:
 *   - default landing is /admin (the proxy then routes to the member's
 *     own /admin/{slug}, or bounces non-members to /admin/login)
 *   - failures land on /admin/login?error=auth, not /login
 *
 * The critical cookie pattern is preserved: build the redirect response
 * FIRST, then attach the session cookies to that same response via
 * setAll — using lib/supabase/server's createClient here would drop the
 * cookies on the redirect.
 */

/** Only allow same-app relative redirects after login (no open redirects). */
function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/admin";
  return next;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));

  const authError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (!code && !token_hash && authError) {
    const errorUrl = new URL("/admin/login", origin);
    errorUrl.searchParams.set("error", "auth");
    return NextResponse.redirect(errorUrl);
  }

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

  if (code) {
    const redirectResponse = NextResponse.redirect(`${origin}${next}`);
    const { error } =
      await buildClient(redirectResponse).auth.exchangeCodeForSession(code);
    if (!error) return redirectResponse;
  }

  if (token_hash && type) {
    const redirectResponse = NextResponse.redirect(`${origin}${next}`);
    const { error } = await buildClient(redirectResponse).auth.verifyOtp({
      token_hash,
      type,
    });
    if (!error) return redirectResponse;
  }

  const errorUrl = new URL("/admin/login", origin);
  errorUrl.searchParams.set("error", "auth");
  return NextResponse.redirect(errorUrl);
}
