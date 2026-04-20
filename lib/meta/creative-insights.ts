/**
 * lib/meta/creative-insights.ts
 *
 * Server-only Meta Graph API helper for the creative heatmap. Pulls every
 * ad under an ad account along with last-30d insights and maps the wire
 * shape into our internal CreativeInsightRow.
 *
 * Uses the existing graphGetWithToken helper from lib/meta/client.ts —
 * no new HTTP layer.
 */

import { graphGetWithToken } from "@/lib/meta/client";
import type { CreativeInsightRow } from "@/lib/types/intelligence";

interface RawAd {
  id: string;
  name: string;
  status?: string;
  campaign_id?: string;
  adset_id?: string;
  creative?: {
    id?: string;
    name?: string;
    thumbnail_url?: string;
  };
  insights?: {
    data?: Array<{
      spend?: string;
      impressions?: string;
      clicks?: string;
      cpm?: string;
      cpc?: string;
      ctr?: string;
      frequency?: string;
      reach?: string;
      actions?: Array<{ action_type: string; value: string }>;
    }>;
  };
}

interface PagedResponse<T> {
  data: T[];
  paging?: { cursors?: { after: string }; next?: string };
}

interface FetchOptions {
  /** ISO date YYYY-MM-DD (currently unused — Meta's `date_preset=last_30d` overrides). */
  since: string;
  /** ISO date YYYY-MM-DD (currently unused — Meta's `date_preset=last_30d` overrides). */
  until: string;
  /** Optional list of campaign IDs to filter ads by. */
  campaignIds?: string[];
}

function num(v: string | undefined): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumAction(
  actions: Array<{ action_type: string; value: string }> | undefined,
  types: string[],
): number {
  if (!actions || actions.length === 0) return 0;
  let total = 0;
  for (const a of actions) {
    if (types.includes(a.action_type)) total += num(a.value);
  }
  return total;
}

function fatigueFromFrequency(freq: number): CreativeInsightRow["fatigueScore"] {
  if (!Number.isFinite(freq) || freq < 3) return "ok";
  if (freq <= 5) return "warning";
  return "critical";
}

/**
 * Fetch every ad under the given ad account along with its last-30-days
 * performance insights. Returns one CreativeInsightRow per ad — empty
 * array if Meta returns no rows or the call fails (caller decides how
 * to surface that to the UI).
 *
 * Uses date_preset=last_30d via the nested insights expansion so we get
 * one round-trip per page rather than fetching ads then insights serially.
 */
export async function fetchCreativeInsights(
  adAccountId: string,
  accessToken: string,
  options: FetchOptions,
): Promise<CreativeInsightRow[]> {
  const fields = [
    "id",
    "name",
    "status",
    "campaign_id",
    "adset_id",
    "creative{id,name,thumbnail_url}",
    "insights.date_preset(last_30d){spend,impressions,clicks,actions,cpm,cpc,ctr,frequency,reach}",
  ].join(",");

  const params: Record<string, string> = { fields, limit: "100" };
  if (options.campaignIds?.length) {
    params.filtering = JSON.stringify([
      { field: "campaign.id", operator: "IN", value: options.campaignIds },
    ]);
  }

  const rows: CreativeInsightRow[] = [];
  let after: string | undefined;
  let safetyCounter = 0;

  do {
    if (after) params.after = after;
    const res = await graphGetWithToken<PagedResponse<RawAd>>(
      `/${adAccountId}/ads`,
      params,
      accessToken,
    );

    for (const ad of res.data ?? []) {
      const insight = ad.insights?.data?.[0];
      const spend = num(insight?.spend);
      const impressions = num(insight?.impressions);
      const clicks = num(insight?.clicks);
      const ctr = num(insight?.ctr);
      const cpm = num(insight?.cpm);
      const cpc = num(insight?.cpc);
      const frequency = num(insight?.frequency);
      const reach = num(insight?.reach);
      const linkClicks = sumAction(insight?.actions, ["link_click"]);
      const purchases = sumAction(insight?.actions, [
        "omni_purchase",
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
      ]);
      const cpl = linkClicks > 0 ? Number((spend / linkClicks).toFixed(2)) : null;

      rows.push({
        adId: ad.id,
        adName: ad.name,
        status: ad.status ?? null,
        campaignId: ad.campaign_id ?? null,
        adsetId: ad.adset_id ?? null,
        creativeId: ad.creative?.id ?? null,
        creativeName: ad.creative?.name ?? null,
        thumbnailUrl: ad.creative?.thumbnail_url ?? null,
        spend,
        impressions,
        clicks,
        ctr,
        cpm,
        cpc,
        frequency,
        reach,
        linkClicks,
        purchases,
        cpl,
        fatigueScore: fatigueFromFrequency(frequency),
        // Tags are merged in by the API route after fetching, so the Meta
        // client stays unaware of our local annotations table.
        tags: [],
      });
    }

    after = res.paging?.cursors?.after;
    safetyCounter += 1;
    // 20 pages × 100 = 2 000 ads. More than that points at a runaway loop —
    // bail rather than hang the request.
    if (safetyCounter >= 20) break;
  } while (after);

  return rows;
}
