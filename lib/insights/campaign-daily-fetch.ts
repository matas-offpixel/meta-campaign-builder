/**
 * Graph fetch for campaign_daily_insights.
 *
 * Same endpoint shape as fetchEventDailyMetaMetrics: /{act_}/insights
 * with level=campaign and time_increment=1. Filter is campaign.id IN so
 * the rows stay campaign-grain instead of being summed by event code.
 *
 * Injectable fetcher — node:test cannot import lib/meta/client.ts
 * (parameter properties). Production injects graphGetWithToken.
 */

import { withActPrefix } from "../meta/ad-account-id.ts";
import {
  CAMPAIGN_DAILY_ATTRIBUTION_WINDOWS,
  type CampaignDailyFetchArgs,
  type CampaignDailyGraphRow,
} from "./campaign-daily.ts";

interface GraphPaged<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

export type CampaignDailyGraphFetcher = <T>(
  path: string,
  params: Record<string, string>,
  token: string,
) => Promise<GraphPaged<T>>;

const MAX_PAGES = 20;

export async function fetchCampaignDailyInsights(
  fetcher: CampaignDailyGraphFetcher,
  args: CampaignDailyFetchArgs,
): Promise<CampaignDailyGraphRow[]> {
  const account = withActPrefix(args.adAccountId);
  const timeRange = JSON.stringify({ since: args.since, until: args.until });
  const filtering = JSON.stringify([
    { field: "campaign.id", operator: "IN", value: [args.campaignId] },
  ]);
  const rows: CampaignDailyGraphRow[] = [];
  let after: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params: Record<string, string> = {
      fields:
        "spend,impressions,reach,clicks,inline_link_clicks,date_start,campaign_id,actions",
      level: "campaign",
      time_increment: "1",
      time_range: timeRange,
      filtering,
      action_attribution_windows: CAMPAIGN_DAILY_ATTRIBUTION_WINDOWS,
      limit: "500",
    };
    if (after) params.after = after;

    const res = await fetcher<CampaignDailyGraphRow>(
      `/${account}/insights`,
      params,
      args.token,
    );
    for (const row of res.data ?? []) rows.push(row);
    after = res.paging?.cursors?.after;
    if (!res.paging?.next || !after) break;
  }

  return rows;
}
