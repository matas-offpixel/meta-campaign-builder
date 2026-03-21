import type {
  CampaignDraft,
  AdCreativeDraft,
  AssetVariation,
  CaptionVariant,
  CreativeEnhancementSettings,
  OptimisationStrategySettings,
} from "./types";

const ENHANCEMENTS_OFF: CreativeEnhancementSettings = {
  enabled: false,
  textOptimizations: false,
  visualEnhancements: false,
  musicEnhancements: false,
  autoVariations: false,
};

export function createDefaultDraft(): CampaignDraft {
  return {
    id: crypto.randomUUID(),
    settings: {
      clientId: "",
      adAccountId: "",
      pixelId: "",
      campaignCode: "",
      campaignName: "",
      objective: "purchase",
      optimisationGoal: "conversions",
    },
    audiences: {
      pageGroups: [],
      customAudienceGroups: [],
      savedAudiences: { audienceIds: [] },
      interestGroups: [],
    },
    creatives: [],
    optimisationStrategy: createDefaultOptimisationStrategy(),
    budgetSchedule: {
      budgetLevel: "ad_set",
      budgetType: "daily",
      budgetAmount: 50,
      currency: "GBP",
      startDate: "",
      endDate: "",
      timezone: "Europe/London",
    },
    adSetSuggestions: [],
    creativeAssignments: {},
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function createDefaultAssetVariation(): AssetVariation {
  return {
    id: crypto.randomUUID(),
    name: "",
    assets: {},
  };
}

export function createDefaultCaption(): CaptionVariant {
  return {
    id: crypto.randomUUID(),
    text: "",
  };
}

export function createDefaultBudgetGuardrails(baseBudget = 50): OptimisationStrategySettings["guardrails"] {
  return {
    baseCampaignBudget: baseBudget,
    maxExpansionPercent: 100,
    hardBudgetCeiling: baseBudget * 2,
    ceilingBehaviour: "stop",
  };
}

export function createDefaultOptimisationStrategy(): OptimisationStrategySettings {
  return {
    mode: "benchmarks",
    rules: [],
    guardrails: createDefaultBudgetGuardrails(),
  };
}

export function createDefaultCreative(): AdCreativeDraft {
  return {
    id: crypto.randomUUID(),
    name: "",
    sourceType: "new",
    identity: {
      pageId: "",
      instagramAccountId: "",
    },
    mediaType: "image",
    assetMode: "dual",
    assetVariations: [createDefaultAssetVariation()],
    captions: [createDefaultCaption()],
    headline: "",
    description: "",
    destinationUrl: "",
    cta: "book_now",
    enhancements: { ...ENHANCEMENTS_OFF },
  };
}
