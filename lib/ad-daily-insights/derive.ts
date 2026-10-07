/**
 * Meta level=ad, time_increment=1 insight row → one ad_daily_insights row.
 * Pure.
 *
 * Registrations and leads are separate columns. Each reads the first
 * type present in its list and never sums the list: Meta reports the
 * pixel type and the plain alias with the same value (measured
 * 2026-10-07 on 4TheFans: 4/4 registration rows, 20/20 lead rows), so a
 * sum would double-count. view_content is deliberately absent — that is
 * why REGISTRATION_ACTION_TYPES in lib/meta/creative-insights.ts is not
 * reused here. Every other action type stays in `actions` only.
 *
 * Video: 3s = actions[video_view] (same as event_daily_rollups).
 * video_play_actions counts plays from the first frame, not 3s.
 * 15s and p100 come from their own fields; the same names inside
 * `actions` are always zero.
 */

export const REGISTRATION_ACTION_TYPES = [
  "offsite_conversion.fb_pixel_complete_registration",
  "complete_registration",
] as const;

export const LEAD_ACTION_TYPES = ["offsite_conversion.fb_pixel_lead", "lead"] as const;

export const PURCHASE_ACTION_TYPES = ["offsite_conversion.fb_pixel_purchase"] as const;

export const AD_DAILY_INSIGHTS_FIELDS = [
  "spend",
  "impressions",
  "reach",
  "clicks",
  "inline_link_clicks",
  "actions",
  "video_15_sec_watched_actions",
  "video_p100_watched_actions",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
].join(",");

export type MetaActionRow = { action_type?: string; value?: string | number };

export type MetaAdInsightRow = {
  date_start?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string | number;
  impressions?: string | number;
  reach?: string | number;
  clicks?: string | number;
  inline_link_clicks?: string | number;
  actions?: MetaActionRow[];
  video_15_sec_watched_actions?: MetaActionRow[];
  video_p100_watched_actions?: MetaActionRow[];
};

export type AdDailyInsightRow = {
  ad_account_id: string;
  meta_ad_id: string;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  date: string;
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  landing_page_views: number;
  video_plays_3s: number;
  video_plays_15s: number;
  video_plays_p100: number;
  registrations: number;
  leads: number;
  purchases: number;
  actions: MetaActionRow[];
  result_action_type: string | null;
  fetched_at: string;
};

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function int(value: unknown): number {
  return Math.round(num(value));
}

function sumType(rows: MetaActionRow[] | undefined, type: string): number {
  let total = 0;
  for (const row of rows ?? []) if (row.action_type === type) total += num(row.value);
  return total;
}

/** First type in `types` present in `rows`; never a sum across types. */
export function firstPresentAction(
  rows: MetaActionRow[] | undefined,
  types: readonly string[],
): { type: string; value: number } | null {
  for (const type of types) {
    if ((rows ?? []).some((row) => row.action_type === type)) {
      return { type, value: int(sumType(rows, type)) };
    }
  }
  return null;
}

/** Sum of every row; the per-field video arrays carry one row per action type. */
function sumAll(rows: MetaActionRow[] | undefined): number {
  return int((rows ?? []).reduce((total, row) => total + num(row.value), 0));
}

export function deriveAdDailyInsight(
  adAccountId: string,
  row: MetaAdInsightRow,
  fetchedAt: Date = new Date(),
): AdDailyInsightRow | null {
  const metaAdId = row.ad_id?.trim();
  const date = row.date_start?.trim();
  if (!metaAdId || !date) return null;

  const registrations = firstPresentAction(row.actions, REGISTRATION_ACTION_TYPES);
  const leads = firstPresentAction(row.actions, LEAD_ACTION_TYPES);
  const purchases = firstPresentAction(row.actions, PURCHASE_ACTION_TYPES);
  const result = [registrations, leads, purchases].find((hit) => hit && hit.value > 0) ?? null;

  return {
    ad_account_id: adAccountId,
    meta_ad_id: metaAdId,
    meta_adset_id: row.adset_id?.trim() || null,
    meta_campaign_id: row.campaign_id?.trim() || null,
    date,
    ad_name: row.ad_name ?? null,
    adset_name: row.adset_name ?? null,
    campaign_name: row.campaign_name ?? null,
    spend: num(row.spend),
    impressions: int(row.impressions),
    reach: int(row.reach),
    clicks: int(row.clicks),
    link_clicks: int(row.inline_link_clicks),
    landing_page_views: int(sumType(row.actions, "landing_page_view")),
    video_plays_3s: int(sumType(row.actions, "video_view")),
    video_plays_15s: sumAll(row.video_15_sec_watched_actions),
    video_plays_p100: sumAll(row.video_p100_watched_actions),
    registrations: registrations?.value ?? 0,
    leads: leads?.value ?? 0,
    purchases: purchases?.value ?? 0,
    actions: row.actions ?? [],
    result_action_type: result?.type ?? null,
    fetched_at: fetchedAt.toISOString(),
  };
}
