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
  reviewReadyAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TikTokAccountSetup {
  tiktokAccountId: string | null;
  advertiserId: string | null;
  identityId: string | null;
  identityDisplayName: string | null;
  identityManualName: string | null;
  identityType: "PERSONAL_HUB" | "CUSTOMIZED_USER" | "TT_USER" | "MANUAL" | null;
  pixelId: string | null;
  pixelName: string | null;
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

export interface TikTokAudiences {
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
  ageMin: number;
  ageMax: number;
  genders: Array<"MALE" | "FEMALE" | "UNKNOWN">;
  languages: string[];
  estimatedReach: number | null;
}

export interface TikTokCreativeDraft {
  id: string;
  name: string;
  mode: "VIDEO_REFERENCE" | "SPARK_AD";
  baseName: string;
  videoId: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
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
      identityType: null,
      pixelId: null,
      pixelName: null,
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
    audiences: {
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
      ageMin: 18,
      ageMax: 65,
      genders: [],
      languages: ["en"],
      estimatedReach: null,
    },
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
    reviewReadyAt: null,
    createdAt: now,
    updatedAt: now,
  };
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
