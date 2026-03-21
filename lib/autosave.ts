import type { CampaignDraft, AdCreativeDraft } from "./types";

const STORAGE_KEY = "campaign_draft";

const DEFAULT_ENHANCEMENTS = {
  enabled: false as const,
  textOptimizations: false as const,
  visualEnhancements: false as const,
  musicEnhancements: false as const,
  autoVariations: false as const,
};

/**
 * Migrate a creative loaded from storage to ensure all fields exist.
 * Handles drafts saved under older schemas that lack newer fields.
 */
function migrateCreative(c: Partial<AdCreativeDraft> & { id: string }): AdCreativeDraft {
  return {
    id: c.id,
    name: c.name ?? "",
    sourceType: c.sourceType ?? "new",
    identity: c.identity ?? { pageId: "", instagramAccountId: "" },
    mediaType: c.mediaType ?? "image",
    assetMode: c.assetMode ?? "dual",
    assetVariations: Array.isArray(c.assetVariations) && c.assetVariations.length > 0
      ? c.assetVariations
      : [{ id: crypto.randomUUID(), name: "", assets: (c as Record<string, unknown>).assets ?? {} }],
    captions: Array.isArray(c.captions) && c.captions.length > 0
      ? c.captions
      : [{ id: crypto.randomUUID(), text: (c as Record<string, unknown>).primaryText as string ?? "" }],
    headline: c.headline ?? "",
    description: c.description ?? "",
    destinationUrl: c.destinationUrl ?? "",
    cta: c.cta ?? "book_now",
    existingPost: c.existingPost,
    enhancements: c.enhancements ?? { ...DEFAULT_ENHANCEMENTS },
  };
}

/**
 * Migrate a full draft to ensure all top-level and nested fields exist.
 */
function migrateDraft(raw: Record<string, unknown>): CampaignDraft {
  const draft = raw as unknown as CampaignDraft;

  if (Array.isArray(draft.creatives)) {
    draft.creatives = draft.creatives.map((c) => migrateCreative(c));
  } else {
    draft.creatives = [];
  }

  draft.audiences = draft.audiences ?? {
    pageGroups: [],
    customAudienceGroups: [],
    savedAudiences: { audienceIds: [] },
    interestGroups: [],
  };
  draft.budgetSchedule = draft.budgetSchedule ?? {
    budgetLevel: "ad_set",
    budgetType: "daily",
    budgetAmount: 50,
    currency: "GBP",
    startDate: "",
    endDate: "",
    timezone: "Europe/London",
  };
  const defaultGuardrails = {
    baseCampaignBudget: draft.budgetSchedule?.budgetAmount ?? 50,
    maxExpansionPercent: 100,
    hardBudgetCeiling: (draft.budgetSchedule?.budgetAmount ?? 50) * 2,
    ceilingBehaviour: "stop" as const,
  };
  if (draft.optimisationStrategy) {
    draft.optimisationStrategy.guardrails = draft.optimisationStrategy.guardrails ?? defaultGuardrails;
  } else {
    draft.optimisationStrategy = {
      mode: "benchmarks",
      rules: [],
      guardrails: defaultGuardrails,
    };
  }
  draft.adSetSuggestions = draft.adSetSuggestions ?? [];
  draft.creativeAssignments = draft.creativeAssignments ?? {};

  return draft;
}

export function saveDraftToStorage(draft: CampaignDraft): void {
  try {
    const data = JSON.stringify(draft);
    localStorage.setItem(STORAGE_KEY, data);
  } catch {
    console.warn("Failed to save draft to localStorage");
  }
}

export function loadDraftFromStorage(): CampaignDraft | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    const raw = JSON.parse(data);
    return migrateDraft(raw);
  } catch {
    return null;
  }
}

export function clearDraftFromStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}
