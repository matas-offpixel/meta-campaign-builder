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

export interface InterestSuggestion {
  id: string;
  name: string;
  audienceSize?: number;
  path?: string[];
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
  /** Populated at launch — IDs of lookalike audiences created in Meta */
  lookalikeAudienceIds?: string[];
}

export interface CustomAudienceGroup {
  id: string;
  name: string;
  audienceIds: string[];
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
    | "saved_audience"
    | "interest_group"
    | "lookalike_group"
    /** Lookalike from My Facebook Pages (SelectedPagesLookalikeGroup) */
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
  /** Deprecated interests that were auto-replaced during ad set creation */
  interestReplacements?: { deprecated: string; replacement: string | null; adSetName: string }[];
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
