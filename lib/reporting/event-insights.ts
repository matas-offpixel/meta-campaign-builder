import "server-only";

import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";

/**
 * lib/reporting/event-insights.ts
 *
 * Pulls Meta campaign-level insights for a given ad account, filtered
 * to the campaigns whose name contains a case-insensitive substring
 * (typically the event_code). Used by:
 *   - app/api/reporting/event-campaigns/route.ts → per-event panel
 *   - lib/reporting/rollup-server.ts             → cross-event rollup
 *
 * Extracted so the per-event route and the rollup share one Meta
 * fetch path. Two parallel implementations would be the start of
 * dashboard drift.
 *
 * Status / effective_status is best-effort — if the batch /campaigns
 * call fails we degrade to "UNKNOWN" rather than failing the whole
 * read.
 */

export interface CampaignInsightsRow {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  /** Percent (0–100). null when impressions = 0. */
  ctr: number | null;
  /** Account currency. null when impressions = 0. */
  cpm: number | null;
  /** Account currency. null when results = 0. */
  cpr: number | null;
  results: number;
  ad_account_id: string;
}

interface InsightsRow {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
}

interface InsightsResponse {
  data?: InsightsRow[];
  paging?: { cursors?: { after?: string }; next?: string };
}

interface CampaignMeta {
  status?: string;
  effective_status?: string;
}

const MAX_PAGES = 20;

const RESULT_ACTION_PRIORITY = [
  "offsite_conversion.fb_pixel_purchase",
  "purchase",
  "lead",
  "complete_registration",
  "onsite_conversion.lead_grouped",
  "landing_page_view",
  "link_click",
  "post_engagement",
];

function pickResults(row: InsightsRow): number {
  const actions = row.actions ?? [];
  for (const type of RESULT_ACTION_PRIORITY) {
    const match = actions.find((a) => a.action_type === type);
    if (match) {
      const v = Number.parseFloat(match.value ?? "");
      if (Number.isFinite(v)) return v;
    }
  }
  return 0;
}

/**
 * Normalise an ad account id so it always carries the `act_` prefix
 * Meta expects on /insights paths.
 */
export function normaliseAdAccountId(raw: string): string {
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

export interface FetchEventCampaignInsightsInput {
  adAccountId: string;
  /** Case-insensitive substring against `campaign_name`. */
  eventCode: string;
  token: string;
  window: { since: string; until: string };
}

/**
 * Fetch campaign-level insights for `adAccountId` in `window`, keep
 * only campaigns whose name contains `eventCode` (case-insensitive),
 * and resolve their `effective_status` in one batch call.
 *
 * Throws `MetaApiError` (or rethrows) on insights-fetch failure so
 * the caller can decide how to surface (the per-event route returns
 * a 502, the rollup degrades to "no data" for the offending event).
 */
export async function fetchEventCampaignInsights(
  input: FetchEventCampaignInsightsInput,
): Promise<CampaignInsightsRow[]> {
  const { token, window, eventCode } = input;
  const adAccountId = normaliseAdAccountId(input.adAccountId);
  const codeLower = eventCode.toLowerCase();

  const aggregates = new Map<
    string,
    {
      id: string;
      name: string;
      spend: number;
      impressions: number;
      clicks: number;
      results: number;
    }
  >();

  let after: string | undefined;
  let pageCount = 0;
  while (pageCount < MAX_PAGES) {
    const queryParams: Record<string, string> = {
      fields: "campaign_id,campaign_name,spend,impressions,clicks,actions",
      time_range: JSON.stringify({ since: window.since, until: window.until }),
      level: "campaign",
      limit: "500",
    };
    if (after) queryParams.after = after;
    const res = await graphGetWithToken<InsightsResponse>(
      `/${adAccountId}/insights`,
      queryParams,
      token,
    );
    for (const row of res.data ?? []) {
      const id = row.campaign_id;
      const name = row.campaign_name ?? "";
      if (!id) continue;
      if (!name.toLowerCase().includes(codeLower)) continue;
      const existing = aggregates.get(id) ?? {
        id,
        name,
        spend: 0,
        impressions: 0,
        clicks: 0,
        results: 0,
      };
      existing.spend += Number.parseFloat(row.spend ?? "") || 0;
      existing.impressions += Number.parseFloat(row.impressions ?? "") || 0;
      existing.clicks += Number.parseFloat(row.clicks ?? "") || 0;
      existing.results += pickResults(row);
      aggregates.set(id, existing);
    }
    pageCount += 1;
    const nextCursor = res.paging?.cursors?.after;
    if (!res.paging?.next || !nextCursor) break;
    after = nextCursor;
  }

  const matchedIds = [...aggregates.keys()];
  const statuses = new Map<string, string>();
  if (matchedIds.length > 0) {
    try {
      const res = await graphGetWithToken<{
        data?: Array<{ id: string; effective_status?: string; status?: string }>;
      }>(
        `/`,
        {
          ids: matchedIds.join(","),
          fields: "effective_status,status",
        },
        token,
      );
      const raw = res as unknown as Record<string, CampaignMeta> & {
        data?: Array<{ id: string } & CampaignMeta>;
      };
      if (Array.isArray(raw.data)) {
        for (const row of raw.data) {
          if (row.id) {
            statuses.set(
              row.id,
              row.effective_status ?? row.status ?? "UNKNOWN",
            );
          }
        }
      } else {
        for (const id of matchedIds) {
          const row = raw[id];
          if (row) {
            statuses.set(
              id,
              row.effective_status ?? row.status ?? "UNKNOWN",
            );
          }
        }
      }
    } catch (err) {
      console.warn(
        "[event-insights] status fetch failed:",
        err instanceof MetaApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
      );
    }
  }

  return matchedIds.map((id) => {
    const a = aggregates.get(id)!;
    const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null;
    const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null;
    const cpr = a.results > 0 ? a.spend / a.results : null;
    return {
      id,
      name: a.name,
      status: statuses.get(id) ?? "UNKNOWN",
      spend: a.spend,
      impressions: a.impressions,
      clicks: a.clicks,
      ctr,
      cpm,
      cpr,
      results: a.results,
      ad_account_id: adAccountId,
    };
  });
}
