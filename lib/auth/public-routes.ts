/**
 * Routes that must be reachable without an authenticated Supabase session.
 * Used by the proxy (Next.js 16) — auth checks use @supabase/ssr + getUser(),
 * not manual cookie name checks.
 */
// /reset-password is public so the recovery email link can land directly
// here even when the implicit flow puts the session in the URL fragment
// (server-side has no cookies yet → would otherwise be bounced to /login).
// Authorisation for the actual password change still happens client-side
// against the recovery session that the SDK consumes from the fragment
// or that /auth/callback set into cookies.
export const PUBLIC_PATHS = new Set<string>(["/login", "/reset-password"]);

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Magic link callback, logout route, future OAuth callbacks
  if (pathname.startsWith("/auth/")) return true;
  return false;
}
