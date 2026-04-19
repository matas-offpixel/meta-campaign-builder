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

/**
 * Path prefixes that are open to unauthenticated visitors. Used for routes
 * whose access control is enforced inside the route itself (e.g. the public
 * report share validates a one-shot token + an `enabled` flag before
 * exposing any data).
 *
 * Keep this list extremely short — every entry here is a hole through the
 * default-deny middleware. Add a prefix only when:
 *   1. The route resolves a long, unguessable identifier (token, slug)
 *      before serving any user data, AND
 *   2. The route validates the identifier with a service-role read that
 *      bypasses RLS in a controlled way.
 */
const PUBLIC_PREFIXES: readonly string[] = [
  // Public client-facing event report share (Slice U).
  // Resolves a 16-char base64url token via service-role client, returns 404
  // for unknown / disabled / expired tokens. No internal IDs ever leak into
  // the URL or rendered HTML — token is the only identifier exposed.
  "/share/",
  "/api/share/",
];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Magic link callback, logout route, future OAuth callbacks
  if (pathname.startsWith("/auth/")) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}
