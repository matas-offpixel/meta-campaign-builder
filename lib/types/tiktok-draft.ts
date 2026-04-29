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
  benchmarkCpt: number | null;
  benchmarkCtr: number | null;
  guardrails: string[];
}

export interface TikTokAudiences {
  interestCategoryIds: string[];
  interestKeywordIds: string[];
  behaviourCategoryIds: string[];
  customAudienceIds: string[];
  lookalikeAudienceIds: string[];
}

export interface TikTokCreativeDraft {
  id: string;
  name: string;
  mode: "upload" | "url" | "spark_ad";
  videoUrl: string | null;
  sparkPostId: string | null;
  caption: string;
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
      benchmarkCpt: null,
      benchmarkCtr: null,
      guardrails: [],
    },
    audiences: {
      interestCategoryIds: [],
      interestKeywordIds: [],
      behaviourCategoryIds: [],
      customAudienceIds: [],
      lookalikeAudienceIds: [],
    },
    creatives: { items: [] },
    budgetSchedule: {
      lifetimeBudget: null,
      dailyBudget: null,
      adGroups: [],
    },
    creativeAssignments: { byAdGroupId: {} },
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
