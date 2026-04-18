// ─── Meta Graph API response types ──────────────────────────────────────────
// These mirror what the API actually returns (snake_case field names preserved
// where it helps clarity). Used by lib/meta/client.ts and /api/meta/* routes.

/** Returned by GET /me/adaccounts */
export interface MetaAdAccount {
  /** "act_1234567890" */
  id: string;
  name: string;
  /** Numeric portion of the id without the "act_" prefix */
  account_id: string;
  currency: string;
  /**
   * 1 = ACTIVE, 2 = DISABLED, 3 = UNSETTLED, 7 = PENDING_RISK_REVIEW,
   * 9 = IN_GRACE_PERIOD, 100 = PENDING_CLOSURE, 101 = CLOSED
   */
  account_status: number;
  timezone_name: string;
  business?: { id: string; name: string };
}

/**
 * Per-page capability flags inferred from enrichment data and/or launch results.
 * FB source capabilities (likes/engagement) are assumed true until proven
 * otherwise at launch; IG capabilities are inferred from hasInstagramLinked.
 */
export interface PageCapabilities {
  /** Page can be used as a standard page-audience targeting source */
  standardPageAudience: boolean;
  /** Page can be used as a FB Likes engagement custom-audience source */
  fbLikesSource: boolean;
  /** Page can be used as a FB Engagement 365d source */
  fbEngagementSource: boolean;
  /** Page can be used as an IG Followers source */
  igFollowersSource: boolean;
  /** Page can be used as an IG Engagement 365d source */
  igEngagementSource: boolean;
  /** Page is eligible for lookalike seed (at least one source available) */
  lookalikeEligible: boolean;
  /** Per-capability failure reason from the last launch attempt */
  failureReasons?: Partial<Record<
    "fbLikesSource" | "fbEngagementSource" | "igFollowersSource" | "igEngagementSource",
    string
  >>;
}

/** Returned by GET /me/accounts or /{businessId}/owned_pages */
export interface MetaApiPage {
  id: string;
  name: string;
  /** Number of people who like / follow this page */
  fan_count?: number;
  /** Meta category label, e.g. "Musician/band", "Club", "Event" */
  category?: string;
  picture?: { data: { url: string } };
  /** Instagram Business Account linked via the "Switch to professional" / BM flow */
  instagram_business_account?: { id: string };
  /**
   * Instagram account connected via "Connected account" in Page Settings.
   * Present on pages where the user connected a personal IG account rather
   * than a dedicated Business/Creator account. Check this as a fallback when
   * instagram_business_account is absent.
   */
  connected_instagram_account?: { id: string };
  access_token?: string;

  // ── Enriched fields — populated by the /api/meta/pages/enrich phase ──────
  /** CDN URL for the page profile photo */
  pictureUrl?: string;
  /** Facebook follower / fan count (from fan_count enrichment) */
  facebookFollowers?: number;
  /** Resolved IG account id (from whichever field returned data) */
  instagramAccountId?: string;
  /** Instagram display name (Instagram name field, not necessarily @handle) */
  instagramUsername?: string;
  /** Instagram follower count (requires instagram_basic scope; may be null) */
  instagramFollowers?: number;
  /** True if the page has any linked Instagram account */
  hasInstagramLinked?: boolean;
  /**
   * Which Graph API field surfaced the Instagram account.
   * - "instagram_business_account" — standard business IG link
   * - "connected_instagram_account" — personal/creator IG connected via Page Settings
   * - null — no IG linked (or enrichment not yet run)
   */
  igLinkSource?: "instagram_business_account" | "connected_instagram_account" | null;
  /** Capability flags — inferred from enrichment or recorded after launch */
  capabilities?: PageCapabilities;
  /** Genre classification result — populated client-side by genre-classification engine */
  genreClassification?: import("@/lib/genre-classification").PageGenreClassification;
}

/** Paginated result for additional (personal) pages */
export interface MetaApiPageBatch {
  data: MetaApiPage[];
  /** Cursor to pass as `after` in the next request. Null when exhausted. */
  nextCursor: string | null;
  hasMore: boolean;
}

/** Returned by GET /{ad_account_id}/adspixels */
export interface MetaApiPixel {
  id: string;
  name: string;
}

/** Returned when expanding instagram_business_account on a page */
export interface MetaInstagramAccount {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
}

// ─── Entity types (represent data from Meta API / database) ───

export interface AdAccount {
  id: string;
  name: string;
  accountId: string;
  currency: string;
}

export interface MetaPage {
  id: string;
  name: string;
  genre?: string;
  subgenre?: string;
  imageUrl?: string;
  linkedInstagramId?: string;
}

