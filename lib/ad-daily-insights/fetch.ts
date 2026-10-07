/**
 * Paged GET /act_{id}/insights at level=ad, time_increment=1, spend > 0.
 *
 * Every Graph request is counted — this job must not become another
 * thumbnail-fetch rate-limit hit. The injected getter must not retry on
 * its own (route passes maxAttempts: 1), so `calls` is the true cost. A
 * rate-limit or auth error stops the account; the caller moves on.
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
  return err instanceof Error ? err.message : String(err);
}

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
      return { status: "error", calls, pages, rows, error: errorText(err) };
    }
    pages++;
    rows.push(...(page.data ?? []));
    after = page.paging?.next ? page.paging.cursors?.after : undefined;
    if (!after) return { status: "ok", calls, pages, rows };
  }
  return { status: "error", calls, pages, rows, error: `stopped at ${AD_INSIGHTS_MAX_PAGES} pages` };
}
