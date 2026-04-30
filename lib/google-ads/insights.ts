import type { CampaignInsightsRow } from "../reporting/event-insights.ts";
import { campaignNameMatchesEventCode } from "../reporting/campaign-matching.ts";

import { GOOGLE_ADS_CHUNK_CONCURRENCY } from "./constants.ts";

interface GoogleAdsQueryClient {
  query<T>(
    credentials: {
      customerId: string;
      refreshToken: string;
      loginCustomerId?: string | null;
    },
    gaql: string,
  ): Promise<T>;
}

export interface FetchGoogleAdsEventCampaignInsightsInput {
  customerId: string;
  refreshToken: string;
  loginCustomerId?: string | null;
  eventCode: string;
  window: { since: string; until: string };
  client?: GoogleAdsQueryClient;
}

interface GoogleAdsCampaignRow {
  campaign?: {
    id?: string | number | null;
    name?: string | null;
    status?: string | null;
    advertising_channel_type?: string | null;
    advertising_channel_sub_type?: string | null;
  };
  metrics?: {
    cost_micros?: string | number | null;
    impressions?: string | number | null;
    clicks?: string | number | null;
    ctr?: string | number | null;
    average_cpm?: string | number | null;
    video_views?: string | number | null;
    conversions?: string | number | null;
  };
}

export async function fetchGoogleAdsEventCampaignInsights(
  input: FetchGoogleAdsEventCampaignInsightsInput,
): Promise<CampaignInsightsRow[]> {
  if (GOOGLE_ADS_CHUNK_CONCURRENCY !== 1) {
    throw new Error("Google Ads insight chunks must run serially.");
  }

  const client = input.client ?? await createDefaultClient();
  const rows = await client.query<GoogleAdsCampaignRow[]>(
    {
      customerId: input.customerId,
      refreshToken: input.refreshToken,
      loginCustomerId: input.loginCustomerId,
    },
    buildCampaignInsightsQuery(input.window),
  );

  return (rows ?? []).flatMap((row) => {
    const campaign = row.campaign ?? {};
    const metrics = row.metrics ?? {};
    const id = campaign.id == null ? "" : String(campaign.id);
    const name = campaign.name ?? "";
    if (!id || !campaignNameMatchesEventCode(name, input.eventCode)) return [];

    const spend = microsToCurrency(metrics.cost_micros);
    const impressions = numberMetric(metrics.impressions);
    const clicks = numberMetric(metrics.clicks);
    const videoViews = numberMetric(metrics.video_views);
    const conversions = numberMetric(metrics.conversions);
    const results = conversions > 0 ? conversions : videoViews;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : nullableMetric(metrics.ctr);
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : microsToNullableCurrency(metrics.average_cpm);
    const cpr = results > 0 ? spend / results : null;
    const isVideoCampaign = campaign.advertising_channel_type === "VIDEO";
    const costPerView = isVideoCampaign && videoViews > 0 ? spend / videoViews : null;
    const campaignType = [
      campaign.advertising_channel_type,
      campaign.advertising_channel_sub_type,
    ].filter(Boolean).join(":") || "UNKNOWN";

    return [{
      id,
      name,
      status: campaign.status ?? "UNKNOWN",
      spend,
      impressions,
      clicks,
      ctr,
      cpm,
      cpr,
      results,
      ad_account_id: input.customerId,
      video_views: videoViews,
      cost_per_view: costPerView,
      thruplays: videoViews,
      campaign_type: campaignType,
    }];
  });
}

async function createDefaultClient(): Promise<GoogleAdsQueryClient> {
  const { GoogleAdsClient } = await import("./client.ts");
  return new GoogleAdsClient();
}

function buildCampaignInsightsQuery(window: { since: string; until: string }): string {
  return `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.advertising_channel_sub_type,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpm,
      metrics.video_views,
      metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${window.since}' AND '${window.until}'
      AND campaign.status != 'REMOVED'
      AND campaign.advertising_channel_type IN ('SEARCH', 'VIDEO')
    ORDER BY metrics.cost_micros DESC
  `;
}

function microsToCurrency(value: string | number | null | undefined): number {
  return numberMetric(value) / 1_000_000;
}

function microsToNullableCurrency(value: string | number | null | undefined): number | null {
  const parsed = numberMetric(value);
  return parsed > 0 ? parsed / 1_000_000 : null;
}

function nullableMetric(value: string | number | null | undefined): number | null {
  const parsed = numberMetric(value);
  return parsed > 0 ? parsed : null;
}

function numberMetric(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