export interface InstagramAccount {
  id: string;
  name: string;
  username: string;
  linkedPageId?: string;
}

export interface MetaPixel {
  id: string;
  name: string;
  pixelId: string;
}

export interface Client {
  id: string;
  name: string;
  adAccountIds: string[];
}

export interface CustomAudience {
  id: string;
  name: string;
  type: "purchaser" | "registration" | "engagement" | "lookalike" | "pixel" | "other";
  approximateSize?: number;
}

export interface SavedAudience {
  id: string;
  name: string;
  approximateSize?: number;
  description?: string;
}

/**
 * Live Meta targetability state for a selected interest.
 * Distinct from `status` (which is the legacy launch-preflight outcome):
 *
 * - `valid`           — confirmed available as a live Meta targeting interest
 *                       (id is Meta-shaped and either came from a confirmed
 *                       Meta entity row or was resolved via /api/meta/interest-validate).
 * - `pending`         — added but not yet validated (transient; background lookup in flight).
 * - `unresolved`      — live Meta lookup found no targetable match. Kept on the
 *                       chip for discovery/persona context only; excluded at launch.
 * - `discovery_only`  — explicitly tagged as a discovery seed (e.g. a hint phrase
 *                       that should never be sent to Meta targeting).
 * - `deprecated`      — was once valid but Meta marked it deprecated.
 */
export type InterestTargetabilityStatus =
  | "valid"
  | "pending"
  | "unresolved"
  | "discovery_only"
  | "deprecated";

export interface InterestSuggestion {
  id: string;
  name: string;
  audienceSize?: number;
  path?: string[];
  /** How this interest entered the group */
  source?: "search" | "suggested" | "manual" | "ai_discovery";
  /** Validation status — set at launch preflight or when explicitly checked */
  status?: "valid" | "deprecated" | "replaced" | "unknown" | "invalid";
  /** Populated when status === "replaced" */
  replacement?: { id: string; name: string } | null;
  /**
   * Live Meta targetability state. Set at add-time (immediately for Meta-confirmed
   * sources) and refreshed by /api/meta/interest-validate when needed. Drives the
   * chip warning state in the UI and the launch-time skip filter. See
   * `lib/interest-targetability.ts` for the helpers that read/write this field.
   */
  targetabilityStatus?: InterestTargetabilityStatus;
  /**
   * Up to 5 nearby valid Meta interests returned by /api/meta/interest-validate
   * when targetabilityStatus === "unresolved". Lets the UI suggest swap targets
   * without re-running a search. Optional and additive; never sent to Meta.
   */
  targetabilityReplacements?: Array<{
    id: string;
    name: string;
    audienceSize?: number;
  }>;
  /** ISO timestamp of the last targetability check (for cache/debug). */
  targetabilityCheckedAt?: string;
}

export type Genre =
  | "Afro House"
  | "Ambient / Downtempo"
  | "Bass Music"
  | "Breakbeat"
  | "Deep House"
  | "Disco / Funk"
  | "Drum & Bass"
  | "Dubstep"
  | "Electro"
  | "Electronic"
  | "Experimental Electronic"
  | "Garage / UK Garage"
  | "Hard Techno"
  | "Lo-Fi House"
  | "Melodic Techno"
  | "Minimal"
  | "Nu Disco / Indie Dance"
  | "Organic House"
  | "Progressive House"
  | "Psytrance"
  | "Tech House"
  | "Techno"
  | "Trance";

export type EngagementType =
  | "fb_likes"
  | "fb_engagement_365d"
  | "ig_followers"
  | "ig_engagement_365d";

export type LookalikeRange = "0-1%" | "1-2%" | "2-3%";

export type CampaignObjective = "purchase" | "registration" | "traffic" | "awareness" | "engagement";

export type BudgetLevel = "ad_set" | "campaign";

export type BudgetType = "daily" | "lifetime";

export type PlacementPreset = "advantage_plus" | "manual";

export type CTAType = "sign_up" | "learn_more" | "book_now";

export type OptimisationGoal =
  | "conversions"
  | "value"
  | "complete_registration"
  | "landing_page_views"
  | "link_clicks"
  | "reach"
  | "impressions"
  | "post_engagement"
  | "video_views";

export type AssetRatio = "1:1" | "4:5" | "9:16";

export type AssetMode = "single" | "dual" | "full";

export type AdSourceType = "new" | "existing_post";

// ─── Placement types ───

export interface PlacementOption {
  id: string;
  label: string;
  platform: "facebook" | "instagram" | "messenger" | "audience_network";
}

// ─── Audience building types ───

