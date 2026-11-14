/**
 * lib/cirqlin/page-signups.ts
 *
 * Registrations by the linked CIRQLIN page (dashboard v2, HN2): the page id
 * on the event (events.cirqlin_page_id) first, the Mailchimp tag only as a
 * fallback. #1225 found Schak's 1,792 signups reading 0 because v2 synced
 * by tag and Schak has no tag.
 *
 * Contract (cirqlin, being built by Cursor on 14 Nov):
 *   GET {CIRQLIN_API_BASE}/api/partner/signups?page_id={uuid}[&from=&to=]
 *   200 → { page_id, daily_timezone, days: [{ date, signups }], total }
 *   404 no_page · 400 ambiguous_key / bad_range / missing_tag · 401 · 429
 * Until it is deployed the page-id call answers 400 missing_tag: that reads
 * as "unsupported", and the sync falls back to the tag.
 *
 * Counts only; no PII crosses. The daily counts are cached in
 * signup_source_snapshots by the EOD cron. A dashboard render never calls
 * CIRQLIN. A failed lookup writes nothing: never a 0.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { CIRQLIN_DEFAULT_API_BASE, CIRQLIN_FETCH_TIMEOUT_MS } from "./client.ts";

export interface CirqlinPagePayload {
  page_id: string;
  daily_timezone: string;
  days: { date: string; signups: number }[];
  total: number;
}

export type CirqlinPageFetchReason =
  | "not_configured"
  | "unsupported"
  | "no_page"
  | "ambiguous_key"
  | "bad_range"
  | "unauthorized"
  | "rate_limited"
  | "error";

export type CirqlinPageFetchResult =
  | { ok: true; payload: CirqlinPagePayload }
  | { ok: false; reason: CirqlinPageFetchReason; status?: number; message?: string };

/** A lookup that the tag path can stand in for. 401 and 429 would fail the tag call too. */
export function fallsBackToTag(reason: CirqlinPageFetchReason): boolean {
  return reason === "unsupported" || reason === "no_page" || reason === "ambiguous_key" || reason === "bad_range" || reason === "error";
}

export function isCirqlinPagePayload(value: unknown): value is CirqlinPagePayload {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.page_id !== "string" || typeof v.daily_timezone !== "string") return false;
  if (!Number.isFinite(v.total)) return false;
  if (!Array.isArray(v.days)) return false;
  return v.days.every((d) => {
    if (d == null || typeof d !== "object") return false;
    const row = d as Record<string, unknown>;
    return typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.signups);
  });
}

/** The error word in a 400/404 body ({ error: "missing_tag" } or { reason: … }). */
function errorWord(body: unknown): string | null {
  if (body == null || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;
  const w = typeof r.error === "string" ? r.error : typeof r.reason === "string" ? r.reason : typeof r.code === "string" ? r.code : null;
  return w;
}

export function classifyPageResponse(status: number, body: unknown): CirqlinPageFetchResult {
  if (status === 200 && isCirqlinPagePayload(body)) return { ok: true, payload: body };
  if (status === 401) return { ok: false, reason: "unauthorized", status };
  if (status === 429) return { ok: false, reason: "rate_limited", status };
  const word = errorWord(body);
  if (status === 404) return { ok: false, reason: "no_page", status, message: word ?? undefined };
  if (status === 400) {
    if (word === "missing_tag") return { ok: false, reason: "unsupported", status, message: word };
    if (word === "ambiguous_key") return { ok: false, reason: "ambiguous_key", status, message: word };
    if (word === "bad_range") return { ok: false, reason: "bad_range", status, message: word };
    return { ok: false, reason: "error", status, message: word ?? "bad request" };
  }
  return { ok: false, reason: "error", status, message: status === 200 ? "response did not match the page payload shape" : `unexpected status ${status}` };
}

/** Never throws. */
export async function fetchCirqlinSignupsByPage(
  pageId: string,
  opts: { from?: string; to?: string; base?: string; secret?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<CirqlinPageFetchResult> {
  const id = pageId.trim();
  if (!id) return { ok: false, reason: "no_page", message: "empty page id" };
  const secret = (opts.secret ?? process.env.CIRQLIN_PARTNER_READ_SECRET ?? "").trim();
  if (!secret) return { ok: false, reason: "not_configured" };
  const base = (opts.base ?? process.env.CIRQLIN_API_BASE ?? CIRQLIN_DEFAULT_API_BASE).replace(/\/+$/, "");
  const url = new URL("/api/partner/signups", base);
  url.searchParams.set("page_id", id);
  if (opts.from) url.searchParams.set("from", opts.from);
  if (opts.to) url.searchParams.set("to", opts.to);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Cirqlin fetch timed out")), opts.timeoutMs ?? CIRQLIN_FETCH_TIMEOUT_MS);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return classifyPageResponse(res.status, body);
  } catch (err) {
    return { ok: false, reason: "error", message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** The signup_source_snapshots rows for one page payload (source "cirqlin", one per day). */
export function pageSnapshotRows(eventId: string, payload: CirqlinPagePayload, capturedAt: string) {
  return payload.days.map((d) => ({
    event_id: eventId,
    source: "cirqlin" as const,
    day: d.date,
    signups_day: d.signups,
    signups_total: payload.total,
    raw_json: { via: "page_id", page_id: payload.page_id, daily_timezone: payload.daily_timezone, total: payload.total, day: d.date, signups_day: d.signups },
    snapshot_at: capturedAt,
  }));
}
