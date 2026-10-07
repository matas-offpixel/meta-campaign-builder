/**
 * Paged GET /act_{id}/insights at level=ad, time_increment=1, spend > 0.
 *
 * Every Graph request is counted — this job must not become another
 * thumbnail-fetch rate-limit hit. The injected getter must not retry on
 * its own (route passes maxAttempts: 1), so `calls` is the true cost. A
 * rate-limit or auth error stops the account; the caller moves on.
 *
 * `fetchAdAccountInsightsAdaptive` is the entry point for the cron and the
 * backfill. Some accounts fail a multi-day window with Meta code 1/2 while
 * a single day succeeds, so a span that fails that way is split
 * (7 → 3 → 1 days) and each smaller span tried once. A span's rows are
 * handed to the caller only after every page of it has been read.
 */

import { isReduceDataError } from "../meta/error-classify.ts";
import { classifyLaunchMetaCode } from "../meta/launch-error-classify.ts";
import { AD_DAILY_INSIGHTS_FIELDS, type MetaAdInsightRow } from "./derive.ts";

/** Same windows as event_daily_rollups, so campaign SUMs reconcile. */
export const AD_INSIGHTS_ATTRIBUTION_WINDOWS = ["7d_click", "1d_view"] as const;

export const AD_INSIGHTS_PAGE_LIMITS = [500, 100, 25] as const;
export const AD_INSIGHTS_MAX_PAGES = 50;

export type GraphGet = (path: string, params: Record<string, string>) => Promise<unknown>;

export type AccountFetchStatus = "ok" | "rate_limited" | "auth_error" | "error";

export type AccountFetchResult = {
  status: AccountFetchStatus;
  calls: number;
  pages: number;
  rows: MetaAdInsightRow[];
  error?: string;
  /** A Meta failure a smaller window may avoid: code 1/2, or reduce-data at the smallest page. */
  splittable?: boolean;
};

type InsightsPage = {
  data?: MetaAdInsightRow[];
  paging?: { cursors?: { after?: string }; next?: string };
};

function errorCode(err: unknown): number | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : undefined;
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = errorCode(err);
  if (code === undefined) return message;
  const subcode = (err as { subcode?: unknown }).subcode;
  return `Meta code=${code}${typeof subcode === "number" ? ` subcode=${subcode}` : ""}: ${message}`;
}

/** Meta's generic "unknown error" (1) and "service temporarily unavailable" (2). */
const META_SPLITTABLE_CODES = new Set([1, 2]);

export function insightsParams(since: string, until: string, limit: number, after?: string): Record<string, string> {
  const params: Record<string, string> = {
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: AD_DAILY_INSIGHTS_FIELDS,
    filtering: JSON.stringify([{ field: "spend", operator: "GREATER_THAN", value: 0 }]),
    action_attribution_windows: JSON.stringify(AD_INSIGHTS_ATTRIBUTION_WINDOWS),
    limit: String(limit),
  };
  if (after) params.after = after;
  return params;
}

export async function fetchAdAccountInsights(
  graphGet: GraphGet,
  adAccountId: string,
  since: string,
  until: string,
): Promise<AccountFetchResult> {
  const rows: MetaAdInsightRow[] = [];
  let calls = 0;
  let pages = 0;
  let limitIndex = 0;
  let after: string | undefined;

  while (pages < AD_INSIGHTS_MAX_PAGES) {
    let page: InsightsPage;
    try {
      calls++;
      page = (await graphGet(
        `/${adAccountId}/insights`,
        insightsParams(since, until, AD_INSIGHTS_PAGE_LIMITS[limitIndex], after),
      )) as InsightsPage;
    } catch (err) {
      const kind = classifyLaunchMetaCode(errorCode(err));
      if (kind === "rate_limit") return { status: "rate_limited", calls, pages, rows, error: errorText(err) };
      if (kind === "auth") return { status: "auth_error", calls, pages, rows, error: errorText(err) };
      if (isReduceDataError(err) && limitIndex < AD_INSIGHTS_PAGE_LIMITS.length - 1) {
        limitIndex++;
        continue;
      }
      const splittable = isReduceDataError(err) || META_SPLITTABLE_CODES.has(errorCode(err) ?? -1);
      return { status: "error", calls, pages, rows, error: errorText(err), splittable };
    }
    pages++;
    rows.push(...(page.data ?? []));
    after = page.paging?.next ? page.paging.cursors?.after : undefined;
    if (!after) return { status: "ok", calls, pages, rows };
  }
  return { status: "error", calls, pages, rows, error: `stopped at ${AD_INSIGHTS_MAX_PAGES} pages` };
}