/**
 * Rich status record for a single engagement custom audience created during
 * a launch. Persisted on PageAudienceGroup so subsequent launches can reuse
 * existing audiences and track the full readiness lifecycle.
 */
export interface EngagementAudienceStatus {
  /** Meta custom audience ID */
  id: string;
  type: EngagementType;
  /** Facebook page ID this audience was created from */
  pageId: string;
  pageName?: string;
  /** ISO timestamp when the audience was first created */
  createdAt: string;
  /** ISO timestamp of the most recent readiness check */
  lastCheckedAt?: string;
  /** operation_status.code from Meta — 200=ready, 400=processing, 441=populating, 401=error */
  lastReadinessCode?: number;
  lastReadinessDescription?: string;
  /** True once operation_status.code = 200 */
  readyForLookalike: boolean;
  /**
   * True when Meta returned code 441 ("We're finding people who fit your
   * audience criteria…"). The audience exists but is not yet ready to seed
   * a lookalike. Will become ready after Meta finishes populating it.
   */
  populating: boolean;
  /** Lookalike audience ID if a lookalike was successfully created from this source */
  lookalikeId?: string;
}

export interface PageAudienceGroup {
  id: string;
  name: string;
  pageIds: string[];
  engagementTypes: EngagementType[];
  lookalike: boolean;
  /** @deprecated Use lookalikeRanges instead */
  lookalikeRange?: LookalikeRange;
  lookalikeRanges: LookalikeRange[];
  /** User-manually-selected custom audience IDs (from the "Load Custom Audiences" picker) */
  customAudienceIds: string[];
  /**
   * When false, skip engagement custom-audience creation at launch and use
   * this group as a standard page-audience ad set only. Useful when the user
   * knows the pages lack the required Meta event-source permissions.
   * Defaults to true when undefined.
   */
  createEngagementAudiences?: boolean;
  /**
   * Engagement audience IDs auto-created during the launch pipeline (Phase 1.5).
   * Kept separate from customAudienceIds so they don't pollute the user's
   * selection state. Both are merged into custom_audiences targeting at launch.
   */
  engagementAudienceIds?: string[];
  /**
   * Best engagement audience ID per type from the most recent successful run.
   * Simple lookup for Phase 1.75 seed ranking.
   */
  engagementAudiencesByType?: Partial<Record<EngagementType, string>>;
  /**
   * Rich per-audience status records persisted across launches.
   * Each entry tracks creation, readiness, and lookalike outcome for one
   * engagement audience. Used to reuse existing audiences on re-launch and
   * to drive the "Retry lookalikes" flow.
   */
  engagementAudienceStatuses?: EngagementAudienceStatus[];
  /** Populated at launch — IDs of lookalike audiences created in Meta */
  lookalikeAudienceIds?: string[];
}

export interface CustomAudienceGroup {
  id: string;
  name: string;
  audienceIds: string[];
  /** When true, lookalike ad sets will be created from this group's audiences at launch */
  lookalike?: boolean;
  /** Lookalike percentage tiers to create ad sets for (e.g. ["0-1%", "1-2%"]) */
  lookalikeRanges?: LookalikeRange[];
  /**
   * Lookalike audience IDs created at launch, keyed by range string.
   * e.g. { "0-1%": ["123456789012345"] }
   * Populated by Phase 1.75d of the launch pipeline.
   */
  lookalikeAudienceIdsByRange?: Record<string, string[]>;
}

export interface SavedAudienceSelection {
  audienceIds: string[];
}

export interface InterestGroup {
  id: string;
  name: string;
  interests: InterestSuggestion[];
  aiPrompt?: string;
  /**
   * Cluster category used to target AI discovery suggestions.
   * Matches one of the CLUSTER_DEFS labels in interest-discover route.
   * e.g. "Music & Nightlife", "Fashion & Streetwear", etc.
   */
  clusterType?: string;
}

/**
 * A dedicated lookalike-creation group built from pages loaded via the user's
 * own Facebook provider_token ("My Facebook Pages"). Entirely separate from the
 * standard PageAudienceGroup flow:
 *   - one ad set per percentage tier (e.g. "Selected Pages — 1% Lookalike")
 *   - all valid lookalikes for a tier are combined into that one ad set
 *   - pages that fail source audience creation are skipped, not fatal
 */
export interface SelectedPagesLookalikeGroup {
  id: string;
  name: string;
  /** Page IDs from My Facebook Pages to use as lookalike seeds */
  selectedPageIds: string[];
  /** Which engagement types to build source audiences from (e.g. FB Likes, IG Followers) */
  engagementTypes: EngagementType[];
  /** Lookalike percentage tiers to create ad sets for */
  lookalikeRanges: LookalikeRange[];

