/**
 * lib/cirqlin/page-audience/client.ts
 *
 * CIRQLIN's GET /api/partner/page-audience (cirqlin #631, #633): counted
 * audience totals for one published page.
 *
 *   GET {CIRQLIN_API_BASE}/api/partner/page-audience?page_id={uuid}[&from=&to=]
 *   200 → { page_id, signups, geography { cities, everywhere_else,
 *           couldnt_tell }, consent { marketing, channels_offered },
 *           community_joined, community_link_clicks, community_code_shared,
 *           whatsapp_with_phone, partner_opt_in, partner_box_offered,
 *           daily_timezone }
 *   404 no_page · 400 bad_page_id / bad_date · 401 · 429 rate_limited · 500
 *
 * Same bearer (CIRQLIN_PARTNER_READ_SECRET) and base (CIRQLIN_API_BASE) as
 * the signups read, and the same rate-limit bucket: 60 calls per 10 minutes
 * per IP, shared by both endpoints. `from` / `to` are inclusive days in the
 * page's timezone; both omitted is all time, which is what the cron asks.
 *
 * Only the listed keys are kept: anything else in the body is dropped, so a
 * key CIRQLIN adds later never reaches the table. A city keeps its name,
 * region, country and count (CIRQLIN names a city only at 10 or more
 * signups). A body whose cities + everywhere_else + couldnt_tell isn't
 * signups is rejected, not stored.
 *
 * partner_box_offered (#633) is today's live form: true when it shows at
 * least one partner consent tick box. `from` / `to` don't change it. A
 * non-boolean is rejected; a body without the key (before #633) keeps null,
 * so the panel falls back to PB3's interim rule rather than guessing.
 *
 * Never throws and never logs: the secret goes in the Authorization header
 * and nowhere else.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { CIRQLIN_DEFAULT_API_BASE, CIRQLIN_FETCH_TIMEOUT_MS } from "../client.ts";

export const CIRQLIN_PAGE_AUDIENCE_PATH = "/api/partner/page-audience";

export interface PageAudienceCity {
  name: string;
  region: string | null;
  country: string | null;
  signups: number;
}

export interface PageAudience {
  page_id: string;
  signups: number;
  geography: { cities: PageAudienceCity[]; everywhere_else: number; couldnt_tell: number };
  consent: { marketing: number; channels_offered: string[] };
  community_joined: number;
  community_link_clicks: number;
  community_code_shared: boolean;
  whatsapp_with_phone: number;
  partner_opt_in: number;
  /** null: the body had no key (before cirqlin #633). */
  partner_box_offered: boolean | null;
  daily_timezone: string;
}

export type PageAudienceFailure =
  /** No secret here: no call was made. */
  | "not_configured"
  /** 401. */
  | "unauthorized"
  /** 404: a draft, unpublished or unknown page. */
  | "no_page"
  /** 400 bad_page_id / bad_date. */
  | "bad_request"
  /** 429: the bucket shared with the signups read is spent. */
  | "rate_limited"
  /** 200 whose cities + everywhere_else + couldnt_tell ≠ signups. */
  | "geography_mismatch"
  /** 200 that isn't the shape above. */
  | "bad_shape"
  /** 500, another status, a timeout or a network failure. */
  | "read_failed";

