/**
 * lib/types/google-ads.ts
 *
 * Google Ads (Search) types. Mirrors the lib/insights/types.ts shape
 * for Meta and lib/types/tiktok.ts for TikTok so the cross-channel
 * insights aggregator has a uniform contract.
 *
 * The plan tree (GoogleAdPlan → GoogleAdCampaign → GoogleAdGroup →
 * GoogleKeyword) is what the plan builder UI edits and what is
 * persisted to google_ad_plans.campaigns (jsonb).
 */

export interface GoogleAdsAccount {
  id: string;
  user_id: string;
  account_name: string;
  google_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Plan tree ────────────────────────────────────────────────────────────

export type GoogleAdsBiddingStrategy =
  | "max_conversions"
  | "manual_cpc"
  | "target_cpa";

export const GOOGLE_ADS_BIDDING_STRATEGIES: ReadonlyArray<{
  value: GoogleAdsBiddingStrategy;
  label: string;
}> = [
  { value: "max_conversions", label: "Max Conversions" },
  { value: "manual_cpc", label: "Manual CPC" },
  { value: "target_cpa", label: "Target CPA" },
];

export type GoogleAdsCampaignPriority =
  | "must-run"
  | "highest"
  | "high"
  | "medium"
  | "low";

export const GOOGLE_ADS_PRIORITIES: ReadonlyArray<GoogleAdsCampaignPriority> = [
  "must-run",
  "highest",
  "high",
  "medium",
  "low",
];

export type GoogleAdsKeywordMatch = "exact" | "phrase" | "broad";

export interface GoogleKeyword {
  text: string;
  match_type: GoogleAdsKeywordMatch;
  estimated_cpc?: number | null;
}

export interface GoogleAdGroup {
  name: string;
  keywords: GoogleKeyword[];
  /** Default match types applied to fresh keywords added in the UI. */
  match_types?: GoogleAdsKeywordMatch[];
}

export interface GoogleAdCampaign {
  id: string;
  name: string;
  /** Free-form focus label, e.g. "Brand", "Artist: Adam Beyer". */
  focus: string;
  ad_groups: GoogleAdGroup[];
  monthly_budget: number;
  priority: GoogleAdsCampaignPriority;
  bidding_strategy: GoogleAdsBiddingStrategy;
  notes?: string | null;
}

export interface GoogleAdsGeoTarget {
  country: string;
  city?: string | null;
  /** Percentage (e.g. 20 = +20%). Negative = bid reduction. */
  bid_adjustment: number;
}

export interface GoogleAdsRlsaAdjustments {
  visitors?: number;
  checkout_abandoners?: number;
}

export interface GoogleAdsScheduling {
  weekends_boost?: number;
  payday_stretch?: number;
  offpeak_reduction?: number;
}

export interface GoogleAdPlan {
  id: string;
  event_id: string;
  user_id: string;
  google_ads_account_id: string | null;

  total_budget: number | null;
  google_budget: number | null;
  google_budget_pct: number | null;

  bidding_strategy: GoogleAdsBiddingStrategy | null;
  target_cpa: number | null;

  geo_targets: GoogleAdsGeoTarget[];
  rlsa_adjustments: GoogleAdsRlsaAdjustments;
  ad_scheduling: GoogleAdsScheduling;
  campaigns: GoogleAdCampaign[];

  status: "draft" | "live" | "completed" | "archived";
  created_at: string;
  updated_at: string;
}

// ─── Insights ─────────────────────────────────────────────────────────────

export interface GoogleAdsInsightsTotals {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number | null;
  cpc: number | null;
  conversion_rate: number | null;
  cost_per_conversion: number | null;
}

export interface GoogleAdsCampaignInsightsRow {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  cpc: number | null;
  conversion_rate: number | null;
  cost_per_conversion: number | null;
}

export interface GoogleAdsInsightsPayload {
  fetchedAt: string;
  totals: GoogleAdsInsightsTotals;
  campaigns: GoogleAdsCampaignInsightsRow[];
}

export type GoogleAdsInsightsErrorReason =
  | "no_account"
  | "no_customer_id"
  | "no_credentials"
  | "google_ads_api_error"
  | "no_campaigns_matched"
  | "not_configured";

export interface GoogleAdsInsightsError {
  reason: GoogleAdsInsightsErrorReason;
  message: string;
}

export type GoogleAdsInsightsResult =
  | { ok: true; data: GoogleAdsInsightsPayload }
  | { ok: false; error: GoogleAdsInsightsError };

/**
 * Default Google allocation (% of total digital budget) when none has
 * been set on the plan. Derived from the J2 Melodic reference plan
 * where £1,200 / £11,450 ≈ 10.48%.
 */
export const DEFAULT_GOOGLE_BUDGET_PCT = 10.5;