  // ── Populated at launch — never user-editable ────────────────────────────
  /** engagement audience IDs created at launch, keyed by pageId */
  engagementAudienceIdsByPage?: Record<string, string[]>;
  /** lookalike audience IDs created at launch, keyed by range string (e.g. "0-1%") */
  lookalikeAudienceIdsByRange?: Record<string, string[]>;
  /** Page IDs skipped at launch (source audience creation failed) */
  skippedPageIds?: string[];
  /** Map of pageId → human-readable skip reason */
  skippedReasons?: Record<string, string>;
}

export interface AudienceSettings {
  pageGroups: PageAudienceGroup[];
  customAudienceGroups: CustomAudienceGroup[];
  savedAudiences: SavedAudienceSelection;
  interestGroups: InterestGroup[];
  /**
   * Lookalike groups built from pages loaded via the user's own Facebook token.
   * Each group produces one ad set per configured percentage tier.
   */
  selectedPagesLookalikeGroups: SelectedPagesLookalikeGroup[];
}

// ─── Creative types ───

export type AssetUploadStatus = "pending" | "uploading" | "uploaded" | "error";

/**
 * One aspect-ratio slot inside an AssetVariation.
 * Carries both the upload state and the Meta-specific IDs populated after upload.
 */
export interface Asset {
  id: string;
  aspectRatio: AssetRatio;
  /** Public CDN URL — used for preview and as image_url fallback */
  uploadedUrl?: string;
  /** Thumbnail shown in the UI after upload (same as uploadedUrl for images) */
  thumbnailUrl?: string;
  /** Meta image hash — preferred over image_url in ad creative API calls */
  assetHash?: string;
  /** Meta video ID — required for video_data creative spec */
  videoId?: string;
  uploadStatus: AssetUploadStatus;
  error?: string;
}

export interface AssetVariation {
  id: string;
  name: string;
  /** One slot per aspect ratio required by the creative's assetMode */
  assets: Asset[];
}

export interface CaptionVariant {
  id: string;
  text: string;
}

export interface CreativeIdentity {
  pageId: string;
  instagramAccountId: string;
}

export interface ExistingPostSelection {
  postId: string;
  postPreview?: string;
}

export interface CreativeEnhancementSettings {
  enabled: false;
  textOptimizations: false;
  visualEnhancements: false;
  musicEnhancements: false;
  autoVariations: false;
}

export interface PagePost {
  id: string;
  pageId: string;
  message: string;
  imageUrl?: string;
  createdAt: string;
  type: "photo" | "video" | "link" | "status";
  likes: number;
  comments: number;
  shares: number;
  /** Public URL for the post — populated when the live Graph API is available. */
  permalinkUrl?: string;
  /**
   * Whether Meta considers this post eligible for promotion as an ad.
   * Mirrors the Graph `is_eligible_for_promotion` field; when undefined the
   * post hasn't been checked (e.g. mock data, or older API responses).
   */
  eligibleForPromotion?: boolean;
  /**
   * When `eligibleForPromotion === false`, Meta sometimes returns a
   * human-readable reason via `ineligible_for_promotion_reason`.
   */
  ineligibleReason?: string;
}

export interface AdCreativeDraft {
  id: string;
  name: string;
  sourceType: AdSourceType;
  identity: CreativeIdentity;
  mediaType: "image" | "video";
  assetMode: AssetMode;
  assetVariations: AssetVariation[];
  captions: CaptionVariant[];
  headline: string;
  description: string;
  destinationUrl: string;
  cta: CTAType;
  existingPost?: ExistingPostSelection;
  enhancements: CreativeEnhancementSettings;
  /** Set after a successful POST to Meta — the live ad creative ID */
  metaCreativeId?: string;
}

// ─── Budget & schedule types ───

/**
 * A single Meta geolocation result returned by GET /search?type=adgeolocation.
 * Stores the exact object Meta returns so we can pass it back unchanged.
 */
export interface MetaGeoLocationResult {
  key: string;
  name: string;
  type: "city" | "region" | "country" | "zip" | "geo_market" | "electoral_district";
  country_code: string;
  country_name: string;
  region: string;
  region_id?: number;
  supports_region?: boolean;
  supports_city?: boolean;
}

/**
 * A user-selected location targeting entry.
 * Stores the full Meta location object alongside UI metadata.
 * The same structure is used for presets and manual search selections.
 */