export type PageAudienceResult =
  | { ok: true; audience: PageAudience }
  | { ok: false; reason: PageAudienceFailure; status?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isObject = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
const textOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function cityFrom(v: unknown): PageAudienceCity | null {
  if (!isObject(v)) return null;
  if (typeof v.name !== "string" || !v.name.trim() || !isCount(v.signups)) return null;
  return { name: v.name.trim(), region: textOrNull(v.region), country: textOrNull(v.country), signups: v.signups };
}

/**
 * The listed keys of a 200 body, or why it can't be stored. Extra keys are
 * dropped here and nowhere else.
 */
export function parsePageAudience(body: unknown): { ok: true; audience: PageAudience } | { ok: false; reason: "bad_shape" | "geography_mismatch" } {
  if (!isObject(body)) return { ok: false, reason: "bad_shape" };
  const pageId = typeof body.page_id === "string" ? body.page_id.trim().toLowerCase() : "";
  if (!UUID.test(pageId)) return { ok: false, reason: "bad_shape" };
  const geo = body.geography;
  const consent = body.consent;
  if (!isObject(geo) || !isObject(consent)) return { ok: false, reason: "bad_shape" };
  if (!Array.isArray(geo.cities) || !isCount(geo.everywhere_else) || !isCount(geo.couldnt_tell)) return { ok: false, reason: "bad_shape" };
  const cities: PageAudienceCity[] = [];
  for (const raw of geo.cities) {
    const city = cityFrom(raw);
    if (!city) return { ok: false, reason: "bad_shape" };
    cities.push(city);
  }
  if (!isCount(consent.marketing) || !Array.isArray(consent.channels_offered) || !consent.channels_offered.every((c) => typeof c === "string")) {
    return { ok: false, reason: "bad_shape" };
  }
  const counts = [body.signups, body.community_joined, body.community_link_clicks, body.whatsapp_with_phone, body.partner_opt_in];
  if (!counts.every(isCount)) return { ok: false, reason: "bad_shape" };
  if (typeof body.community_code_shared !== "boolean") return { ok: false, reason: "bad_shape" };
  if (body.partner_box_offered !== undefined && typeof body.partner_box_offered !== "boolean") return { ok: false, reason: "bad_shape" };
  if (typeof body.daily_timezone !== "string" || !body.daily_timezone.trim()) return { ok: false, reason: "bad_shape" };

  const signups = body.signups as number;
  const named = cities.reduce((n, c) => n + c.signups, 0);
  if (named + geo.everywhere_else + geo.couldnt_tell !== signups) return { ok: false, reason: "geography_mismatch" };

  return {
    ok: true,
    audience: {
      page_id: pageId,
      signups,
      geography: { cities, everywhere_else: geo.everywhere_else, couldnt_tell: geo.couldnt_tell },
      consent: { marketing: consent.marketing, channels_offered: [...(consent.channels_offered as string[])] },
      community_joined: body.community_joined as number,
      community_link_clicks: body.community_link_clicks as number,
      community_code_shared: body.community_code_shared,
      whatsapp_with_phone: body.whatsapp_with_phone as number,
      partner_opt_in: body.partner_opt_in as number,
      partner_box_offered: typeof body.partner_box_offered === "boolean" ? body.partner_box_offered : null,
      daily_timezone: body.daily_timezone.trim(),
    },
  };
}

export function classifyPageAudienceResponse(status: number, body: unknown, pageId: string): PageAudienceResult {
  if (status === 200) {
    const parsed = parsePageAudience(body);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, status };
    // A body for another page is not this page's figures.
    if (parsed.audience.page_id !== pageId) return { ok: false, reason: "bad_shape", status };
    return parsed;
  }
  if (status === 401) return { ok: false, reason: "unauthorized", status };
  if (status === 404) return { ok: false, reason: "no_page", status };
  if (status === 400) return { ok: false, reason: "bad_request", status };
  if (status === 429) return { ok: false, reason: "rate_limited", status };
  return { ok: false, reason: "read_failed", status };
}

export function pageAudienceUrl(base: string, pageId: string, range?: { from?: string; to?: string }): string {
  const url = new URL(CIRQLIN_PAGE_AUDIENCE_PATH, base);
  url.searchParams.set("page_id", pageId);
  if (range?.from) url.searchParams.set("from", range.from);
  if (range?.to) url.searchParams.set("to", range.to);
  return url.toString();
}

/**
 * One page's audience. `called` says whether a request went out, so the
 * cron can count it against the shared bucket. Never throws.
 */
export async function fetchCirqlinPageAudience(
  pageId: string,
  opts: { from?: string; to?: string; base?: string; secret?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<PageAudienceResult & { called: boolean }> {
  const id = pageId.trim().toLowerCase();
  if (!UUID.test(id)) return { ok: false, reason: "bad_request", called: false };
  const secret = (opts.secret ?? process.env.CIRQLIN_PARTNER_READ_SECRET ?? "").trim();
  if (!secret) return { ok: false, reason: "not_configured", called: false };
  const base = ((opts.base ?? process.env.CIRQLIN_API_BASE ?? "").trim() || CIRQLIN_DEFAULT_API_BASE).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Cirqlin fetch timed out")), opts.timeoutMs ?? CIRQLIN_FETCH_TIMEOUT_MS);
  try {
    const res = await (opts.fetchImpl ?? fetch)(pageAudienceUrl(base, id, opts), {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: `Bearer ${secret}`, accept: "application/json" },
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ...classifyPageAudienceResponse(res.status, body, id), called: true };
  } catch {
    return { ok: false, reason: "read_failed", called: true };
  } finally {
    clearTimeout(timer);
  }
}
