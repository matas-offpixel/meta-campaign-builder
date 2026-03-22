import type {
  CampaignDraft,
  AdCreativeDraft,
  AssetVariation,
  Asset,
  AssetRatio,
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
      metaAdAccountId: undefined,
      metaPageId: undefined,
      metaPixelId: undefined,
      metaIGAccountId: undefined,
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

/** Create one Asset slot for a given aspect ratio, starting at "pending". */
export function createDefaultAsset(aspectRatio: AssetRatio): Asset {
  return {
    id: crypto.randomUUID(),
    aspectRatio,
    uploadStatus: "pending",
  };
}

/**
 * Create an AssetVariation pre-populated with the correct slots for the given ratios.
 * Always call with the ratios returned by getAspectRatioSlots(mediaType, assetMode).
 */
export function createDefaultAssetVariation(ratios: AssetRatio[]): AssetVariation {
  return {
    id: crypto.randomUUID(),
    name: "",
    assets: ratios.map(createDefaultAsset),
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
  // Default mode is "dual" → 4:5 + 9:16
  const defaultVariation = createDefaultAssetVariation(["4:5", "9:16"]);
  defaultVariation.name = "Variation 1";

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
    assetVariations: [defaultVariation],
    captions: [createDefaultCaption()],
    headline: "",
    description: "",
    destinationUrl: "",
    cta: "book_now",
    enhancements: { ...ENHANCEMENTS_OFF },
  };
}
