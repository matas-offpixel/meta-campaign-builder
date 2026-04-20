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
// Manual report import — request / response contract.
//
// Mirrors the `{ ok: true | false, ... }` discriminated-union pattern the
// rest of the TikTok surface uses. Reasons are deliberately granular so the
// dropzone UI can surface targeted error copy without parsing message text.
// ─────────────────────────────────────────────────────────────────────────────

export type TikTokImportErrorReason =
  | "not_signed_in"
  | "missing_field"
  | "invalid_field"
  | "no_files"
  | "too_many_files"
  | "event_not_found"
  | "forbidden"
  | "parse_failed"
  | "no_recognised_files"
  | "persist_failed";

export interface TikTokImportError {
  reason: TikTokImportErrorReason;
  message: string;
}

/**
 * Successful import response. `detected_files` lists the files the parser
 * accepted (label + shape); `skipped` lists files whose header didn't
 * match any known shape — surfaced verbatim so the user can re-export.
 */
export interface TikTokImportSuccess {
  ok: true;
  report_id: string;
  detected_files: { name: string; shape: string }[];
  skipped: { name: string; reason: string }[];
}

export type TikTokImportResult =
  | TikTokImportSuccess
  | { ok: false; error: TikTokImportError };

// ─────────────────────────────────────────────────────────────────────────────
// Manual XLSX/CSV report snapshots.
//
// Until the TikTok Business OAuth flow is wired, reports are sourced from
// manual exports out of TikTok Ads Manager. The parser maps each sheet/section
// onto these types and persists the bundle as `snapshot_json` on
// `tiktok_manual_reports` (migration 026).
//
// `TikTokMetricBlock` is the shared metric shape every row in a manual report
// carries (campaign totals, ad, geo, demographic, interest, search term). The
// field names and order mirror the xlsx column headers verbatim so the parser
// can map `columns[i] → TikTokMetricBlock[key]` by index. `impressions_raw`
// is the one synthetic field: it preserves TikTok's "<5" masking token for
// low-volume rows so the UI can render the original cell, while `impressions`
// holds the numeric coercion (`null` when masked).
//
// `reach` is intentionally NOT on the base — it only appears on campaign and
// ad exports and is re-declared on `TikTokCampaignTotals` / `TikTokAdRow`.
// TIKTOK_METRIC_COLUMNS (parsers/shared.ts) must iterate these fields in the
// same order as the 16 xlsx header strings.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metric columns shared by every row in a TikTok manual report.
 *
 * Field order matches the xlsx column order so the parser can do an
 * index-based map from header → field. TikTok masks impressions on
 * low-volume rows by emitting the literal string "<5"; the parser coerces
 * that into `impressions = null` and preserves the original token in
 * `impressions_raw` for verbatim UI display.
 */
export interface TikTokMetricBlock {
  /** xlsx: "Cost". */
  cost: number | null;
  /** xlsx: "Impressions". Null when TikTok masked the cell as "<5". */
  impressions: number | null;
  /** Original cell value when masked ("<5"); null when `impressions` is a real number. */
  impressions_raw: string | null;
  /** xlsx: "CPM". */
  cpm: number | null;
  /** xlsx: "Clicks (destination)". */
  clicks_destination: number | null;
  /** xlsx: "CPC (destination)". */
  cpc_destination: number | null;
  /** xlsx: "CTR (destination)". */
  ctr_destination: number | null;
  /** xlsx: "2-second video views". */
  video_views_2s: number | null;
  /** xlsx: "6-second video views". */
  video_views_6s: number | null;
  video_views_p25: number | null;
  video_views_p50: number | null;
  video_views_p75: number | null;
  video_views_p100: number | null;
  avg_play_time_per_user: number | null;
  avg_play_time_per_video_view: number | null;
  interactive_addon_impressions: number | null;
  interactive_addon_destination_clicks: number | null;
}

/**
 * Campaign-level totals row from a manual report.
 *
 * `clicks_all` / `ctr_all` are TikTok's "all clicks" pair (vs the destination
 * clicks already in `TikTokMetricBlock`). They appear on campaign and ad
 * exports only — breakdown exports omit them.
 *
 * `objective` / `budget_mode` / `budget_amount` are NOT in the xlsx export.
 * They're collected in the upload form (or backfilled from API once OAuth
 * lands), so they're optional here.
 */
export interface TikTokCampaignTotals extends TikTokMetricBlock {
  campaign_name: string;
  /** "Active" | "Paused" | "Not delivering" — TikTok's primary status label. */
  primary_status: string;
  reach: number | null;
  cost_per_1000_reached: number | null;
  frequency: number | null;
  /** TikTok's "Clicks (all)" — superset of destination clicks. */
  clicks_all: number | null;
  /** TikTok's "CTR (all)". */
  ctr_all: number | null;
  /** ISO 4217 (e.g. "GBP"). Always present on the campaign export. */
  currency: string;
  objective?: string | null;
  budget_mode?: "LIFETIME" | "DAILY" | null;
  budget_amount?: number | null;
}

/**
 * Creative-level row from a manual report (one row per ad).
 *
 * Status / source columns are coerced from TikTok's "--" placeholder to
 * `null` by the parser. `currency` is always present.
 */
export interface TikTokAdRow extends TikTokMetricBlock {
  ad_name: string;
  primary_status: string;
  secondary_status: string;
  reach: number | null;
  cost_per_1000_reached: number | null;
  frequency: number | null;
  clicks_all: number | null;
  ctr_all: number | null;
  /** "Authorized by video code" etc; null when "--". */
  secondary_source: string | null;
  /** "TikTok creator content" etc; null when "--". */
  primary_source: string | null;
  attribution_source: string | null;
  currency: string;
  /**
   * Canonical TikTok post URL (vm.tiktok.com short link or full
   * tiktok.com/@handle/video/id). Manually populated on the
   * snapshot_json row until ad-level post IDs come back via an
   * Ads API integration.
   */
  post_url?: string | null;
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
  ads: TikTokAdRow[];
  geo: TikTokGeoRow[];
  demographics: TikTokDemographicRow[];
  interests: TikTokInterestRow[];
  searchTerms: TikTokSearchTermRow[];
}
