/**
 * lib/auth/api-access.ts
 *
 * Who may call `/api/*` once signed in. Pure string logic plus the
 * operator allowlist — node:test friendly, no `@/` imports.
 *
 * Every signed-in user holds an ordinary Supabase session, including a
 * `client_users` member who signed in through `/admin/login`. Before this
 * gate the proxy let any session through every `/api` route, and most
 * routes only compared a row's `user_id` with the caller — which a member
 * can satisfy with rows they insert themselves. So the proxy now refuses a
 * signed-in non-operator on `/api/*` with 403, before any route runs,
 * unless the path is on `NON_OPERATOR_API_ALLOWLIST` below.
 *
 * A new route is operator-only by default. Adding it here is a deliberate,
 * reviewed choice: say why a non-operator needs it and what guards it.
 *
 * Requests with no session are unchanged: `isPublicPath` decides whether
 * they reach the route (cron bearer calls, share links, webhooks) or are
 * redirected to /login.
 */

import { isOperator } from "./operator-allowlist.ts";

export interface NonOperatorApiEntry {
  /** Path prefix (ends in "/") or a pattern for one exact route shape. */
  match: string | RegExp;
  reason: string;
}

/**
 * The only `/api` paths a signed-in non-operator may reach. Each route
 * here guards itself without relying on who the session belongs to.
 *
 * Not here on purpose: the client dashboard (`/admin/[clientSlug]`). It
 * calls no `/api` route — its reads and writes are server actions under
 * `requireClientContext()` (`lib/actions/*`). A test walks that page tree
 * and fails if an `/api` call appears there that this list doesn't allow.
 */
export const NON_OPERATOR_API_ALLOWLIST: readonly NonOperatorApiEntry[] = [
  {
    match: "/api/cron/",
    reason:
      "Vercel cron. Each route checks Authorization: Bearer CRON_SECRET itself and returns 401 without it; a session adds nothing.",
  },
  {
    match: "/api/share/",
    reason:
      "Public share links (report, client portal, venue, D2C, plan). Each route resolves an unguessable share token with the service role; a signed-in viewer is treated like an anonymous one.",
  },
  {
    match: "/api/events/by-share-token/",
    reason: "Event share additional-spend edits. Share token (and can_edit) checked in the route.",
  },
  {
    match: "/api/venues/by-share-token/",
    reason: "Venue share additional-spend edits. Share token (and can_edit) checked in the route.",
  },
  {
    match: "/api/ticketing/rollup-sync/by-share-token/",
    reason: "Share-page refresh of one shared event's rollup. Share token checked in the route.",
  },
  {
    match: "/api/l/",
    reason:
      "Public event landing pages (signup, view). Fans have no session; rate limit, schema, Turnstile and slug-chain checks in the route.",
  },
  {
    match: /^\/api\/community-aliases\/[^/]+$/,
    reason: "Public WhatsApp community redirect lookup; carries no user data.",
  },
  {
    match: /^\/api\/webhooks\/mailchimp\/[^/]+\/[^/]+$/,
    reason:
      "Mailchimp webhook. MAILCHIMP_WEBHOOK_SECRET (?secret=, Bearer or HMAC), timing-safe, fails closed when unset.",
  },
  {
    match: /^\/api\/webhooks\/ticketing\/[^/]+$/,
    reason:
      "Ticketing provider webhook. HMAC of the raw body (fourthefans), fails closed: 503 when the secret is unset, 401 on a bad signature, 404 for any other provider.",
  },
  {
    match: /^\/api\/(proxy\/creative-thumbnail|meta\/thumbnail-proxy)$/,
    reason:
      "Thumbnail images on public share pages (<img src>). Read-only; share_token or session + client checked in the route.",
  },
];

function matches(entry: NonOperatorApiEntry, pathname: string): boolean {
  return typeof entry.match === "string"
    ? pathname.startsWith(entry.match)
    : entry.match.test(pathname);
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** The allowlist entry that lets a non-operator through, or null. */
export function nonOperatorApiEntry(pathname: string): NonOperatorApiEntry | null {
  return NON_OPERATOR_API_ALLOWLIST.find((e) => matches(e, pathname)) ?? null;
}

export type ApiAccess = "pass" | "operator_required";

/**
 * The proxy's decision for a signed-in user on an `/api` path. Paths
 * outside `/api` and requests with no session are not decided here.
 */
export function apiAccessForSignedInUser(pathname: string, userId: string): ApiAccess {
  if (!isApiPath(pathname)) return "pass";
  if (isOperator(userId)) return "pass";
  return nonOperatorApiEntry(pathname) ? "pass" : "operator_required";
}

/** Body of the 403, the same text `requireOperator()` returns. */
export const OPERATOR_REQUIRED_BODY = { ok: false, error: "Operator access required" } as const;
