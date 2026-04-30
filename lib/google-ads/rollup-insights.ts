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

export interface GoogleAdsDailyInsightRow {
  date: string;
  google_ads_spend: number;
  google_ads_impressions: number;
  google_ads_clicks: number;
  google_ads_conversions: number;
  google_ads_video_views: number;
}

export interface FetchGoogleAdsDailyRollupInsightsInput {
  customerId: string;
  refreshToken: string;
  loginCustomerId?: string | null;
  eventCode: string;
  since: string;
  until: string;
  /** Test hook only — production callers use the default Google Ads client. */
  client?: GoogleAdsQueryClient;
}

export interface FetchGoogleAdsDailyRollupsForEventsInput {
  events: Array<{
    eventId: string;
    customerId: string;
    refreshToken: string;
    loginCustomerId?: string | null;
    eventCode: string;
  }>;
  since: string;
  until: string;
  client?: GoogleAdsQueryClient;
}

interface GoogleAdsDailyCampaignRow {
  campaign?: {
    id?: string | number | null;
    name?: string | null;
  };
  segments?: {
    date?: string | null;
  };
  metrics?: {
    cost_micros?: string | number | null;
    impressions?: string | number | null;
    clicks?: string | number | null;
    conversions?: string | number | null;
    engagements?: string | number | null;
  };
}

/**
 * Google Ads daily campaign rollup, matching the reporting-layer event_code
 * rule (case-insensitive substring) and aggregating accepted rows by date.
 */
export async function fetchGoogleAdsDailyRollupInsights(
  input: FetchGoogleAdsDailyRollupInsightsInput,
): Promise<GoogleAdsDailyInsightRow[]> {
  if (GOOGLE_ADS_CHUNK_CONCURRENCY !== 1) {
    throw new Error("Google Ads rollup chunks must run serially.");
  }

  const client = input.client ?? await createDefaultClient();
  const rows = await client.query<GoogleAdsDailyCampaignRow[]>(
    {
      customerId: input.customerId,
      refreshToken: input.refreshToken,
      loginCustomerId: input.loginCustomerId,
    },
    buildDailyRollupQuery({ since: input.since, until: input.until }),
  );

  const byDate = new Map<string, GoogleAdsDailyInsightRow>();
  for (const row of rows ?? []) {
    const campaignName = row.campaign?.name ?? "";
    const date = row.segments?.date?.slice(0, 10);
    if (!date || !campaignNameMatchesEventCode(campaignName, input.eventCode)) {
      continue;
    }
    const metrics = row.metrics ?? {};
    const existing = byDate.get(date) ?? {
      date,
      google_ads_spend: 0,
      google_ads_impressions: 0,
      google_ads_clicks: 0,
      google_ads_conversions: 0,
      google_ads_video_views: 0,
    };
    existing.google_ads_spend += microsToCurrency(metrics.cost_micros);
    existing.google_ads_impressions += numberMetric(metrics.impressions);
    existing.google_ads_clicks += numberMetric(metrics.clicks);
    existing.google_ads_conversions += numberMetric(metrics.conversions);
    existing.google_ads_video_views += numberMetric(metrics.engagements);
    byDate.set(date, existing);
  }

  return [...byDate.values()]
    .map((row) => ({
      ...row,
      google_ads_spend: round2(row.google_ads_spend),
      google_ads_impressions: Math.round(row.google_ads_impressions),
      google_ads_clicks: Math.round(row.google_ads_clicks),
      google_ads_conversions: Math.round(row.google_ads_conversions),
      google_ads_video_views: Math.round(row.google_ads_video_views),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchGoogleAdsDailyRollupsForEvents(
  input: FetchGoogleAdsDailyRollupsForEventsInput,
): Promise<Map<string, GoogleAdsDailyInsightRow[]>> {
  const results = new Map<string, GoogleAdsDailyInsightRow[]>();
  for (const event of input.events) {
    results.set(
      event.eventId,
      await fetchGoogleAdsDailyRollupInsights({
        customerId: event.customerId,
        refreshToken: event.refreshToken,
        loginCustomerId: event.loginCustomerId,
        eventCode: event.eventCode,
        since: input.since,
        until: input.until,
        client: input.client,
      }),
    );
  }
  return results;
}

function buildDailyRollupQuery(window: { since: string; until: string }): string {
  return `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.engagements
    FROM campaign
    WHERE segments.date BETWEEN '${window.since}' AND '${window.until}'
      AND campaign.status != 'REMOVED'
      AND campaign.advertising_channel_type IN (SEARCH, VIDEO)
    ORDER BY segments.date ASC
  `;
}

async function createDefaultClient(): Promise<GoogleAdsQueryClient> {
  const { GoogleAdsClient } = await import("./client.ts");
  return new GoogleAdsClient();
}

function microsToCurrency(value: string | number | null | undefined): number {
  return numberMetric(value) / 1_000_000;
}

function numberMetric(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