export interface LocationSelection {
  id: string;
  source: "preset" | "search";
  label: string;
  mode: "include" | "exclude";
  locationType: "city" | "country" | "region";
  /** Meta location key — for cities and regions */
  locationKey?: string;
  /** ISO country code — for country-level targeting */
  countryCode?: string;
  radius?: number;
  distanceUnit?: "kilometer" | "mile";
}

/**
 * A group of location selections that together define a single targeting spec.
 * Each group generates its own set of ad sets (one per audience).
 */
export interface LocationTargetingGroup {
  id: string;
  label: string;
  source: "preset" | "manual";
  selections: LocationSelection[];
}

export type LocationPreset = "london_40km" | "uk_excl_london_40km" | "gb_nationwide";

export interface BudgetScheduleSettings {
  budgetLevel: BudgetLevel;
  budgetType: BudgetType;
  budgetAmount: number;
  currency: string;
  startDate: string;
  endDate: string;
  timezone: string;
  /** @deprecated — use locationGroups instead */
  locationPresets?: LocationPreset[];
  /** Unified location model — each group generates separate ad sets */
  locationGroups?: LocationTargetingGroup[];
}

// ─── Ad set suggestions ───

export interface AdSetGeoLocations {
  countries?: string[];
  cities?: { key: string; radius?: number; distance_unit?: "mile" | "kilometer" }[];
  regions?: { key: string }[];
  excluded_geo_locations?: {
    cities?: { key: string; radius?: number; distance_unit?: "mile" | "kilometer" }[];
  };
}

export interface AdSetSuggestion {
  id: string;
  name: string;
  sourceType:
    | "page_group"
    | "custom_group"
    /** Lookalike from a CustomAudienceGroup using pre-existing audiences as seeds */
    | "custom_group_lookalike"
    | "saved_audience"
    | "interest_group"
    | "lookalike_group"
    /** @deprecated Lookalike from My Facebook Pages (SelectedPagesLookalikeGroup) */
    | "selected_pages_lookalike";
  sourceId: string;
  sourceName: string;
  ageMin: number;
  ageMax: number;
  budgetPerDay: number;
  advantagePlus: boolean;
  /** User-controlled toggle — never modified by launch results */
  enabled: boolean;
  /** Per-ad-set geo override; when absent falls back to default GB. */
  geoLocations?: AdSetGeoLocations;
  /** Human label for the location preset, e.g. "London +40km" */
  locationLabel?: string;
  /**
   * For sourceType "selected_pages_lookalike" only — which percentage tier
   * this ad set targets. Used by buildMetaTargeting to look up the correct
   * lookalike audience IDs from SelectedPagesLookalikeGroup.lookalikeAudienceIdsByRange.
   */
  lookalikeRange?: LookalikeRange;
  /**
   * @deprecated Do not use — this field is no longer stamped during launch.
   * Per-run Meta IDs are stored in LaunchSummary.adSetLaunchResults instead.
   */
  metaAdSetId?: string;
}

// ─── Creative assignment ───

export type CreativeAssignmentMatrix = Record<string, string[]>;

// ─── Optimisation rule engine ───

export type OptimisationStrategyMode = "none" | "benchmarks" | "custom";

export type RuleMetric = "cpr" | "cpc" | "cpa" | "roas" | "cpm" | "lpv_cost" | "ctr";

export type RuleTimeWindow = "24h" | "3d" | "7d";

export type RuleAction = "increase_budget" | "decrease_budget" | "pause";

export interface OptimisationThreshold {
  id: string;
  operator: "below" | "between" | "above";
  value: number;
  valueTo?: number;
  action: RuleAction;
  actionValue?: number;
  label: string;
}

export type RulePriority = "primary" | "secondary";

export type BenchmarkTag = "primary" | "secondary" | "reference";

export interface OptimisationRule {
  id: string;
  name: string;
  metric: RuleMetric;
  timeWindow: RuleTimeWindow;
  thresholds: OptimisationThreshold[];
  enabled: boolean;
  priority?: RulePriority;
  accountBenchmarkValue?: number;
  campaignTargetValue?: number;
  useOverride?: boolean;
}

export interface BenchmarkPercentile {
  metric: RuleMetric;
  metricLabel: string;
  currency?: string;
  top25: number;
  median: number;
  bottom25: number;
  tag?: BenchmarkTag;
}

export type CeilingBehaviour = "stop" | "partial" | "pause_scaling";

export interface BudgetGuardrails {
  baseCampaignBudget: number;
  maxExpansionPercent: number;
  hardBudgetCeiling: number;
  ceilingBehaviour: CeilingBehaviour;
  maxSingleAdSetBudget?: number;
  maxSingleAdSetBudgetType?: "fixed" | "percent";
  maxDailyIncreasePercent?: number;
  cooldownHours?: number;
}

