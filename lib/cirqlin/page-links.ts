/**
 * CIRQLIN's partner read of a show's links: GET /api/partner/page-links?crm_base_tag={tag}
 * (cirqlin#653). Every published page for the tag, event pages and crowd
 * pages alike, each with its landing_url and the ticket links its public
 * page renders (platform, url, label, shop_name, shown_first). URLs only,
 * no fan data.
 *
 * Bearer `CIRQLIN_PARTNER_READ_SECRET`, base `CIRQLIN_API_BASE` (default
 * https://app.cirqlin.com), as the signups read. Never throws: a missing
 * secret, a page that isn't published (404 no_page) or any failure come
 * back as `{ ok: false, reason }`. The secret is never logged.
 *
 * Retargeting RT13 (docs/design-record/2026-11-17-retargeting-campaign-2.html).
 */

import { CIRQLIN_DEFAULT_API_BASE, CIRQLIN_FETCH_TIMEOUT_MS } from "./client.ts";

export type PartnerTicketLink = { platform: string; url: string; label: string; shop_name: string | null; shown_first: boolean };
export type PartnerPageLinks = { page_id: string; slug: string; crm_base_tag: string | null; title: string; landing_url: string; ticket_links: PartnerTicketLink[] };

export type PageLinksResult =
  | { ok: true; pages: PartnerPageLinks[] }
  | { ok: false; reason: "no_page" }
  | { ok: false; reason: "not_configured" | "unauthorized" | "rate_limited" | "bad_request" | "read_failed" | "bad_payload" | "network"; status?: number; message?: string };

function isLink(value: unknown): value is PartnerTicketLink {
  const row = value as PartnerTicketLink | null;
  return Boolean(row) && typeof row!.platform === "string" && typeof row!.url === "string" && typeof row!.label === "string" && (row!.shop_name === null || typeof row!.shop_name === "string") && typeof row!.shown_first === "boolean";
}

export function isPageLinksPayload(body: unknown): body is { pages: PartnerPageLinks[] } {
  const pages = (body as { pages?: unknown } | null)?.pages;
  return (
    Array.isArray(pages) &&
    pages.every((page) => {
      const row = page as PartnerPageLinks | null;
      return Boolean(row) && typeof row!.page_id === "string" && typeof row!.landing_url === "string" && Array.isArray(row!.ticket_links) && row!.ticket_links.every(isLink);
    })
  );
}

export async function fetchCirqlinPageLinks(tag: string, opts?: { base?: string; secret?: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<PageLinksResult> {
  const trimmed = tag.trim();
  if (!trimmed) return { ok: false, reason: "no_page" };
  const secret = (opts?.secret ?? process.env.CIRQLIN_PARTNER_READ_SECRET ?? "").trim();
  if (!secret) return { ok: false, reason: "not_configured" };
  const base = (opts?.base ?? process.env.CIRQLIN_API_BASE ?? CIRQLIN_DEFAULT_API_BASE).replace(/\/+$/, "");
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Cirqlin fetch timed out")), opts?.timeoutMs ?? CIRQLIN_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${base}/api/partner/page-links?${new URLSearchParams({ crm_base_tag: trimmed }).toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (res.status === 404) return { ok: false, reason: "no_page" };
    if (res.status === 401) return { ok: false, reason: "unauthorized", status: 401 };
    if (res.status === 429) return { ok: false, reason: "rate_limited", status: 429 };
    if (res.status === 400) return { ok: false, reason: "bad_request", status: 400 };
    if (!res.ok) return { ok: false, reason: "read_failed", status: res.status };
    const body = (await res.json()) as unknown;
    if (!isPageLinksPayload(body)) return { ok: false, reason: "bad_payload", status: res.status };
    return { ok: true, pages: body.pages };
  } catch (err) {
    return { ok: false, reason: "network", message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
