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
  // `/j/{invite}` — public WhatsApp community redirect clicked from Bird
  // WhatsApp template buttons (Meta subcode 2388081 fix). Validates the
  // invite code itself before redirecting; carries no user data.
  "/j/",
  // `/l/{clientSlug}/{eventSlug}` — public event landing pages (migration
  // 132, landing-page arc PR 1). The route resolves the slug chain via the
  // service-role client and 404s on any unknown link in the chain; only
  // public-safe display fields are ever selected (see
  // lib/db/landing-pages.ts). Trailing slash matters — a bare "/l" prefix
  // would also match /login.
  "/l/",
];

/**
 * Thumbnail proxy routes enforce their own auth (share_token or session +
 * client_id) inside the handler — middleware must not redirect unauthenticated
 * `<img src>` requests to /login before that logic runs.
 */
const PUBLIC_API_ROUTES: readonly string[] = [
  "/api/proxy/creative-thumbnail",
  "/api/meta/thumbnail-proxy",
];

/**
 * Meta thumbnail proxy with `share_token` must bypass cookie middleware so
 * `<img src>` on public share pages can load (same pattern as `/api/share/*`).
 */
function isPublicApiRoute(pathname: string): boolean {
  return PUBLIC_API_ROUTES.some((route) => pathname === route);
}

export function isPublicPath(
  pathname: string,
  _searchParams?: URLSearchParams,
): boolean {
  // `/api/admin/mailchimp-overlap` — one-shot admin endpoint for Mailchimp
  // tag-overlap analysis. Bearer CRON_SECRET only; the route's own
  // isAuthorized check enforces auth. Without this carve-out the proxy
  // 307s to /login before the handler runs (same lesson as PR #407 etc.).
  if (pathname === "/api/admin/mailchimp-overlap") return true;
  // `/api/admin/meta-enhancement-probe` validates CRON_SECRET or session in
  // the route — bearer-only curls must reach the handler (see probe doc).
  if (pathname === "/api/admin/meta-enhancement-probe") return true;
  // `/api/admin/rollup-pre-pr395-backfill` — one-shot admin backfill triggered
  // manually via Bearer CRON_SECRET; must bypass the session middleware so the
  // route's own isCronAuthorized check can run (same pattern as probe above).
  if (pathname === "/api/admin/rollup-pre-pr395-backfill") return true;
  // `/api/admin/event-code-lifetime-meta-backfill` — Admin Bearer-authed route;
  // the route's own isCronAuthorized handles auth. Bypass the session
  // middleware so a bearer-only curl reaches the handler (same pattern as
  // PR #407 + PR #411).
  if (pathname === "/api/admin/event-code-lifetime-meta-backfill") return true;
  // `/api/admin/rollup-canonical-clicks-lpv-backfill` — one-shot PR-A backfill;
  // Bearer CRON_SECRET only (route's own isCronAuthorized). Same pattern as
  // event-code-lifetime-meta-backfill above — without this carve-out the
  // proxy redirects bearer-only curls to /login before the handler runs.
  if (pathname === "/api/admin/rollup-canonical-clicks-lpv-backfill") return true;
  // `/api/admin/rollup-engagement-fanout-collapse` — one-shot PR-A.5 backfill
  // (issue #471). Reshapes per-fixture rollup rows so engagement columns
  // collapse to one row per (event_code, date) instead of N× fanout. Bearer
  // CRON_SECRET only; same lesson from PR #470 — without this carve-out the
  // proxy 307s the bearer-only curl to /login before isCronAuthorized runs.
  if (pathname === "/api/admin/rollup-engagement-fanout-collapse") return true;
  // `/api/admin/event-rollup-backfill` — per-event owner-session backfill plus
  // `?force=true` 4theFans-wide sync (Bearer CRON_SECRET). Same carve-out
  // pattern as rollup-pre-pr395-backfill; without it force=true curls 307 to
  // /login before fourthefansForceBackfill / isCronAuthorized runs.
  if (pathname === "/api/admin/event-rollup-backfill") return true;
  // `/api/admin/event-legacy-spend-backfill` — one-shot historical backfill for
  // paused legacy campaigns whose spend pre-dates the 60-day live-cron window.
  // event_id mode validates a user session inside the route; client_id mode
  // requires Bearer CRON_SECRET. Without this carve-out the proxy 307s
  // bearer-only curls to /login before isCronAuthorized runs (PR #479 lesson).
  if (pathname === "/api/admin/event-legacy-spend-backfill") return true;
  // `/api/admin/event-presale-backfill` — one-shot historical presale rebalance
  // (PR #499 Stage B). Re-runs the venue allocator with an explicit historical
  // `since` to reach the Jan–Apr 2026 presale windows the 60-day live cron
  // cannot. Bearer CRON_SECRET only (route's own isCronAuthorized). Without this
  // carve-out the proxy 307s the bearer-only curl to /login (PR #479 lesson).
  // NOTE: the route itself shipped to main early via PR #578; this carve-out is
  // what actually makes it reachable.
  if (pathname === "/api/admin/event-presale-backfill") return true;
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
  // `/api/events/{id}/mailchimp/refresh` — accepts EITHER a Supabase session
  // cookie (in-app "Sync now" button) OR a `Bearer CRON_SECRET` header (ops
  // batch scripts). The route's own auth enforces both paths; without this
  // carve-out the proxy 307s bearer-only curls to /login before the handler
  // ever sees the Authorization header.
  if (/^\/api\/events\/[^/]+\/mailchimp\/refresh$/.test(pathname)) {
    return true;
  }
  // `/api/events/{id}/meta/resolve-campaign-id` — same dual-auth pattern as
  // /mailchimp/refresh (PR #611). Ops scripts call it with Bearer CRON_SECRET
  // to backfill events.meta_campaign_id; without this carve-out the proxy
  // 307s the curl to /login before the handler's isCronAuthed check runs.
  if (/^\/api\/events\/[^/]+\/meta\/resolve-campaign-id$/.test(pathname)) {
    return true;
  }
  // `/api/events/{id}/rollup/sync` — per-event rollup sync (ops escape hatch
  // when the bulk cron times out). Same dual-auth pattern as the above.
  if (/^\/api\/events\/[^/]+\/rollup\/sync$/.test(pathname)) {
    return true;
  }
  // `/api/events/{id}/mailchimp/tag-backfill/start` and `/status` — resumable
  // historical backfill control (bulletproof tag-tracking architecture).
  // Dual-auth (Bearer CRON_SECRET or session) enforced in the handlers.
  if (/^\/api\/events\/[^/]+\/mailchimp\/tag-backfill\/(start|status)$/.test(pathname)) {
    return true;
  }
  // `/api/webhooks/mailchimp/{clientId}/{audienceId}` — Mailchimp tag webhook
  // receiver. Authenticates via URL secret / HMAC in the handler, so it must
  // bypass the session proxy entirely.
  if (/^\/api\/webhooks\/mailchimp\/[^/]+\/[^/]+$/.test(pathname)) {
    return true;
  }
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Magic link callback, logout route, future OAuth callbacks
  if (pathname.startsWith("/auth/")) return true;
  if (isPublicApiRoute(pathname)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}
