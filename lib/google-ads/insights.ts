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
    engagements?: string | number | null;
    conversions?: string | number | null;
    video_quartile_p25_rate?: string | number | null;
    video_quartile_p50_rate?: string | number | null;
    video_quartile_p75_rate?: string | number | null;
    video_quartile_p100_rate?: string | number | null;
  };
}

export async function fetchGoogleAdsEventCampaignInsights(
  input: FetchGoogleAdsEventCampaignInsightsInput,
): Promise<CampaignInsightsRow[]> {
  if (GOOGLE_ADS_CHUNK_CONCURRENCY !== 1) {
    throw new Error("Google Ads insight chunks must run serially.");
  }

  const client = input.client ?? await createDefaultClient();
  const credentials = {
    customerId: input.customerId,
    refreshToken: input.refreshToken,
    loginCustomerId: input.loginCustomerId,
  };
  let rows: GoogleAdsCampaignRow[];
  try {
    rows = await client.query<GoogleAdsCampaignRow[]>(
      credentials,
      buildCampaignInsightsQuery(input.window, true),
    );
  } catch (err) {
    if (!isVideoQuartileQueryError(err)) throw err;
    console.warn("[googleAds] retrying insights without video quartile fields", err);
    rows = await client.query<GoogleAdsCampaignRow[]>(
      credentials,
      buildCampaignInsightsQuery(input.window, false),
    );
  }

  return (rows ?? []).flatMap((row) => {
    const campaign = row.campaign ?? {};
    const metrics = row.metrics ?? {};
    const id = campaign.id == null ? "" : String(campaign.id);
    const name = campaign.name ?? "";
    if (!id || !campaignNameMatchesEventCode(name, input.eventCode)) return [];

    const spend = microsToCurrency(metrics.cost_micros);
    const impressions = numberMetric(metrics.impressions);
    const clicks = numberMetric(metrics.clicks);
    // Google Ads API v23 does not expose metrics.video_views in GAQL.
    // For YouTube awareness campaigns, engagements maps to the UI's
    // populated "Engagements" metric and is the reporting proxy we need.
    const engagements = numberMetric(metrics.engagements);
    const conversions = numberMetric(metrics.conversions);
    const results = conversions > 0 ? conversions : engagements;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : nullableMetric(metrics.ctr);
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : microsToNullableCurrency(metrics.average_cpm);
    const cpr = results > 0 ? spend / results : null;
    const isVideoCampaign = campaign.advertising_channel_type === "VIDEO";
    const costPerView = isVideoCampaign && engagements > 0 ? spend / engagements : null;
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
      video_views: engagements,
      cost_per_view: costPerView,
      thruplays: engagements,
      campaign_type: campaignType,
      video_quartile_p25_rate: optionalMetric(metrics.video_quartile_p25_rate),
      video_quartile_p50_rate: optionalMetric(metrics.video_quartile_p50_rate),
      video_quartile_p75_rate: optionalMetric(metrics.video_quartile_p75_rate),
      video_quartile_p100_rate: optionalMetric(metrics.video_quartile_p100_rate),
    }];
  });
}

async function createDefaultClient(): Promise<GoogleAdsQueryClient> {
  const { GoogleAdsClient } = await import("./client.ts");
  return new GoogleAdsClient();
}

function buildCampaignInsightsQuery(
  window: { since: string; until: string },
  includeVideoQuartiles: boolean,
): string {
  const since = requireIsoDate(window.since, "since");
  const until = requireIsoDate(window.until, "until");
  const videoFields = includeVideoQuartiles
    ? ", metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate, metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate"
    : "";
  return [
    "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,",
    "campaign.advertising_channel_sub_type, metrics.cost_micros, metrics.impressions,",
    `metrics.clicks, metrics.ctr, metrics.average_cpm, metrics.engagements, metrics.conversions${videoFields}`,
    "FROM campaign",
    `WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    "AND campaign.status != 'REMOVED'",
    "AND campaign.advertising_channel_type IN (SEARCH, VIDEO)",
    "ORDER BY metrics.cost_micros DESC",
  ].join(" ");
}

function requireIsoDate(value: string, field: "since" | "until"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Google Ads insights window.${field} must be YYYY-MM-DD.`);
  }
  return value;
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

function optionalMetric(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isVideoQuartileQueryError(err: unknown): boolean {
  const text = JSON.stringify(err);
  return /UNRECOGNIZED_FIELD|video_quartile_p(?:25|50|75|100)_rate/.test(text);
}

function numberMetric(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
