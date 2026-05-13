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
  // Public share routes — both event-scoped (/share/report/[token],
  // Slice U) and client-scoped (/share/client/[token], the ticket-input
  // portal) live behind these prefixes plus their /api/share counterparts.
  // Each route resolves a 16-char base64url token via the service-role
  // client and returns a generic 404 for unknown / disabled / expired
  // tokens. No internal IDs ever leak into the URL or rendered HTML —
  // the token is the only identifier exposed.
  "/share/",
  "/api/share/",
  // Event-level share-token CRUD (additional spend GET/POST/PATCH/DELETE).
  // These routes resolve a long, unguessable share token via service-role
  // before serving any data; they must be reachable by unauthenticated
  // visitors (e.g. incognito) who hold a valid report share link.
  "/api/events/by-share-token/",
  // Vercel Cron entry points. The proxy's default-deny would 302 the
  // scheduled invocations to /login before each route's own
  // CRON_SECRET bearer-token check ever runs, which is how the
  // creative-insights pre-warm and ticketing sync silently no-op'd
  // for weeks. Each route under this prefix MUST validate
  // `Authorization: Bearer <CRON_SECRET>` itself and return 401 on
  // mismatch — the bypass here only stops the session check, it does
  // not stop the route's own auth.
  "/api/cron/",
];

/**
 * Meta thumbnail proxy with `share_token` must bypass cookie middleware so
 * `<img src>` on public share pages can load (same pattern as `/api/share/*`).
 */
function isThumbnailProxyShareRequest(searchParams: URLSearchParams): boolean {
  const t = searchParams.get("share_token");
  return typeof t === "string" && t.length >= 12 && t.length <= 128;
}

export function isPublicPath(
  pathname: string,
  searchParams?: URLSearchParams,
): boolean {
  // `/api/admin/meta-enhancement-probe` validates CRON_SECRET or session in
  // the route — bearer-only curls must reach the handler (see probe doc).
  if (pathname === "/api/admin/meta-enhancement-probe") return true;
  // `/api/admin/rollup-pre-pr395-backfill` — one-shot admin backfill triggered
  // manually via Bearer CRON_SECRET; must bypass the session middleware so the
  // route's own isCronAuthorized check can run (same pattern as probe above).
  if (pathname === "/api/admin/rollup-pre-pr395-backfill") return true;
  // `/api/internal/scan-enhancement-flags` — Vercel Cron + Bearer CRON_SECRET only.
  if (pathname === "/api/internal/scan-enhancement-flags") return true;
  // Per-venue Meta daily-budget reader. The route's own `authorizeRequest`
  // (app/api/clients/[id]/venues/[event_code]/daily-budget/route.ts) accepts
  // either a Supabase session OR a `client_token` query param that it
  // validates via the service-role client. Without this carve-out the proxy
  // default-deny redirects share-surface viewers to /login before the
  // route's own auth runs, silently degrading the Daily Budget cell on
  // /share/client/[token] venue cards. Same pattern as PR #407.
  if (/^\/api\/clients\/[^/]+\/venues\/[^/]+\/daily-budget$/.test(pathname)) {
    return true;
  }
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Magic link callback, logout route, future OAuth callbacks
  if (pathname.startsWith("/auth/")) return true;
  if (
    pathname === "/api/meta/thumbnail-proxy" &&
    searchParams &&
    isThumbnailProxyShareRequest(searchParams)
  ) {
    return true;
  }
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}
