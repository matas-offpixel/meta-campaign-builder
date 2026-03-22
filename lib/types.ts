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

/** Returned by GET /me/accounts (pages the token user manages) */
export interface MetaApiPage {
  id: string;
  name: string;
  picture?: { data: { url: string } };
  instagram_business_account?: { id: string };
  access_token?: string;
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
  lookalikeRange: LookalikeRange;
  customAudienceIds: string[];
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
}

export interface AudienceSettings {
  pageGroups: PageAudienceGroup[];
  customAudienceGroups: CustomAudienceGroup[];
  savedAudiences: SavedAudienceSelection;
  interestGroups: InterestGroup[];
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

export interface LocationTarget {
  id: string;
  name: string;
  radius?: number;
  radiusUnit?: "km" | "mi";
  excluded?: boolean;
}

export interface BudgetScheduleSettings {
  budgetLevel: BudgetLevel;
  budgetType: BudgetType;
  budgetAmount: number;
  currency: string;
  startDate: string;
  endDate: string;
  timezone: string;
}

// ─── Ad set suggestions ───

export interface AdSetSuggestion {
  id: string;
  name: string;
  sourceType: "page_group" | "custom_group" | "saved_audience" | "interest_group";
  sourceId: string;
  sourceName: string;
  ageMin: number;
  ageMax: number;
  budgetPerDay: number;
  advantagePlus: boolean;
  enabled: boolean;
  /** Set after a successful POST to Meta — the live ad set ID */
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

export interface LaunchSummary {
  metaCampaignId: string;
  adSetsCreated: { name: string; metaAdSetId: string }[];
  adSetsFailed: { name: string; error: string }[];
  creativesCreated: {
    name: string;
    metaCreativeId: string;
    ads: { adSetName: string; metaAdId: string }[];
    adsFailed: { adSetName: string; error: string }[];
  }[];
  creativesFailed: { name: string; error: string }[];
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
