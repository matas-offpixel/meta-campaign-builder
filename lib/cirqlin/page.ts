/**
 * lib/cirqlin/page.ts
 *
 * CIRQLIN's GET /api/partner/page (cirqlin #625): the page behind a pasted
 * link (?url=) or a stored page id (?id=). Bearer CIRQLIN_PARTNER_READ_SECRET,
 * base CIRQLIN_API_BASE (default https://app.cirqlin.com), no-store.
 *
 * The endpoint's rate limit (60 per 10 minutes per IP) is SHARED with the
 * signups read the cron makes, so only two callers may use this: the event
 * config save action (?url=, once per save that changes the link) and the
 * edit page's refresh (?id=, at most once per load, one event). Dashboards
 * and share pages read the cached title and slug on the events row. A guard
 * test holds that.
 *
 * Never throws and never logs: the secret goes into the Authorization header
 * and nowhere else, and a failure is a reason, not a message with the request
 * in it.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { CIRQLIN_DEFAULT_API_BASE, CIRQLIN_FETCH_TIMEOUT_MS } from "./client.ts";

export const CIRQLIN_PAGE_PATH = "/api/partner/page";

export interface CirqlinPageRef {
  id: string;
  slug: string;
  title: string;
  customDomain: string | null;
}

export type CirqlinPageFailure =
  /** 404: a draft, unpublished or unknown page, or a link that isn't a page. */
  | "no_page"
  /** 401, or no secret configured here. */
  | "unauthorized"
  /** 429: the budget shared with the signups read is spent. */
  | "rate_limited"
  /** 500, 400, an unexpected status or body, a timeout or a network failure. */
  | "read_failed";

export type CirqlinPageLookup = { ok: true; page: CirqlinPageRef } | { ok: false; reason: CirqlinPageFailure; status?: number };

export type CirqlinPageQuery = { url: string } | { id: string };

export interface CirqlinPageOptions {
  fetchImpl?: typeof fetch;
  secret?: string;
  base?: string;
  timeoutMs?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function cirqlinPageUrl(base: string, query: CirqlinPageQuery): string {
  const url = new URL(CIRQLIN_PAGE_PATH, base);
  if ("url" in query) url.searchParams.set("url", query.url.trim());
  else url.searchParams.set("id", query.id.trim().toLowerCase());
  return url.toString();
}

function pageFrom(body: unknown): CirqlinPageRef | null {
  if (body == null || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || !UUID.test(b.id.toLowerCase())) return null;
  if (typeof b.slug !== "string" || !b.slug) return null;
  if (typeof b.title !== "string") return null;
  const customDomain = typeof b.custom_domain === "string" && b.custom_domain ? b.custom_domain : null;
  return { id: b.id.toLowerCase(), slug: b.slug, title: b.title, customDomain };
}

/** The shipped error bodies are { error: "unauthorized" | "no_page" | "rate_limited" | "read_failed" | "bad_request" }. */
const ERROR_CODES: Record<string, CirqlinPageFailure> = {
  no_page: "no_page",
  unauthorized: "unauthorized",
  rate_limited: "rate_limited",
  read_failed: "read_failed",
  bad_request: "read_failed",
};

/** Match on the body's `error`; the status only when the body has none we know. */
function failureFor(status: number, body: unknown): CirqlinPageFailure {
  const code = body != null && typeof body === "object" ? (body as Record<string, unknown>).error : undefined;
  if (typeof code === "string" && Object.hasOwn(ERROR_CODES, code)) return ERROR_CODES[code]!;
  if (status === 404) return "no_page";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  return "read_failed";
}

export async function lookupCirqlinPage(query: CirqlinPageQuery, opts: CirqlinPageOptions = {}): Promise<CirqlinPageLookup> {
  const secret = (opts.secret ?? process.env.CIRQLIN_PARTNER_READ_SECRET ?? "").trim();
  if (!secret) return { ok: false, reason: "unauthorized" };
  const base = (opts.base ?? process.env.CIRQLIN_API_BASE ?? "").trim() || CIRQLIN_DEFAULT_API_BASE;
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(cirqlinPageUrl(base, query), {
      method: "GET",
      cache: "no-store",
      headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? CIRQLIN_FETCH_TIMEOUT_MS),
    });
    const body: unknown = await res.json().catch(() => null);
    if (res.status !== 200) return { ok: false, reason: failureFor(res.status, body), status: res.status };
    const page = pageFrom(body);
    return page ? { ok: true, page } : { ok: false, reason: "read_failed", status: 200 };
  } catch {
    return { ok: false, reason: "read_failed" };
  }
}
