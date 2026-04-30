import type { CampaignInsightsRow } from "../reporting/event-insights.ts";
import type {
  GoogleAdsBreakdownRow,
  GoogleAdsCreativeRow,
} from "../reporting/google-ads-share-types.ts";
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

export interface FetchGoogleAdsShareExtrasInput
  extends FetchGoogleAdsEventCampaignInsightsInput {
  campaignIds: string[];
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

export async function fetchGoogleAdsShareExtras(
  input: FetchGoogleAdsShareExtrasInput,
): Promise<{
  creatives: GoogleAdsCreativeRow[];
  demographics: {
    regions: GoogleAdsBreakdownRow[];
    ageRanges: GoogleAdsBreakdownRow[];
    genders: GoogleAdsBreakdownRow[];
  };
}> {
  const client = input.client ?? await createDefaultClient();
  const credentials = {
    customerId: input.customerId,
    refreshToken: input.refreshToken,
    loginCustomerId: input.loginCustomerId,
  };
  const campaignIds = input.campaignIds.filter((id) => /^\d+$/.test(id));
  if (campaignIds.length === 0) {
    return emptyExtras();
  }
  const [creatives, regions, ageRanges, genders] = await Promise.all([
    client.query<GoogleAdsCreativeApiRow[]>(
      credentials,
      buildCreativeInsightsQuery(input.window, campaignIds),
    ).then(mapCreativeRows).catch((err) => {
      console.warn("[googleAds] creative query omitted", err);
      return [] as GoogleAdsCreativeRow[];
    }),
    client.query<GoogleAdsGeoApiRow[]>(
      credentials,
      buildGeoQuery(input.window, campaignIds),
    ).then((rows) => mapBreakdownRows(rows, "geo")).catch((err) => {
      console.warn("[googleAds] geo query omitted", err);
      return [] as GoogleAdsBreakdownRow[];
    }),
    client.query<GoogleAdsAgeApiRow[]>(
      credentials,
      buildAgeQuery(input.window, campaignIds),
    ).then((rows) => mapBreakdownRows(rows, "age")).catch((err) => {
      console.warn("[googleAds] age query omitted", err);
      return [] as GoogleAdsBreakdownRow[];
    }),
    client.query<GoogleAdsGenderApiRow[]>(
      credentials,
      buildGenderQuery(input.window, campaignIds),
    ).then((rows) => mapBreakdownRows(rows, "gender")).catch((err) => {
      console.warn("[googleAds] gender query omitted", err);
      return [] as GoogleAdsBreakdownRow[];
    }),
  ]);
  return { creatives, demographics: { regions, ageRanges, genders } };
}

interface GoogleAdsCreativeApiRow {
  campaign?: { id?: string | number | null; name?: string | null };
  ad_group_ad?: {
    ad?: {
      id?: string | number | null;
      name?: string | null;
      final_urls?: string[] | null;
    };
  };
  metrics?: GoogleAdsCampaignRow["metrics"];
}

interface GoogleAdsGeoApiRow {
  geographic_view?: { country_criterion_id?: string | number | null };
  metrics?: GoogleAdsCampaignRow["metrics"];
}
interface GoogleAdsAgeApiRow {
  ad_group_criterion?: { age_range?: { type?: string | null } };
  metrics?: GoogleAdsCampaignRow["metrics"];
}
interface GoogleAdsGenderApiRow {
  ad_group_criterion?: { gender?: { type?: string | null } };
  metrics?: GoogleAdsCampaignRow["metrics"];
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

function buildCreativeInsightsQuery(
  window: { since: string; until: string },
  campaignIds: string[],
): string {
  const since = requireIsoDate(window.since, "since");
  const until = requireIsoDate(window.until, "until");
  return [
    "SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.final_urls,",
    "campaign.id, campaign.name, metrics.cost_micros, metrics.impressions,",
    "metrics.clicks, metrics.ctr, metrics.engagements, metrics.video_quartile_p100_rate",
    "FROM ad_group_ad",
    `WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    "AND campaign.advertising_channel_type = VIDEO",
    `AND campaign.id IN (${campaignIds.join(",")})`,
    "AND ad_group_ad.status != REMOVED",
    "ORDER BY metrics.impressions DESC",
    "LIMIT 10",
  ].join(" ");
}

function buildGeoQuery(window: { since: string; until: string }, campaignIds: string[]): string {
  return buildBreakdownQuery(
    "geographic_view",
    "geographic_view.country_criterion_id",
    window,
    campaignIds,
  );
}

function buildAgeQuery(window: { since: string; until: string }, campaignIds: string[]): string {
  return buildBreakdownQuery(
    "age_range_view",
    "ad_group_criterion.age_range.type",
    window,
    campaignIds,
  );
}

function buildGenderQuery(window: { since: string; until: string }, campaignIds: string[]): string {
  return buildBreakdownQuery(
    "gender_view",
    "ad_group_criterion.gender.type",
    window,
    campaignIds,
  );
}

function buildBreakdownQuery(
  resource: string,
  field: string,
  window: { since: string; until: string },
  campaignIds: string[],
): string {
  const since = requireIsoDate(window.since, "since");
  const until = requireIsoDate(window.until, "until");
  return [
    `SELECT ${field}, metrics.cost_micros, metrics.impressions, metrics.clicks`,
    `FROM ${resource}`,
    `WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    `AND campaign.id IN (${campaignIds.join(",")})`,
    "ORDER BY metrics.impressions DESC",
    "LIMIT 10",
  ].join(" ");
}

function emptyExtras() {
  return {
    creatives: [],
    demographics: { regions: [], ageRanges: [], genders: [] },
  };
}

function mapCreativeRows(rows: GoogleAdsCreativeApiRow[]): GoogleAdsCreativeRow[] {
  return (rows ?? []).map((row) => {
    const campaign = row.campaign ?? {};
    const ad = row.ad_group_ad?.ad ?? {};
    const metrics = row.metrics ?? {};
    const spend = microsToCurrency(metrics.cost_micros);
    const impressions = numberMetric(metrics.impressions);
    const clicks = numberMetric(metrics.clicks);
    const engagements = numberMetric(metrics.engagements);
    const youtubeUrl = findYoutubeUrl(ad.final_urls ?? []);
    const videoId = youtubeUrl ? extractYoutubeId(youtubeUrl) : null;
    return {
      id: String(ad.id ?? campaign.id ?? ""),
      name: ad.name ?? campaign.name ?? "Google Ads creative",
      campaignId: String(campaign.id ?? ""),
      campaignName: campaign.name ?? "Google Ads campaign",
      youtubeUrl,
      thumbnailUrl: videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null,
      spend,
      impressions,
      clicks,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : nullableMetric(metrics.ctr),
      engagements,
      videoViews:
        optionalMetric(metrics.video_quartile_p100_rate) != null
          ? Math.round(optionalMetric(metrics.video_quartile_p100_rate)! * impressions)
          : engagements,
    };
  }).filter((row) => row.id && row.impressions > 0);
}

function mapBreakdownRows(
  rows: Array<GoogleAdsGeoApiRow | GoogleAdsAgeApiRow | GoogleAdsGenderApiRow>,
  kind: "geo" | "age" | "gender",
): GoogleAdsBreakdownRow[] {
  return (rows ?? []).map((row) => {
    const metrics = row.metrics ?? {};
    const label =
      kind === "geo"
        ? geoLabel((row as GoogleAdsGeoApiRow).geographic_view?.country_criterion_id)
        : kind === "age"
          ? enumLabel((row as GoogleAdsAgeApiRow).ad_group_criterion?.age_range?.type)
          : enumLabel((row as GoogleAdsGenderApiRow).ad_group_criterion?.gender?.type);
    return {
      label,
      spend: microsToCurrency(metrics.cost_micros),
      impressions: numberMetric(metrics.impressions),
      clicks: numberMetric(metrics.clicks),
    };
  }).filter((row) => row.label !== "Unknown" && row.impressions > 0);
}

function findYoutubeUrl(urls: string[]): string | null {
  return urls.find((url) => /youtu\.be|youtube\.com/.test(url)) ?? null;
}

function extractYoutubeId(url: string): string | null {
  const match = url.match(/[?&]v=([^&]+)/) ?? url.match(/youtu\.be\/([^?&]+)/);
  return match?.[1] ?? null;
}

function enumLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function geoLabel(value: string | number | null | undefined): string {
  const id = String(value ?? "");
  return COUNTRY_CRITERIA[id] ?? (id ? `Country ${id}` : "Unknown");
}

const COUNTRY_CRITERIA: Record<string, string> = {
  "2826": "United Kingdom",
  "2840": "United States",
  "2372": "Ireland",
  "2250": "France",
  "2276": "Germany",
  "2380": "Italy",
  "2724": "Spain",
  "2124": "Canada",
  "2036": "Australia",
  "2528": "Netherlands",
};

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
