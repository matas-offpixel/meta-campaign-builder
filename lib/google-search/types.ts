/**
 * lib/google-search/types.ts
 *
 * Application-level types for the Google Search Campaign Creator wizard,
 * mirroring the relational shape of migration 096
 * (`google_search_plans` + 5 child tables) plus a composite
 * `GoogleSearchPlanTree` that the wizard and the Phase 3 push adapter
 * both load / persist in one shape.
 *
 * Per the 4-thread invariant, root `lib/types.ts` is owned by the Ops
 * thread; new wizard-scoped types live here.
 */

// ─── Atomic value shapes ──────────────────────────────────────────────

export const MATCH_TYPES = ["EXACT", "PHRASE", "BROAD"] as const;
export type GoogleSearchMatchType = (typeof MATCH_TYPES)[number];

export const PLAN_STATUSES = [
  "draft",
  "pushed",
  "partially_pushed",
  "archived",
] as const;
export type GoogleSearchPlanStatus = (typeof PLAN_STATUSES)[number];

export const BIDDING_STRATEGIES = ["maximize_clicks", "manual_cpc"] as const;
export type GoogleSearchBiddingStrategy = (typeof BIDDING_STRATEGIES)[number];

/**
 * Campaign structure mode — how C-codes from the xlsx are mapped to
 * Google Ads campaigns.
 *
 *   `single_campaign`     — DEFAULT. All C-codes become ad groups inside one
 *                           campaign. One budget, one set of geo/targeting
 *                           settings, consolidated reporting. Recommended for
 *                           single events.
 *
 *   `campaign_per_theme`  — Legacy behaviour. Each C-code maps to its own
 *                           campaign with a separate budget and targeting.
 *                           Useful when you need granular budget control per
 *                           theme (e.g. a season-wide plan with multiple events
 *                           sharing headliners).
 */
export const STRUCTURE_MODES = [
  "single_campaign",
  "campaign_per_theme",
] as const;
export type GoogleSearchStructureMode = (typeof STRUCTURE_MODES)[number];
export const DEFAULT_STRUCTURE_MODE: GoogleSearchStructureMode = "single_campaign";

/**
 * Google Ads location-targeting type:
 *   - `PRESENCE`: only people physically in / regularly in the location.
 *     Recommended for ticketed events — someone in Spain who is merely
 *     "interested" in London can't attend.
 *   - `PRESENCE_OR_INTEREST`: includes people who've shown interest in
 *     the location. Google's default but wasteful for events.
 */
export const GEO_TARGET_TYPES = ["PRESENCE", "PRESENCE_OR_INTEREST"] as const;
export type GoogleSearchGeoTargetType = (typeof GEO_TARGET_TYPES)[number];

export const DEFAULT_GEO_TARGET_TYPE: GoogleSearchGeoTargetType = "PRESENCE";

export interface GoogleSearchGeoTarget {
  location: string;
  bid_modifier_pct?: number | null;
  /** Pre-resolved `geoTargetConstant` resource name set by the wizard preview. */
  resolved_resource_name?: string | null;
  /** Canonical display name from the Google Ads suggest API (e.g. "London, England, United Kingdom"). */
  resolved_name?: string | null;
}

export interface GoogleSearchDateRange {
  since: string;
  until: string;
}

export interface RsaHeadline {
  text: string;
  /** Position lock 1, 2, or 3. Optional — Google rotates unpinned headlines. */
  pin_position?: 1 | 2 | 3 | null;
}

export interface RsaDescription {
  text: string;
  /** Position lock 1 or 2. */
  pin_position?: 1 | 2 | null;
}

// ─── Row types (one per child table) ──────────────────────────────────

