export type TikTokDraftStatus = "draft" | "published" | "archived";

export interface TikTokCampaignDraft {
  id: string;
  clientId: string | null;
  eventId: string | null;
  status: TikTokDraftStatus;
  accountSetup: TikTokAccountSetup;
  campaignSetup: TikTokCampaignSetup;
  optimisation: TikTokOptimisation;
  audiences: TikTokAudiences;
  creatives: TikTokCreatives;
  budgetSchedule: TikTokBudgetSchedule;
  creativeAssignments: TikTokCreativeAssignments;
  /**
   * Unused by the launcher. TikTok writes always send `is_aco: false` and
   * `creative_authorized: false`. Kept so older draft JSON still loads.
   */
  creativeIntegrityMode: boolean;
  publishedIds: TikTokPublishedIds | null;
  reviewReadyAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TikTokPublishedIds {
  campaignId: string;
  adgroupIds: string[];
  adIds: string[];
}

export interface TikTokAccountSetup {
  tiktokAccountId: string | null;
  advertiserId: string | null;
  identityId: string | null;
  identityDisplayName: string | null;
  identityManualName: string | null;
  /** Business Center id required by TikTok when identity_type is BC_AUTH_TT. */
  identityBcId: string | null;
  identityType:
    | "AUTH_CODE"
    | "BC_AUTH_TT"
    | "CUSTOMIZED_USER"
    | "TT_USER"
    | "MANUAL"
    | null;
  pixelId: string | null;
  pixelName: string | null;
  /**
   * TikTok `optimization_event` sourced from `/pixel/list/` for this pixel.
   * Required for WEB_CONVERSIONS. Never a hardcoded enum.
   */
  optimisationEvent: string | null;
  /** ISO 4217 from `/advertiser/info/`. Used to qualify the budget floor. */
  currency: string | null;
}

export type TikTokObjective =
  | "TRAFFIC"
  | "CONVERSIONS"
  | "VIDEO_VIEWS"
  | "REACH"
  | "AWARENESS"
  | "ENGAGEMENT";

export type TikTokOptimisationGoal =
  | "CLICK"
  | "LANDING_PAGE_VIEW"
  | "CONVERSION"
  | "VALUE"
  | "VIDEO_VIEW"
  | "VIEW_6_SECOND"
  | "REACH"
  | "SHOW"
  | "ENGAGEMENT";

export type TikTokBidStrategy = "COST_CAP" | "LOWEST_COST" | "SMART_PLUS";

export interface TikTokCampaignSetup {
  campaignName: string;
  eventCode: string | null;
  objective: TikTokObjective | null;
  optimisationGoal: TikTokOptimisationGoal | null;
  bidStrategy: TikTokBidStrategy | null;
}

export interface TikTokOptimisation {
  smartPlusEnabled: boolean;
  bidStrategy: TikTokBidStrategy | null;
  benchmarkCpv: number | null;
  benchmarkCpc: number | null;
  benchmarkCpm: number | null;
  pacing: "STANDARD" | "ACCELERATED";
  maxDailySpend: number | null;
  maxLifetimeSpend: number | null;
  guardrails: string[];
}

export type TikTokTargetingAudienceType =
  | "GENERAL_INTEREST"
  | "PURCHASE_INTENTION";

export interface TikTokTargetingItem {
  id: string;
  name: string;
  kind?: "category" | "keyword";
  audienceType?: TikTokTargetingAudienceType;
  audienceSize?: number | null;
}

export interface TikTokInterestGroup {
  id: string;
  name: string;
  interestIds: TikTokTargetingItem[];
  hashtagIds: TikTokTargetingItem[];
  behaviourIds: TikTokTargetingItem[];
}

export interface TikTokAudiences {
  interestGroups: TikTokInterestGroup[];
  interestCategoryIds: string[];
  interestCategoryLabels: Record<string, string>;
  interestKeywordIds: string[];
  behaviourCategoryIds: string[];
  behaviourCategoryLabels: Record<string, string>;
  customAudienceIds: string[];
  customAudienceLabels: Record<string, string>;
  lookalikeAudienceIds: string[];
  lookalikeAudienceLabels: Record<string, string>;
  locationCodes: string[];
  locationLabels: Record<string, string>;
  languageLabels: Record<string, string>;
  ageMin: number;
  ageMax: number;
  genders: Array<"MALE" | "FEMALE" | "UNKNOWN">;
  languages: string[];
}

export interface TikTokCreativeDraft {
  id: string;
  name: string;
  mode: "VIDEO_REFERENCE" | "SPARK_AD";
  baseName: string;
  videoId: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  /** ISO timestamp. TikTok cover/preview URLs are valid for six hours. */
  thumbnailExpiresAt?: string | null;
  /** TikTok Asset Library image id for the video cover (`image_ids` on /ad/create/). */
  coverImageId?: string | null;
  durationSeconds: number | null;
  title: string | null;
  sparkPostId: string | null;
  caption: string;
  adText: string;
  displayName: string;
  landingPageUrl: string;
  cta: string | null;
  musicId: string | null;
}

export interface TikTokCreatives {
  items: TikTokCreativeDraft[];
}

export interface TikTokAdGroupDraft {
  id: string;
  name: string;
  budget: number | null;
  startAt: string | null;
  endAt: string | null;
  interestGroupId?: string | null;
}

export interface TikTokBudgetSchedule {
  budgetMode: "DAILY" | "LIFETIME";
  budgetAmount: number | null;
  scheduleStartAt: string | null;
  scheduleEndAt: string | null;
  automaticSchedule: boolean;
  frequencyCap: number | null;
  lifetimeBudget: number | null;
  dailyBudget: number | null;
  adGroups: TikTokAdGroupDraft[];
}

export interface TikTokCreativeAssignments {
  byAdGroupId: Record<string, string[]>;
}

export function createDefaultTikTokDraft(id: string): TikTokCampaignDraft {
  const now = new Date().toISOString();
  return {
    id,
    clientId: null,
    eventId: null,
    status: "draft",
    accountSetup: {
      tiktokAccountId: null,
      advertiserId: null,
      identityId: null,
      identityDisplayName: null,
      identityManualName: null,
      identityBcId: null,
      identityType: null,
      pixelId: null,
      pixelName: null,
      optimisationEvent: null,
      currency: null,
    },
    campaignSetup: {
      campaignName: "",
      eventCode: null,
      objective: null,
      optimisationGoal: null,
      bidStrategy: null,
    },
    optimisation: {
      smartPlusEnabled: false,
      bidStrategy: null,
      benchmarkCpv: null,
      benchmarkCpc: null,
      benchmarkCpm: null,
      pacing: "STANDARD",
      maxDailySpend: null,
      maxLifetimeSpend: null,
      guardrails: [],
    },
    audiences: defaultTikTokAudiences(),
    creatives: { items: [] },
    budgetSchedule: {
      budgetMode: "DAILY",
      budgetAmount: null,
      scheduleStartAt: null,
      scheduleEndAt: null,
      automaticSchedule: false,
      frequencyCap: null,
      lifetimeBudget: null,
      dailyBudget: null,
      adGroups: [],
    },
    creativeAssignments: { byAdGroupId: {} },
    creativeIntegrityMode: true,
    publishedIds: null,
    reviewReadyAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultTikTokAudiences(): TikTokAudiences {
  return {
    interestGroups: [],
    interestCategoryIds: [],
    interestCategoryLabels: {},
    interestKeywordIds: [],
    behaviourCategoryIds: [],
    behaviourCategoryLabels: {},
    customAudienceIds: [],
    customAudienceLabels: {},
    lookalikeAudienceIds: [],
    lookalikeAudienceLabels: {},
    locationCodes: ["GB"],
    locationLabels: {},
    languageLabels: {},
    ageMin: 18,
    ageMax: 65,
    genders: [],
    languages: ["en"],
  };
}

export function normalizeTikTokAudiences(
  raw: Partial<TikTokAudiences> | null | undefined,
): TikTokAudiences {
  const base = defaultTikTokAudiences();
  if (!raw || typeof raw !== "object") return base;
  return {
    ...base,
    ...raw,
    interestGroups: Array.isArray(raw.interestGroups)
      ? raw.interestGroups
          .map(normalizeTikTokInterestGroup)
          .filter((group): group is TikTokInterestGroup => group != null)
      : [],
    interestCategoryIds: asStringArray(raw.interestCategoryIds),
    interestKeywordIds: asStringArray(raw.interestKeywordIds),
    behaviourCategoryIds: asStringArray(raw.behaviourCategoryIds),
    customAudienceIds: asStringArray(raw.customAudienceIds),
    lookalikeAudienceIds: asStringArray(raw.lookalikeAudienceIds),
    locationCodes: asStringArray(raw.locationCodes, base.locationCodes),
    languages: asStringArray(raw.languages, base.languages),
    interestCategoryLabels: asStringRecord(raw.interestCategoryLabels),
    behaviourCategoryLabels: asStringRecord(raw.behaviourCategoryLabels),
    customAudienceLabels: asStringRecord(raw.customAudienceLabels),
    lookalikeAudienceLabels: asStringRecord(raw.lookalikeAudienceLabels),
    locationLabels: asStringRecord(raw.locationLabels),
    languageLabels: asStringRecord(raw.languageLabels),
    genders: Array.isArray(raw.genders)
      ? raw.genders.filter(
          (value): value is TikTokAudiences["genders"][number] =>
            value === "MALE" || value === "FEMALE" || value === "UNKNOWN",
        )
      : [],
    ageMin: typeof raw.ageMin === "number" ? raw.ageMin : base.ageMin,
    ageMax: typeof raw.ageMax === "number" ? raw.ageMax : base.ageMax,
  };
}

function normalizeTikTokInterestGroup(
  raw: TikTokInterestGroup,
): TikTokInterestGroup | null {
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  return {
    id: String(raw.id),
    name: typeof raw.name === "string" ? raw.name : "",
    interestIds: asTargetingItems(raw.interestIds),
    hashtagIds: asTargetingItems(raw.hashtagIds),
    behaviourIds: asTargetingItems(raw.behaviourIds),
  };
}

function asTargetingItems(value: unknown): TikTokTargetingItem[] {
  if (!Array.isArray(value)) return [];
  const items: TikTokTargetingItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as TikTokTargetingItem;
    if (!record.id) continue;
    items.push({
      id: String(record.id),
      name: typeof record.name === "string" ? record.name : String(record.id),
      kind: record.kind === "keyword" ? "keyword" : "category",
      audienceType:
        record.audienceType === "PURCHASE_INTENTION"
          ? "PURCHASE_INTENTION"
          : record.audienceType === "GENERAL_INTEREST"
            ? "GENERAL_INTEREST"
            : undefined,
      audienceSize:
        typeof record.audienceSize === "number" ? record.audienceSize : null,
    });
  }
  return items;
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : fallback;
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export const TIKTOK_WIZARD_STEPS = [
  "Account setup",
  "Campaign setup",
  "Optimisation strategy",
  "Audiences",
  "Creatives",
  "Budget & schedule",
  "Assign creatives",
  "Review & launch",
] as const;