export interface OptimisationStrategySettings {
  mode: OptimisationStrategyMode;
  rules: OptimisationRule[];
  guardrails: BudgetGuardrails;
}

// ─── Campaign settings ───

export interface CampaignSettings {
  clientId?: string;
  /** Real Meta ad account ID, e.g. "act_1234567890" */
  adAccountId: string;
  pixelId?: string;
  campaignCode: string;
  campaignName: string;
  objective: CampaignObjective;
  optimisationGoal: OptimisationGoal;
  // ── Meta-resolved identities (set in Account Setup step) ──────────────────
  /** Mirrors adAccountId once the user picks a real Meta account */
  metaAdAccountId?: string;
  /** Primary Facebook Page for this campaign */
  metaPageId?: string;
  /** Primary Meta Pixel for this campaign */
  metaPixelId?: string;
  /** Primary Instagram Business Account for this campaign */
  metaIGAccountId?: string;

  // ── Wizard mode (additive) ────────────────────────────────────────────────
  /**
   * Selected Step-1 mode. Defaults to `"new"` for any draft that pre-dates
   * the attach flows.
   *
   * - `"new"` — wizard creates a brand-new campaign + ad sets + ads at launch.
   * - `"attach_campaign"` — launch skips campaign creation and adds a new ad
   *   set + ads under {@link existingMetaCampaign}.
   * - `"attach_adset"` — launch skips both campaign and ad set creation and
   *   adds new ads under {@link existingMetaAdSet} (which lives under
   *   {@link existingMetaCampaign}). Optimisation, audiences and budget
   *   steps are inherited from the live ad set and skipped in the wizard.
   */
  wizardMode?: WizardMode;

  /**
   * Snapshot of the live Meta campaign chosen via the picker when
   * {@link wizardMode} is `"attach_campaign"` or `"attach_adset"`. Captured at
   * selection time so the review step can show the chosen campaign without
   * re-fetching, and so the launch route can re-validate against the live
   * campaign.
   */
  existingMetaCampaign?: {
    id: string;
    name: string;
    /** Raw Meta objective, e.g. "OUTCOME_ENGAGEMENT". */
    objective: string;
    /** Raw configured status, e.g. "ACTIVE", "PAUSED". */
    status: string;
    /** Raw effective status (delivery state), if returned by Meta. */
    effectiveStatus?: string;
    /** When the picker captured this snapshot. */
    capturedAt: string;
  };

  /**
   * Snapshot of the live Meta ad set chosen via the ad set picker when
   * {@link wizardMode} is `"attach_adset"`. Captured at selection time so
   * the review step can describe what is being inherited and so the launch
   * route can re-verify the ad set before pushing ads under it.
   */
  existingMetaAdSet?: {
    id: string;
    name: string;
    /** Live Meta campaign ID this ad set belongs to. */
    campaignId: string;
    /** Optional display name of the parent campaign at selection time. */
    campaignName?: string;
    /** Raw Meta campaign objective, mirrored for review-time display. */
    objective?: string;
    /** Raw Meta optimization_goal value, e.g. "OFFSITE_CONVERSIONS". */
    optimizationGoal?: string;
    /** Raw Meta billing_event value, e.g. "IMPRESSIONS". */
    billingEvent?: string;
    /** Configured status, e.g. "ACTIVE". */
    status: string;
    /** Delivery state if returned by Meta. */
    effectiveStatus?: string;
    /** When the picker captured this snapshot. */
    capturedAt: string;
  };
}

/** Discriminated wizard mode union. See {@link CampaignSettings.wizardMode}. */
export type WizardMode = "new" | "attach_campaign" | "attach_adset";

// ─── Live Meta campaign list (used by the "Add to existing" picker) ─────────

/**
 * One row returned by `GET /api/meta/campaigns?adAccountId=...`. Shaped for
 * the campaign picker UI: includes raw Meta fields plus a derived
 * `compatible` flag and reason so the UI can mark unselectable rows.
 */
export interface MetaCampaignSummary {
  id: string;
  name: string;
  /** Raw Meta objective string, e.g. "OUTCOME_TRAFFIC". */
  objective: string;
  /** Internal objective if the raw Meta value maps to one we support. */
  internalObjective?: CampaignObjective;
  /** Configured status, e.g. "ACTIVE". */
  status: string;
  /** Delivery state (more granular than `status`). */
  effectiveStatus?: string;
  /** "AUCTION" | "RESERVED". */
  buyingType?: string;
  createdTime?: string;
  updatedTime?: string;
  /** True when this wizard can create a new ad set under this campaign. */
  compatible: boolean;
  /** When `compatible === false`, why. */
  incompatibleReason?: string;
}

