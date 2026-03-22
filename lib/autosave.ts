import type { CampaignDraft, AdCreativeDraft, AssetVariation, Asset, AssetRatio } from "./types";

const STORAGE_KEY = "campaign_draft";

const DEFAULT_ENHANCEMENTS = {
  enabled: false as const,
  textOptimizations: false as const,
  visualEnhancements: false as const,
  musicEnhancements: false as const,
  autoVariations: false as const,
};

// ─── Asset migration ───────────────────────────────────────────────────────────

/**
 * Ensure a single Asset entry has all required fields.
 * Handles drafts from before the AssetUploadStatus model existed.
 */
function migrateAsset(raw: Partial<Asset>): Asset {
  return {
    id: raw.id ?? crypto.randomUUID(),
    aspectRatio: raw.aspectRatio ?? "4:5",
    uploadedUrl: raw.uploadedUrl,
    thumbnailUrl: raw.thumbnailUrl,
    assetHash: raw.assetHash,
    videoId: raw.videoId,
    uploadStatus: raw.uploadStatus ?? "pending",
    error: raw.error,
  };
}

/**
 * Migrate one AssetVariation regardless of which schema it was stored under.
 *
 * Old schema  (Phase 5 and earlier):
 *   assets: { "4:5"?: string, "9:16"?: string, "1:1"?: string }   ← Record<ratio, URL>
 *   assetMeta?: { "4:5"?: { hash?, videoId?, previewUrl? }, … }
 *
 * New schema  (Phase 6+):
 *   assets: Asset[]
 */
function migrateAssetVariation(raw: Record<string, unknown>): AssetVariation {
  const rawAssets = raw.assets;

  let assets: Asset[];

  if (Array.isArray(rawAssets)) {
    // Already the new format — just ensure every field exists
    assets = (rawAssets as Partial<Asset>[]).map(migrateAsset);
  } else if (rawAssets && typeof rawAssets === "object") {
    // Old Record<ratio, URL> format — convert to Asset[]
    const oldRecord = rawAssets as Record<string, string>;
    const oldMeta = (raw.assetMeta ?? {}) as Record<
      string,
      { hash?: string; videoId?: string; previewUrl?: string }
    >;

    assets = (Object.keys(oldRecord) as AssetRatio[]).map((ratio) => {
      const url = oldRecord[ratio];
      const meta = oldMeta[ratio] ?? {};
      const isReal = url?.startsWith("http") || !!meta.hash || !!meta.videoId;
      return {
        id: crypto.randomUUID(),
        aspectRatio: ratio,
        uploadedUrl: url?.startsWith("http") ? url : undefined,
        thumbnailUrl: meta.previewUrl ?? (url?.startsWith("http") ? url : undefined),
        assetHash: meta.hash,
        videoId: meta.videoId,
        uploadStatus: isReal ? ("uploaded" as const) : ("pending" as const),
      };
    });
  } else {
    assets = [];
  }

  return {
    id: (raw.id as string) ?? crypto.randomUUID(),
    name: (raw.name as string) ?? "",
    assets,
  };
}

// ─── Creative migration ───────────────────────────────────────────────────────

/**
 * Migrate a creative loaded from storage to ensure all fields exist.
 * Handles drafts saved under older schemas that lack newer fields.
 */
function migrateCreative(c: Partial<AdCreativeDraft> & { id: string }): AdCreativeDraft {
  const rawVariations = Array.isArray(c.assetVariations)
    ? c.assetVariations
    : [];

  const assetVariations =
    rawVariations.length > 0
      ? rawVariations.map((v) =>
          migrateAssetVariation(v as unknown as Record<string, unknown>),
        )
      : [
          {
            id: crypto.randomUUID(),
            name: "Variation 1",
            assets: [],
          },
        ];

  return {
    id: c.id,
    name: c.name ?? "",
    sourceType: c.sourceType ?? "new",
    identity: c.identity ?? { pageId: "", instagramAccountId: "" },
    mediaType: c.mediaType ?? "image",
    assetMode: c.assetMode ?? "dual",
    assetVariations,
    captions:
      Array.isArray(c.captions) && c.captions.length > 0
        ? c.captions
        : [
            {
              id: crypto.randomUUID(),
              text:
                (c as Record<string, unknown>).primaryText as string ?? "",
            },
          ],
    headline: c.headline ?? "",
    description: c.description ?? "",
    destinationUrl: c.destinationUrl ?? "",
    cta: c.cta ?? "book_now",
    existingPost: c.existingPost,
    enhancements: c.enhancements ?? { ...DEFAULT_ENHANCEMENTS },
  };
}

// ─── Draft migration ──────────────────────────────────────────────────────────

/**
 * Migrate a full draft to ensure all top-level and nested fields exist.
 * Exported so the Supabase persistence layer can reuse it when loading remote drafts.
 */
export function migrateDraft(raw: Record<string, unknown>): CampaignDraft {
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
    draft.optimisationStrategy.guardrails =
      draft.optimisationStrategy.guardrails ?? defaultGuardrails;
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

// ─── localStorage helpers ─────────────────────────────────────────────────────

export function saveDraftToStorage(draft: CampaignDraft): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    console.warn("Failed to save draft to localStorage");
  }
}

export function loadDraftFromStorage(): CampaignDraft | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    return migrateDraft(JSON.parse(data));
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