/** Span lengths tried in order. A failed span is retried once at each smaller size. */
export const AD_INSIGHTS_WINDOW_DAYS = [7, 3, 1] as const;

const DAY_MS = 86_400_000;

function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function spanDays(since: string, until: string): number {
  return Math.round((dayMs(until) - dayMs(since)) / DAY_MS) + 1;
}

/** `since..until` cut into consecutive spans of at most `days` days. */
export function insightsSpans(since: string, until: string, days: number): { since: string; until: string }[] {
  const out: { since: string; until: string }[] = [];
  const end = dayMs(until);
  for (let start = dayMs(since); start <= end; start += days * DAY_MS) {
    out.push({ since: dayOf(start), until: dayOf(Math.min(start + (days - 1) * DAY_MS, end)) });
  }
  return out;
}

export type InsightsSpan = { since: string; until: string; rows: MetaAdInsightRow[] };

export type AdaptiveFetchResult = {
  status: AccountFetchStatus | "write_error";
  calls: number;
  pages: number;
  /** Spans read in full and handed to `onSpan`. */
  spans: number;
  error?: string;
  /** Longest span that was split, and the smallest span size it was split to. */
  windowSplit: { from: number; to: number } | null;
};

/**
 * Read `since..until` in spans of at most 7 days. A splittable failure
 * splits the span into the next smaller size; a failure at one day stops
 * the account with `error`. Rate-limit, auth and other errors stop at once.
 * `onSpan` gets each complete span and returns a write error or `null`.
 * Rows of a span that failed part-way are dropped, never handed over.
 */
export async function fetchAdAccountInsightsAdaptive(
  graphGet: GraphGet,
  adAccountId: string,
  since: string,
  until: string,
  onSpan: (span: InsightsSpan) => Promise<string | null>,
): Promise<AdaptiveFetchResult> {
  const result: AdaptiveFetchResult = { status: "ok", calls: 0, pages: 0, spans: 0, windowSplit: null };
  let splitFrom = 0;
  let splitTo = Number.POSITIVE_INFINITY;

  const attempt = async (span: { since: string; until: string }): Promise<boolean> => {
    const length = spanDays(span.since, span.until);
    const fetched = await fetchAdAccountInsights(graphGet, adAccountId, span.since, span.until);
    result.calls += fetched.calls;
    result.pages += fetched.pages;
    if (fetched.status === "ok") {
      const writeError = await onSpan({ ...span, rows: fetched.rows });
      if (writeError) {
        result.status = "write_error";
        result.error = writeError;
        return false;
      }
      result.spans++;
      return true;
    }
    const next = AD_INSIGHTS_WINDOW_DAYS.find((days) => days < length);
    if (fetched.splittable && next !== undefined) {
      splitFrom = Math.max(splitFrom, length);
      splitTo = Math.min(splitTo, next);
      for (const part of insightsSpans(span.since, span.until, next)) {
        if (!(await attempt(part))) return false;
      }
      return true;
    }
    result.status = fetched.status;
    result.error = `${span.since}..${span.until}: ${fetched.error ?? "failed"}`;
    return false;
  };

  for (const span of insightsSpans(since, until, AD_INSIGHTS_WINDOW_DAYS[0])) {
    if (!(await attempt(span))) break;
  }
  if (splitFrom > 0) result.windowSplit = { from: splitFrom, to: splitTo };
  return result;
}