/** Cursor-paged response shape for `/api/meta/campaigns`. */
export interface MetaCampaignsResponse {
  data: MetaCampaignSummary[];
  count: number;
  paging: {
    /** Cursor to pass back as `after=` for the next page, if any. */
    after?: string;
    hasMore: boolean;
  };
}

// ─── Live Meta ad set list (used by the "Add to existing ad set" picker) ────

/**
 * One row returned by `GET /api/meta/adsets?campaignId=...`. Shaped for the
 * ad-set picker UI. `compatible` is `false` when the ad set is archived /
 * deleted or otherwise unsuitable for adding new ads.
 */
export interface MetaAdSetSummary {
  id: string;
  name: string;
  campaignId: string;
  /** Raw Meta optimization_goal, e.g. "OFFSITE_CONVERSIONS". */
  optimizationGoal?: string;
  /** Raw Meta billing_event, e.g. "IMPRESSIONS". */
  billingEvent?: string;
  /** Configured status, e.g. "ACTIVE". */
  status: string;
  /** Delivery state (more granular than `status`). */
  effectiveStatus?: string;
  createdTime?: string;
  updatedTime?: string;
  /** True when this wizard can attach new ads under this ad set. */
  compatible: boolean;
  /** When `compatible === false`, why. */
  incompatibleReason?: string;
}

/** Cursor-paged response shape for `/api/meta/adsets`. */
export interface MetaAdSetsResponse {
  data: MetaAdSetSummary[];
  count: number;
  paging: {
    /** Cursor to pass back as `after=` for the next page, if any. */
    after?: string;
    hasMore: boolean;
  };
}

// ─── Launch summary (populated after a successful launch) ───

/** Per-suggestion outcome for a single launch run */
export interface AdSetLaunchResult {
  launchStatus: "created" | "skipped" | "failed";
  /** The live Meta ad set ID — only present when launchStatus === "created" */
  metaAdSetId?: string;
  /** Why the ad set was skipped (e.g. "source audience not ready") */
  skippedReason?: string;
  /** Full error message when launchStatus === "failed" */
  error?: string;
}

export interface LaunchSummary {
  /** Unique identifier for this launch run */
  launchRunId: string;
  metaCampaignId: string;
  /**
   * Per-suggestion launch outcomes for this run.
   * Key = AdSetSuggestion.id. Allows the UI to show per-suggestion
   * status without mutating the editable suggestion objects.
   */
  adSetLaunchResults?: Record<string, AdSetLaunchResult>;
  /** Total launch wall-clock time in milliseconds */
  totalDurationMs?: number;
  /** Per-phase timing in milliseconds */
  phaseDurations?: Record<string, number>;
  /** Preflight warnings surfaced before any mutations */
  preflightWarnings?: { stage: string; message: string }[];
  /** Engagement custom audiences created from page groups (Phase 1.5) */
  engagementAudiencesCreated?: { name: string; id: string; type: string; durationMs?: number }[];
  engagementAudiencesFailed?: {
    name: string;
    type: string;
    error: string;
    /** Source page ID — used to persist capability failures after launch */
    pageId?: string;
    /** True when the failure was due to a missing event-source permission */
    isPermissionFailure?: boolean;
  }[];
  /** Lookalike audiences created from engagement audiences (Phase 1.75) */
  lookalikeAudiencesCreated?: { name: string; id: string; range: string; durationMs?: number }[];
  lookalikeAudiencesFailed?: { name: string; range: string; error: string; skippedReason?: string }[];
  /**
   * Lookalikes deferred because the source audience exists but is still
   * being populated by Meta (code 441). These can be retried via the
   * "Retry lookalikes" action once Meta finishes populating.
   */
  lookalikesDeferred?: {
    name: string;
    range: string;
    seedAudienceId: string;
    seedType: string;
    pageGroupId: string;
    reason: string;
  }[];
  /**
   * Updated engagement audience statuses to persist back to the draft.
   * Wizard-shell applies these after a launch so the next launch/retry
   * has accurate readiness info without re-creating audiences.
   */
  updatedEngagementStatuses?: Array<{
    groupId: string;
    statuses: EngagementAudienceStatus[];
  }>;
  /**
   * Lookalike audience IDs created for custom audience groups (Phase 1.75d).
   * Wizard-shell persists these back to draft.audiences.customAudienceGroups.
   */
  updatedCustomGroupLookalikes?: Array<{
    groupId: string;
    lookalikeAudienceIdsByRange: Record<string, string[]>;
  }>;
  /** Deprecated interests that were auto-replaced during ad set creation */
  interestReplacements?: { deprecated: string; replacement: string | null; adSetName: string }[];
  /**
   * Selected interests excluded from launch because their `targetabilityStatus`
   * was not `valid` (e.g. unresolved/discovery_only/deprecated). Non-blocking —
   * the launch still proceeds; the UI surfaces a count so the user knows.
   */
  interestsSkippedNotTargetable?: {
    count: number;
    items: Array<{
      adSetName: string;
      groupId?: string;
      name: string;
      status: InterestTargetabilityStatus;
    }>;
  };
  /**
   * Final pre-launch hardcoded sanitisation telemetry. Populated when the
   * last-line-of-defence sanitiser ran against any ad set immediately before
   * `createMetaAdSet`, or when a deprecated-interest retry was attempted
   * after a Meta create failure (e.g. subcode 1870247).
   */
  launchInterestSanitization?: {
    finalLaunchInterestSanitizationApplied: boolean;
    launchRemovedDeprecatedInterests: Array<{ adSetName: string; name: string; reason: string }>;
    launchReplacedDeprecatedInterests: Array<{ adSetName: string; deprecated: string; replacementSearchName: string }>;
    launchRetryAttempted: number;
    launchRetrySucceeded: number;
  };
  adSetsCreated: {
    name: string;
    metaAdSetId: string;
    /** "strict" when Advantage+ was OFF, "suggested" when Advantage+ was ON */
    ageMode: "strict" | "suggested";
    durationMs?: number;
  }[];
  adSetsFailed: { name: string; error: string; skippedReason?: string }[];
  creativesCreated: {
    name: string;
    metaCreativeId: string;
    /** "page_only" or "page_and_ig" */
    identityMode?: "page_only" | "page_and_ig";
    durationMs?: number;
    ads: { adSetName: string; metaAdId: string; durationMs?: number }[];
    adsFailed: { adSetName: string; error: string }[];
  }[];
  creativesFailed: { name: string; error: string; skippedReason?: string }[];
  adsCreated: number;
  adsFailed: number;
}

