/**
 * lib/auth/admin-routes.ts
 *
 * Path classification for the client-facing /admin surface (OP909
 * self-service dashboard — see docs/ADMIN_DASHBOARD_ARCHITECTURE.md).
 * Pure string logic, no imports — node:test friendly.
 *
 * The /admin namespace is shared by TWO audiences:
 *   1. CLIENT dashboards — /admin/{clientSlug}/... routed through
 *      client_users membership (migration 137). Enforced in the proxy:
 *      session required, membership required, slug must match.
 *   2. OPERATOR one-offs that PRE-DATE this arc — /admin/render-test,
 *      /admin/render-reel, /admin/cron-health. Session-only, no
 *      client_users check (operators don't have membership rows).
 *      A client slug colliding with these reserved segments is
 *      impossible to route — keep the list in sync with app/.
 */

/** Exact public paths under /admin (no session required). */
export const ADMIN_PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/admin/login",
]);

/**
 * Public prefixes under /admin — the magic-link callback must be reachable
 * cookie-less (the code exchange CREATES the session).
 */
export const ADMIN_PUBLIC_PREFIXES: readonly string[] = ["/admin/auth/"];

/**
 * Operator-internal /admin paths that pre-date the client dashboard arc.
 * Session-required but NOT client-scoped — the proxy skips the
 * client_users membership check for these.
 */
export const OPERATOR_ADMIN_PREFIXES: readonly string[] = [
  "/admin/render-test",
  "/admin/render-reel",
  "/admin/cron-health",
];

/** True for anything under /admin (including /admin itself). */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/** True for /admin paths that must bypass the session check entirely. */
export function isAdminPublicPath(pathname: string): boolean {
  if (ADMIN_PUBLIC_PATHS.has(pathname)) return true;
  return ADMIN_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** True for the pre-existing operator pages (session-only, no membership). */
export function isOperatorAdminPath(pathname: string): boolean {
  return OPERATOR_ADMIN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Extract the client slug from a client-dashboard path:
 *   "/admin/gmc-worldwide-productions/pages" → "gmc-worldwide-productions"
 *   "/admin" → null (bare index — proxy redirects to the member's slug)
 * Callers must have already excluded public + operator paths.
 */
export function adminClientSlugFromPath(pathname: string): string | null {
  if (!isAdminPath(pathname)) return null;
  const segments = pathname.split("/").filter(Boolean);
  // segments[0] === "admin"
  return segments.length >= 2 ? segments[1] : null;
}
