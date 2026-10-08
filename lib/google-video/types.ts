/**
 * lib/google-video/types.ts
 *
 * YouTube video plans. The Google Ads API cannot create or change Video
 * campaigns, so a plan is imported, checked here, and exported as a
 * Google Ads Editor CSV (`editor-export.ts`). Tables: migration 190.
 */

export const VIDEO_PLAN_STATUSES = ["draft", "exported", "live"] as const;
export type GoogleVideoPlanStatus = (typeof VIDEO_PLAN_STATUSES)[number];

export type GoogleVideoEntityStatus = "enabled" | "paused";

export const CONNECTED_TV = "CONNECTED_TV";

export type GoogleVideoPlacementKind = "video" | "channel" | "handle";

export interface GoogleVideoGeoTarget {
  /** Location name as Editor resolves it, e.g. `London`. */
  name: string;
  /** Percent, e.g. 25 for +25%. Null = no adjustment. */
  bid_modifier_pct: number | null;
  negative: boolean;
}

/** One `Setting | Value | Note` row, kept for the Review step. */
export interface GoogleVideoSheetRow {
  type?: string;
  setting: string;
  value: string;
  note?: string;
}

export interface GoogleVideoPlan {
  id: string;
  user_id: string;
  event_id: string | null;
  google_ads_account_id: string | null;
  name: string;
  status: GoogleVideoPlanStatus;
  daily_budget: number | null;
  total_budget: number | null;
  start_date: string | null;
  end_date: string | null;
  cpv_bid: number | null;
  include_video_partners: boolean;
  device_exclusions: string[];
  frequency_cap_per_day: number | null;
  frequency_cap_per_week: number | null;
  language_codes: string[];
  geo_targets: GoogleVideoGeoTarget[];
  final_url: string | null;
  display_url: string | null;
  call_to_action: string | null;
  settings_rows: GoogleVideoSheetRow[];
  targeting_rows: GoogleVideoSheetRow[];
  source_filename: string | null;
  exported_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleVideoCampaign {
  id: string;
  plan_id: string;
  name: string;
  tier: string | null;
  status: GoogleVideoEntityStatus;
  daily_budget: number | null;
  google_campaign_resource_name: string | null;
  sort_order: number;
}

export interface GoogleVideoAdGroup {
  id: string;
  campaign_id: string;
  name: string;
  status: GoogleVideoEntityStatus;
  cpv_bid: number | null;
  sort_order: number;
}

export interface GoogleVideoPlacement {
  id: string;
  ad_group_id: string;
  label: string;
  /** As written on the sheet. */
  value: string;
  kind: GoogleVideoPlacementKind | null;
  /** Video id, `UC…` channel id, or `@handle`. Null = unparseable. */
  resolved_id: string | null;
  status: GoogleVideoEntityStatus;
  note: string | null;
  sort_order: number;
}

/** Plan-level: every ad runs in every ad group. */
export interface GoogleVideoAd {
  id: string;
  plan_id: string;
  name: string;
  status: GoogleVideoEntityStatus;
  /** As written on the sheet (a link or a title). */
  video_value: string | null;
  /** Parsed YouTube video id. Null = no link yet. */
  video_id: string | null;
  final_url: string | null;
  call_to_action: string | null;
  headline: string | null;
  long_headline: string | null;
  description: string | null;
  note: string | null;
  sort_order: number;
}

export interface GoogleVideoAdGroupNode extends GoogleVideoAdGroup {
  placements: GoogleVideoPlacement[];
}

export interface GoogleVideoCampaignNode extends GoogleVideoCampaign {
  ad_groups: GoogleVideoAdGroupNode[];
}

export interface GoogleVideoPlanTree {
  plan: GoogleVideoPlan;
  campaigns: GoogleVideoCampaignNode[];
  ads: GoogleVideoAd[];
}

type Draft<T> = Omit<T, "id" | "plan_id" | "campaign_id" | "ad_group_id">;

export type GoogleVideoPlanDraft = Omit<
  GoogleVideoPlan,
  "id" | "user_id" | "exported_at" | "created_at" | "updated_at"
>;

export interface GoogleVideoCampaignDraftNode extends Draft<GoogleVideoCampaign> {
  ad_groups: Array<Draft<GoogleVideoAdGroup> & { placements: Draft<GoogleVideoPlacement>[] }>;
}

export interface GoogleVideoImportWarning {
  code:
    | "ad_over_limit"
    | "ad_video_not_a_link"
    | "placement_unparseable"
    | "location_skipped"
    | "language_unknown"
    | "setting_not_exported"
    | "missing_tab"
    | "no_cpv_bid"
    | "no_daily_budget";
  message: string;
}

export interface GoogleVideoPlanDraftTree {
  plan: GoogleVideoPlanDraft;
  campaigns: GoogleVideoCampaignDraftNode[];
  ads: Draft<GoogleVideoAd>[];
  warnings: GoogleVideoImportWarning[];
  /** Tabs in the workbook, for the "Parsed 0 placements" message. */
  tabs: string[];
}

export const AD_LIMITS = {
  call_to_action: 10,
  headline: 15,
  long_headline: 90,
  description: 70,
} as const;

export type AdLimitField = keyof typeof AD_LIMITS;

export const AD_FIELD_LABELS: Record<AdLimitField, string> = {
  call_to_action: "CTA",
  headline: "Headline",
  long_headline: "Long headline",
  description: "Description",
};