// ─── Top-level campaign draft ───

export interface CampaignDraft {
  id: string;
  settings: CampaignSettings;
  audiences: AudienceSettings;
  creatives: AdCreativeDraft[];
  optimisationStrategy: OptimisationStrategySettings;
  budgetSchedule: BudgetScheduleSettings;
  adSetSuggestions: AdSetSuggestion[];
  creativeAssignments: CreativeAssignmentMatrix;
  status: "draft" | "published" | "archived";
  /** Set after a successful POST to Meta — the live campaign ID (e.g. "23849562890000") */
  metaCampaignId?: string;
  /** Populated after launch — records what was created and what failed */
  launchSummary?: LaunchSummary;
  createdAt: string;
  updatedAt: string;
}

// ─── Campaign list item (lightweight, for library view) ───

export interface CampaignListItem {
  id: string;
  name: string | null;
  objective: string | null;
  status: CampaignDraft["status"];
  adAccountId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Wizard state ───

export type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WIZARD_STEPS = [
  { label: "Account", description: "Setup accounts" },
  { label: "Campaign", description: "Configure campaign" },
  { label: "Optimisation", description: "Performance rules" },
  { label: "Audiences", description: "Build audiences" },
  { label: "Creatives", description: "Create ads" },
  { label: "Budget", description: "Budget & schedule" },
  { label: "Assign", description: "Assign creatives" },
  { label: "Review", description: "Review & launch" },
] as const;

/**
 * Internal ad-set suggestion id used as the matrix key when the wizard is in
 * `attach_adset` mode. Lets the assign-creatives step + launch route reason
 * about the synthetic "attached" ad set without polluting
 * {@link CampaignDraft.adSetSuggestions} with stub data.
 */
export const ATTACHED_AD_SET_ID = "__attached_existing__";

/**
 * Returns the wizard step indices that should be visible (and validated) for
 * a given mode. `attach_adset` skips Optimisation, Audiences and Budget
 * because those are inherited from the live ad set.
 */
export function getVisibleSteps(mode: WizardMode | undefined): WizardStep[] {
  if (mode === "attach_adset") return [0, 1, 4, 6, 7];
  return [0, 1, 2, 3, 4, 5, 6, 7];
}

export type AudienceTab = "pages" | "custom" | "saved" | "interests";

// ─── Campaign templates ───

export interface CampaignTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  snapshot: Omit<CampaignDraft, "id" | "status" | "createdAt" | "updatedAt">;
  createdAt: string;
  updatedAt: string;
}
