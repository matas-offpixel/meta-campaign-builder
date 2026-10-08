/**
 * GAQL rows (snake_case keys, as GoogleAdsClient.query returns them) →
 * rows for migration 192. Pure.
 */

import { campaignEventCode } from "../../reporting/campaign-matching.ts";

type Num = string | number | null | undefined;

export type GaqlCampaignRow = {
  segments?: { date?: string | null };
  campaign?: { resource_name?: string | null; name?: string | null; advertising_channel_type?: string | null };
  metrics?: {
    impressions?: Num;
    clicks?: Num;
    cost_micros?: Num;
    conversions?: Num;
    conversions_value?: Num;
    video_trueview_views?: Num;
    video_trueview_view_rate?: Num;
    trueview_average_cpv?: Num;
    search_impression_share?: Num;
  };
};

export type GaqlSearchTermRow = {
  segments?: { date?: string | null; search_term_match_type?: string | null };
  campaign?: { resource_name?: string | null };
  ad_group?: { resource_name?: string | null };
  search_term_view?: { search_term?: string | null };
  metrics?: { clicks?: Num; impressions?: Num; cost_micros?: Num; conversions?: Num };
};

export type GaqlLocationRow = {
  segments?: { date?: string | null };
  campaign?: { resource_name?: string | null };
  geographic_view?: { country_criterion_id?: Num; location_type?: string | null };
  metrics?: { clicks?: Num; impressions?: Num; cost_micros?: Num };
};

export type GaqlConversionActionRow = {
  conversion_action?: { resource_name?: string | null; status?: string | null; type?: string | null };
};

/** The account a row belongs to. customerId is digits only. */
export type AccountScope = { googleAdsAccountId: string; userId: string; customerId: string };

export type PlanLink = { plan_id: string; plan_kind: "search" | "video" };
export type PlanLookup = ReadonlyMap<string, PlanLink>;

export type DailySnapshotRow = {
  user_id: string;
  google_ads_account_id: string;
  customer_id: string;
  plan_id: string | null;
  plan_kind: "search" | "video" | null;
  campaign_resource_name: string;
  campaign_name: string | null;
  advertising_channel_type: string | null;
  event_code: string | null;
  date: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversion_value_micros: number;
  video_trueview_views: number | null;
  video_trueview_view_rate: number | null;
  trueview_average_cpv_micros: number | null;
  search_impression_share: number | null;
  fetched_at: string;
};

export type SearchTermSnapshotRow = {
  user_id: string;
  customer_id: string;
  plan_id: string | null;
  campaign_resource_name: string;
  ad_group_resource_name: string;
  date: string;
  search_term: string;
  match_type: string;
  clicks: number;
  impressions: number;
  cost_micros: number;
  conversions: number;
  fetched_at: string;
};

export type LocationSnapshotRow = {
  user_id: string;
  customer_id: string;
  campaign_resource_name: string;
  date: string;
  country_criterion_id: number;
  location_type: string;
  clicks: number;
  impressions: number;
  cost_micros: number;
  fetched_at: string;
};

function num(value: Num): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Google omits a zero metric from the row, so absent reads as 0 here. */
function optional(value: Num): number | null {
  return value == null ? null : num(value);
}

