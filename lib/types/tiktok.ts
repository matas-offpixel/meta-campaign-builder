/**
 * lib/types/tiktok.ts
 *
 * TikTok platform types — mirrors the shape of `lib/insights/types.ts`
 * for Meta so the cross-channel reporting aggregator can fan out to
 * either provider with a uniform contract. None of these are wired up
 * yet — the `app/api/tiktok/*` routes return
 * `{ ok: false, error: 'TikTok not configured' }` and the report tab
 * renders placeholders pending OAuth.
 */

export interface TikTokAccount {
  id: string;
  user_id: string;
  account_name: string;
  tiktok_advertiser_id: string | null;
  /** Token is never returned to the client — present in API surface only. */
  access_token_encrypted?: string | null;
  created_at: string;
  updated_at: string;
}

/** Aggregated totals across every campaign queried for an event. */
export interface TikTokTotals {
  impressions: number;
  reach: number | null;
  clicks: number;
  spend: number;
  video_views: number | null;
  cpm: number | null;
  cpc: number | null;
  ctr: number | null;
}

export interface TikTokCampaignRow {
  id: string;
  name: string;
  objective: string | null;
  status: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  video_views: number | null;
  cpm: number | null;
  cpc: number | null;
  ctr: number | null;
}

export interface TikTokCreativeRow {
  id: string;
  campaign_id: string;
  name: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  video_views: number | null;
}

export interface TikTokInsightsPayload {
  /** ISO timestamp the data was fetched. */
  fetchedAt: string;
  totals: TikTokTotals;
  campaigns: TikTokCampaignRow[];
  matchedCampaignCount: number;
}

export type TikTokInsightsErrorReason =
  | "no_account"
  | "no_advertiser_id"
  | "no_access_token"
  | "tiktok_api_error"
  | "no_campaigns_matched"
  /** Stub error returned by the unwired API routes. */
  | "not_configured";

export interface TikTokInsightsError {
  reason: TikTokInsightsErrorReason;
  message: string;
}

export type TikTokInsightsResult =
  | { ok: true; data: TikTokInsightsPayload }
  | { ok: false; error: TikTokInsightsError };

// ─────────────────────────────────────────────────────────────────────────────
// Manual XLSX/CSV report snapshots.
//
// Until the TikTok Business OAuth flow is wired, reports are sourced from
// manual exports out of TikTok Ads Manager. The parser maps each sheet/section
// onto these types and persists the bundle as `snapshot_json` on
// `tiktok_manual_reports` (migration 026).
//
// `TikTokMetricBlock` is the 16-metric shared shape every breakdown row
// (campaign totals, geo, demographic, interest, search term) carries.
// `impressions` is coerced to `number | null` so callers can `??` against a
// numeric default; `impressions_raw` preserves TikTok's "<5" masking string
// for low-volume rows so the UI can render the original cell verbatim.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 16-metric shape shared by every TikTok report breakdown row.
 *
 * TikTok masks impressions on low-volume rows by emitting the literal string
 * "<5". Parsers normalise that into `impressions = null` while keeping the
 * original token in `impressions_raw` so the UI can render the masked value
 * verbatim if it wants to.
 */
export interface TikTokMetricBlock {
  /** Coerced to number; null when TikTok masked the cell (e.g. "<5"). */
  impressions: number | null;
  /** Original cell value when masked ("<5"); null when impressions is a real number. */
  impressions_raw: string | null;
  reach: number | null;
  clicks: number | null;
  spend: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  conversions: number | null;
  cost_per_conversion: number | null;
  conversion_rate: number | null;
  video_views: number | null;
  video_views_p25: number | null;
  video_views_p50: number | null;
  video_views_p75: number | null;
  video_views_p100: number | null;
  engagements: number | null;
}

export type TikTokBudgetMode = "LIFETIME" | "DAILY";

/** Campaign-level totals row from a manual report. */
export interface TikTokCampaignTotals extends TikTokMetricBlock {
  campaign_name: string;
  objective: string | null;
  budget_mode: TikTokBudgetMode;
  budget_amount: number | null;
  currency: string | null;
  date_range_start: string;
  date_range_end: string;
  /** Override of the shared block — campaign-level reach is always present. */
  reach: number | null;
}

export type TikTokGeoRegionType = "country" | "region" | "city";

/** Geo breakdown row (country / region / city). */
export interface TikTokGeoRow extends TikTokMetricBlock {
  region_name: string;
  region_type: TikTokGeoRegionType;
}

export type TikTokGender = "Male" | "Female" | "Unknown";

/** Demographic breakdown row (age + gender). */
export interface TikTokDemographicRow extends TikTokMetricBlock {
  age_bucket: string;
  gender: TikTokGender;
}

/**
 * Coarse interest vertical bucket. Hand-curated from the TikTok interest
 * taxonomy — keep in sync with the bucketing logic in the parser.
 */
export type TikTokVertical =
  | "music_entertainment"
  | "games"
  | "lifestyle"
  | "food_drink"
  | "beauty_fashion"
  | "travel"
  | "shopping_commerce"
  | "tech"
  | "sports_fitness"
  | "other";

/** Interest / audience breakdown row. */
export interface TikTokInterestRow extends TikTokMetricBlock {
  audience_label: string;
  vertical: TikTokVertical | null;
}

/** Search term breakdown row. */
export interface TikTokSearchTermRow extends TikTokMetricBlock {
  search_term: string;
  /** Optional theme cluster assigned by the parser; null when unbucketed. */
  theme_bucket: string | null;
}

/**
 * Full snapshot persisted as `tiktok_manual_reports.snapshot_json`.
 *
 * `v` is bumped whenever the shape changes so older rows can be migrated /
 * read with a discriminator. `campaign` is nullable so partial reports
 * (e.g. geo-only exports) still validate.
 */
export interface TikTokManualReportSnapshot {
  v: 1;
  /** ISO timestamp when the snapshot was parsed and persisted. */
  fetchedAt: string;
  date_range_start: string;
  date_range_end: string;
  campaign: TikTokCampaignTotals | null;
  geo: TikTokGeoRow[];
  demographics: TikTokDemographicRow[];
  interests: TikTokInterestRow[];
  searchTerms: TikTokSearchTermRow[];
}