export interface GoogleSearchPlan {
  id: string;
  user_id: string;
  event_id: string | null;
  google_ads_account_id: string | null;
  name: string;
  status: GoogleSearchPlanStatus;
  total_budget: number | null;
  bidding_strategy: GoogleSearchBiddingStrategy;
  /**
   * Campaign structure mode. Set at import time (or at plan creation for
   * blank plans) and informs both the wizard UI and the parser.
   *
   * Default: `single_campaign`.
   */
  structure_mode: GoogleSearchStructureMode;
  geo_targets: GoogleSearchGeoTarget[];
  /**
   * Google Ads location-targeting mode. Persists into the existing
   * `geo_targets` jsonb column via a wrapper object — no migration
   * (see `parseGeoTargetsColumn` / `serializeGeoTargetsColumn` in
   * `lib/google-search/geo-targets-codec.ts`).
   *
   * Default: PRESENCE (recommended for ticketed events).
   */
  geo_target_type: GoogleSearchGeoTargetType;
  date_range: GoogleSearchDateRange | null;
  pushed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleSearchCampaign {
  id: string;
  plan_id: string;
  name: string;
  priority: string | null;
  monthly_budget: number | null;
  daily_budget: number | null;
  bid_adjustments: Record<string, unknown>;
  notes: string | null;
  sort_order: number;
  pushed_resource_name: string | null;
  created_at: string;
}

export interface GoogleSearchAdGroup {
  id: string;
  campaign_id: string;
  name: string;
  default_cpc: number | null;
  sort_order: number;
  pushed_resource_name: string | null;
  created_at: string;
}

export interface GoogleSearchKeyword {
  id: string;
  ad_group_id: string;
  keyword: string;
  match_type: GoogleSearchMatchType;
  est_cpc_low: number | null;
  est_cpc_high: number | null;
  intent: string | null;
  notes: string | null;
  pushed_resource_name: string | null;
  created_at: string;
}

export interface GoogleSearchNegative {
  id: string;
  plan_id: string;
  /** null = plan-scoped (shared negative list); set = campaign-scoped. */
  campaign_id: string | null;
  keyword: string;
  match_type: GoogleSearchMatchType;
  reason: string | null;
  pushed_resource_name: string | null;
  created_at: string;
}

export interface GoogleSearchRsa {
  id: string;
  ad_group_id: string;
  headlines: RsaHeadline[];
  descriptions: RsaDescription[];
  final_url: string | null;
  path1: string | null;
  path2: string | null;
  pushed_resource_name: string | null;
  created_at: string;
}

// ─── Composite tree ───────────────────────────────────────────────────

export interface GoogleSearchAdGroupNode extends GoogleSearchAdGroup {
  keywords: GoogleSearchKeyword[];
  rsas: GoogleSearchRsa[];
}

export interface GoogleSearchCampaignNode extends GoogleSearchCampaign {
  ad_groups: GoogleSearchAdGroupNode[];
  /** Campaign-scoped negatives only. Plan-scoped negatives live on the tree root. */
  negatives: GoogleSearchNegative[];
}

export interface GoogleSearchPlanTree {
  plan: GoogleSearchPlan;
  campaigns: GoogleSearchCampaignNode[];
  /** Plan-scoped (shared list) negatives. */
  plan_negatives: GoogleSearchNegative[];
}

// ─── Parser draft (xlsx-import output, no DB ids yet) ─────────────────

/**
 * `*Draft` shapes are the pre-insert version of each row — same fields
 * minus DB-assigned ids / timestamps / pushed metadata. The xlsx
 * importer returns a `GoogleSearchPlanDraftTree`; the CRUD layer's
 * `createGoogleSearchPlanTree` turns it into rows.
 */

export type GoogleSearchPlanDraft = Omit<
  GoogleSearchPlan,
  "id" | "user_id" | "pushed_at" | "created_at" | "updated_at"
>;

export type GoogleSearchCampaignDraft = Omit<
  GoogleSearchCampaign,
  "id" | "plan_id" | "pushed_resource_name" | "created_at"
>;

export type GoogleSearchAdGroupDraft = Omit<
  GoogleSearchAdGroup,
  "id" | "campaign_id" | "pushed_resource_name" | "created_at"
>;

export type GoogleSearchKeywordDraft = Omit<
  GoogleSearchKeyword,
  "id" | "ad_group_id" | "pushed_resource_name" | "created_at"
>;

export type GoogleSearchNegativeDraft = Omit<
  GoogleSearchNegative,
  "id" | "plan_id" | "campaign_id" | "pushed_resource_name" | "created_at"
> & {
  /**
   * Parser scope. The CRUD layer resolves this against the inserted
   * campaign ids before writing the row.
   *   - { scope: "plan" } → plan-scoped negative
   *   - { scope: "campaign", campaign_name: "..." } → maps to that campaign
   */
  scope: { kind: "plan" } | { kind: "campaign"; campaign_name: string };
};

export type GoogleSearchRsaDraft = Omit<
  GoogleSearchRsa,
  "id" | "ad_group_id" | "pushed_resource_name" | "created_at"
>;

export interface GoogleSearchAdGroupDraftNode extends GoogleSearchAdGroupDraft {
  keywords: GoogleSearchKeywordDraft[];
  rsas: GoogleSearchRsaDraft[];
}

export interface GoogleSearchCampaignDraftNode extends GoogleSearchCampaignDraft {
  ad_groups: GoogleSearchAdGroupDraftNode[];
}

export interface GoogleSearchPlanDraftTree {
  plan: GoogleSearchPlanDraft;
  campaigns: GoogleSearchCampaignDraftNode[];
  negatives: GoogleSearchNegativeDraft[];
  /**
   * Non-fatal validation findings from the importer (e.g. headline >30 chars,
   * unknown match type). Surfaced to the wizard so the operator can fix
   * before pushing; the parser never rejects on these.
   */
  warnings: GoogleSearchImportWarning[];
}

export interface GoogleSearchImportWarning {
  /** Stable code so the UI can group / filter. */
  code:
    | "headline_too_long"
    | "description_too_long"
    | "unknown_match_type"
    | "missing_ad_group"
    | "missing_campaign"
    | "empty_keyword"
    | "empty_rsa"
    | "duplicate_keyword"
    /** A H/D row in the Ad Copy tab had no Campaign cell AND no preceding
     *  section header — content was dropped because there's no campaign
     *  to attach it to. */
    | "ad_copy_orphan"
    /** The Negative Keywords tab's header row was not found — entire tab
     *  was skipped. (Defensive: tells the operator why no negatives
     *  imported when they expected some.) */
    | "negatives_header_not_found"
    /** No landing URL found in the Ad Copy / Overview metadata. RSAs
     *  will need a `Default final URL` set in the wizard before push
     *  (Google Ads rejects RSAs without `finalUrls`). */
    | "missing_final_url"
    /** In `single_campaign` mode, a campaign-scoped negative was promoted to
     *  plan-scoped because all C-codes share one campaign and per-C-code
     *  campaign-scope is meaningless. */
    | "campaign_negative_promoted_to_plan";
  message: string;
  /** Free-form context for the wizard to display. */
  context?: Record<string, string | number | null>;
}

// ─── Char limits (codified for reuse) ─────────────────────────────────

export const GOOGLE_SEARCH_LIMITS = {
  HEADLINE_MAX_CHARS: 30,
  DESCRIPTION_MAX_CHARS: 90,
  PATH_MAX_CHARS: 15,
  MIN_HEADLINES_PER_RSA: 3,
  MIN_DESCRIPTIONS_PER_RSA: 2,
} as const;