function day(value: string | null | undefined): string | null {
  const d = value?.slice(0, 10);
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export function mapCampaignRow(
  raw: GaqlCampaignRow,
  scope: AccountScope,
  plans: PlanLookup,
  fetchedAt: string,
): DailySnapshotRow | null {
  const resourceName = raw.campaign?.resource_name;
  const date = day(raw.segments?.date);
  if (!resourceName || !date) return null;
  const m = raw.metrics ?? {};
  const channel = raw.campaign?.advertising_channel_type ?? null;
  const video = channel === "VIDEO";
  const name = raw.campaign?.name ?? null;
  const plan = plans.get(resourceName);
  return {
    user_id: scope.userId,
    google_ads_account_id: scope.googleAdsAccountId,
    customer_id: scope.customerId,
    plan_id: plan?.plan_id ?? null,
    plan_kind: plan?.plan_kind ?? null,
    campaign_resource_name: resourceName,
    campaign_name: name,
    advertising_channel_type: channel,
    event_code: name ? campaignEventCode(name) : null,
    date,
    impressions: num(m.impressions),
    clicks: num(m.clicks),
    cost_micros: num(m.cost_micros),
    conversions: num(m.conversions),
    conversion_value_micros: Math.round(num(m.conversions_value) * 1_000_000),
    video_trueview_views: video ? num(m.video_trueview_views) : null,
    video_trueview_view_rate: video ? num(m.video_trueview_view_rate) : null,
    trueview_average_cpv_micros: video && m.trueview_average_cpv != null ? Math.round(num(m.trueview_average_cpv)) : null,
    search_impression_share: channel === "SEARCH" ? optional(m.search_impression_share) : null,
    fetched_at: fetchedAt,
  };
}

/** Rows sharing a unique key are summed, so one upsert never touches a key twice. */
function sumInto<T extends { clicks: number; impressions: number; cost_micros: number }>(
  byKey: Map<string, T>,
  key: string,
  row: T,
  extra?: (into: T, row: T) => void,
): void {
  const into = byKey.get(key);
  if (!into) {
    byKey.set(key, row);
    return;
  }
  into.clicks += row.clicks;
  into.impressions += row.impressions;
  into.cost_micros += row.cost_micros;
  extra?.(into, row);
}

export function mapSearchTermRows(
  raws: readonly GaqlSearchTermRow[],
  scope: AccountScope,
  plans: PlanLookup,
  fetchedAt: string,
): SearchTermSnapshotRow[] {
  const byKey = new Map<string, SearchTermSnapshotRow>();
  for (const raw of raws) {
    const campaign = raw.campaign?.resource_name;
    const adGroup = raw.ad_group?.resource_name;
    const date = day(raw.segments?.date);
    const term = raw.search_term_view?.search_term;
    const matchType = raw.segments?.search_term_match_type ?? "UNSPECIFIED";
    if (!campaign || !adGroup || !date || term == null) continue;
    const m = raw.metrics ?? {};
    const row: SearchTermSnapshotRow = {
      user_id: scope.userId,
      customer_id: scope.customerId,
      plan_id: plans.get(campaign)?.plan_id ?? null,
      campaign_resource_name: campaign,
      ad_group_resource_name: adGroup,
      date,
      search_term: term,
      match_type: matchType,
      clicks: num(m.clicks),
      impressions: num(m.impressions),
      cost_micros: num(m.cost_micros),
      conversions: num(m.conversions),
      fetched_at: fetchedAt,
    };
    sumInto(byKey, JSON.stringify([campaign, adGroup, date, term, matchType]), row, (into, r) => {
      into.conversions += r.conversions;
    });
  }
  return [...byKey.values()];
}

export function mapLocationRows(
  raws: readonly GaqlLocationRow[],
  scope: AccountScope,
  fetchedAt: string,
): LocationSnapshotRow[] {
  const byKey = new Map<string, LocationSnapshotRow>();
  for (const raw of raws) {
    const campaign = raw.campaign?.resource_name;
    const date = day(raw.segments?.date);
    const country = num(raw.geographic_view?.country_criterion_id);
    const locationType = raw.geographic_view?.location_type;
    if (!campaign || !date || country <= 0 || !locationType) continue;
    const m = raw.metrics ?? {};
    const row: LocationSnapshotRow = {
      user_id: scope.userId,
      customer_id: scope.customerId,
      campaign_resource_name: campaign,
      date,
      country_criterion_id: country,
      location_type: locationType,
      clicks: num(m.clicks),
      impressions: num(m.impressions),
      cost_micros: num(m.cost_micros),
      fetched_at: fetchedAt,
    };
    sumInto(byKey, `${campaign}|${date}|${country}|${locationType}`, row);
  }
  return [...byKey.values()];
}

/**
 * ENABLED actions that track something the advertiser set up. GOOGLE_HOSTED
 * actions (e.g. "Local actions - Directions") are Google's own and are
 * enabled on accounts that track nothing.
 */
export function countEnabledConversionActions(raws: readonly GaqlConversionActionRow[]): number {
  return raws.filter((r) => r.conversion_action?.status === "ENABLED" && r.conversion_action.type !== "GOOGLE_HOSTED")
    .length;
}
