/**
 * Routes that must be reachable without an authenticated Supabase session.
 * Used by the proxy (Next.js 16) — auth checks use @supabase/ssr + getUser(),
 * not manual cookie name checks.
 */
export const PUBLIC_PATHS = new Set<string>(["/login"]);

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Magic link callback, logout route, future OAuth callbacks
  if (pathname.startsWith("/auth/")) return true;
  return false;
}
