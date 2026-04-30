import "server-only";

import {
  applyCampaignDeliveryHeuristic,
  normaliseMetaCampaignStatus,
} from "@/lib/insights/campaign-status";
import type {
  CampaignDisplayStatus,
  CampaignStatusReason,
} from "@/lib/insights/campaign-status";
import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import { fetchGoogleAdsEventCampaignInsights } from "@/lib/google-ads/insights";
import { campaignNameMatchesEventCode } from "@/lib/reporting/campaign-matching";

export { campaignNameMatchesEventCode } from "@/lib/reporting/campaign-matching";

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
  statusReason?: CampaignStatusReason;
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
  video_views?: number;
  cost_per_view?: number | null;
  thruplays?: number;
  campaign_type?: string;
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
  platform?: "meta";
  adAccountId: string;
  /** Case-insensitive substring against `campaign_name`. */
  eventCode: string;
  token: string;
  window: { since: string; until: string };
}

export interface FetchGoogleEventCampaignInsightsInput {
  platform: "google";
  customerId: string;
  refreshToken: string;
  loginCustomerId?: string | null;
  eventCode: string;
  window: { since: string; until: string };
}

export interface FetchTikTokEventCampaignInsightsInput {
  platform: "tiktok";
  advertiserId: string;
  token: string;
  eventCode: string;
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
  input:
    | FetchEventCampaignInsightsInput
    | FetchGoogleEventCampaignInsightsInput
    | FetchTikTokEventCampaignInsightsInput,
): Promise<CampaignInsightsRow[]> {
  if (input.platform === "google") {
    return fetchGoogleAdsEventCampaignInsights(input);
  }
  if (input.platform === "tiktok") {
    const { fetchTikTokEventCampaignInsights } = await import("@/lib/tiktok/insights");
    return fetchTikTokEventCampaignInsights(input);
  }

  const { token, window, eventCode } = input;
  const adAccountId = normaliseAdAccountId(input.adAccountId);

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
      if (!campaignNameMatchesEventCode(name, eventCode)) continue;
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
  const statuses = new Map<string, CampaignDisplayStatus>();
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
              normaliseMetaCampaignStatus({
                status: row.status,
                effectiveStatus: row.effective_status,
              }),
            );
          }
        }
      } else {
        for (const id of matchedIds) {
          const row = raw[id];
          if (row) {
            statuses.set(
              id,
              normaliseMetaCampaignStatus({
                status: row.status,
                effectiveStatus: row.effective_status,
              }),
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

  const [lifetimeImpressions, impressionsLast24h] =
    matchedIds.length > 0
      ? await Promise.all([
          fetchMatchedCampaignImpressions({
            adAccountId,
            eventCode,
            token,
            datePreset: "maximum",
          }),
          fetchMatchedCampaignImpressions({
            adAccountId,
            eventCode,
            token,
            datePreset: "today",
          }),
        ])
      : [null, null];

  return matchedIds.map((id) => {
    const a = aggregates.get(id)!;
    const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null;
    const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null;
    const cpr = a.results > 0 ? a.spend / a.results : null;
    const display = applyCampaignDeliveryHeuristic({
      status: statuses.get(id) ?? "UNKNOWN",
      lifetimeImpressions:
        lifetimeImpressions === null
          ? undefined
          : (lifetimeImpressions.get(id) ?? 0),
      impressionsLast24h:
        impressionsLast24h === null
          ? undefined
          : (impressionsLast24h.get(id) ?? 0),
    });
    return {
      id,
      name: a.name,
      status: display.status,
      ...(display.reason ? { statusReason: display.reason } : {}),
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

async function fetchMatchedCampaignImpressions(args: {
  adAccountId: string;
  eventCode: string;
  token: string;
  datePreset: "maximum" | "today";
}): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  let after: string | undefined;
  let pageCount = 0;
  try {
    while (pageCount < MAX_PAGES) {
      const queryParams: Record<string, string> = {
        fields: "campaign_id,campaign_name,impressions",
        date_preset: args.datePreset,
        level: "campaign",
        limit: "500",
      };
      if (after) queryParams.after = after;
      const res = await graphGetWithToken<InsightsResponse>(
        `/${args.adAccountId}/insights`,
        queryParams,
        args.token,
      );
      for (const row of res.data ?? []) {
        const id = row.campaign_id;
        const name = row.campaign_name ?? "";
        if (!id) continue;
        if (!campaignNameMatchesEventCode(name, args.eventCode)) continue;
        out.set(
          id,
          (out.get(id) ?? 0) + (Number.parseFloat(row.impressions ?? "") || 0),
        );
      }
      pageCount += 1;
      const nextCursor = res.paging?.cursors?.after;
      if (!res.paging?.next || !nextCursor) break;
      after = nextCursor;
    }
  } catch (err) {
    console.warn(
      `[event-insights] ${args.datePreset} impression heuristic fetch failed:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
  return out;
}
