import type { CampaignDraft, AdCreativeDraft, AssetVariation, Asset, AssetRatio, AdSetGeoLocations, LocationTargetingGroup, LocationPreset } from "./types";

const STORAGE_KEY = "campaign_draft";

/**
 * Deterministically resolve a geo object back to its known preset label.
 * Returns undefined if the geo doesn't match any known preset.
 */
function resolvePresetLabelFromGeo(geo: AdSetGeoLocations | undefined): string | undefined {
  if (!geo) return undefined;
  const cities = geo.cities ?? [];
  const countries = geo.countries ?? [];
  if (cities.length === 1 && cities[0]?.key === "2421178") return "London +40km";
  if (countries.length === 1 && countries[0] === "GB" && cities.length === 0) {
    const excl = (geo as Record<string, unknown>).excluded_geo_locations;
    if (excl) return "UK excl London +40km";
    return "UK";
  }
  return undefined;
}

/**
 * Convert legacy LocationPreset values to the new LocationTargetingGroup model.
 */
function migrateLocationPresets(presets: LocationPreset[]): LocationTargetingGroup[] {
  const groups: LocationTargetingGroup[] = [];
  for (const p of presets) {
    switch (p) {
      case "london_40km":
        groups.push({
          id: "preset_london_40km",
          label: "London, England +40 km",
          source: "preset",
          selections: [{
            id: "london_include",
            source: "preset",
            label: "London, England, United Kingdom",
            mode: "include",
            locationType: "city",
            locationKey: "2421178",
            radius: 40,
            distanceUnit: "kilometer",
          }],
        });
        break;
      case "uk_excl_london_40km":
        groups.push({
          id: "preset_uk_excl_london",
          label: "UK excluding London +40 km",
          source: "preset",
          selections: [
            {
              id: "gb_include",
              source: "preset",
              label: "United Kingdom",
              mode: "include",
              locationType: "country",
              countryCode: "GB",
            },
            {
              id: "london_exclude",
              source: "preset",
              label: "London, England, United Kingdom",
              mode: "exclude",
              locationType: "city",
              locationKey: "2421178",
              radius: 40,
              distanceUnit: "kilometer",
            },
          ],
        });
        break;
      case "gb_nationwide":
        groups.push({
          id: "preset_gb_nationwide",
          label: "UK (nationwide)",
          source: "preset",
          selections: [{
            id: "gb_nationwide_include",
            source: "preset",
            label: "United Kingdom",
            mode: "include",
            locationType: "country",
            countryCode: "GB",
          }],
        });
        break;
    }
  }
  return groups;
}

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

  // ── Reconcile the two ad account ID fields ─────────────────────────────────
  // adAccountId (legacy) and metaAdAccountId (current) must always be in sync.
  // Older drafts may have only one set; ensure both are populated from whichever
  // has a value, so the launch pipeline always has a consistent source.
  if (draft.settings) {
    const a = draft.settings.adAccountId;
    const b = draft.settings.metaAdAccountId;
    const canonical = b || a || "";  // prefer metaAdAccountId as the source of truth
    draft.settings.adAccountId = canonical;
    draft.settings.metaAdAccountId = canonical || undefined;

    console.log("[migrateDraft] adAccountId:", a, "| metaAdAccountId:", b, "→ canonical:", canonical || "(empty)");

    // Backfill / normalize wizardMode.
    //   - Drafts created before any attach flow existed have no value → "new".
    //   - The first iteration of the attach flow used `"attach"` as the
    //     literal; that is now `"attach_campaign"`. Migrate any persisted
    //     value forward so old drafts continue to launch correctly.
    const rawMode = draft.settings.wizardMode as unknown as string | undefined;
    if (!rawMode) {
      draft.settings.wizardMode = "new";
    } else if (rawMode === "attach") {
      draft.settings.wizardMode = "attach_campaign";
    }
  }

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
    selectedPagesLookalikeGroups: [],
  };

  // Add selectedPagesLookalikeGroups if missing from older drafts
  if (!Array.isArray(draft.audiences.selectedPagesLookalikeGroups)) {
    draft.audiences.selectedPagesLookalikeGroups = [];
  }

  // Backfill `targetabilityStatus` on existing selected interests so older
  // drafts don't lose chips at launch under the new skip-non-targetable rule.
  // Heuristic: a Meta-shaped numeric id (10+ digits) is treated as `valid`;
  // anything synthetic is marked `pending` so the UI's background validator
  // (in interest-groups-panel.tsx) re-checks it on next render.
  if (Array.isArray(draft.audiences.interestGroups)) {
    for (const g of draft.audiences.interestGroups) {
      if (!Array.isArray(g.interests)) continue;
      for (const i of g.interests) {
        if (i.targetabilityStatus) continue;
        i.targetabilityStatus = /^\d{10,}$/.test(i.id) ? "valid" : "pending";
      }
    }
  }

  // Migrate lookalikeRange → lookalikeRanges on page groups
  if (Array.isArray(draft.audiences.pageGroups)) {
    for (const g of draft.audiences.pageGroups) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const legacy = (g as any).lookalikeRange as string | undefined;
      if (!g.lookalikeRanges) {
        g.lookalikeRanges = legacy ? [legacy as import("./types").LookalikeRange] : ["0-1%"];
      }
    }
  }
  draft.budgetSchedule = draft.budgetSchedule ?? {
    budgetLevel: "ad_set",
    budgetType: "daily",
    budgetAmount: 50,
    currency: "GBP",
    startDate: "",
    endDate: "",
    timezone: "Europe/London",
  };

  // Migrate old locationPresets → new locationGroups
  if (draft.budgetSchedule.locationPresets?.length && !draft.budgetSchedule.locationGroups?.length) {
    draft.budgetSchedule.locationGroups = migrateLocationPresets(draft.budgetSchedule.locationPresets);
    console.log("[migrateDraft] Migrated locationPresets →", draft.budgetSchedule.locationGroups.length, "locationGroups");
  }
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
  draft.adSetSuggestions = (draft.adSetSuggestions ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => {
      let label: string | undefined = s.locationLabel ?? undefined;
      let name: string = s.name ?? "";

      // Fix stale location labels from old drafts that used fuzzy search
      // (e.g. "United States: Oxnard (+40 km) California" instead of "London +40km")
      if (label && !["London +40km", "UK excl London +40km", "UK"].includes(label)) {
        label = resolvePresetLabelFromGeo(s.geoLocations) ?? label;
      }
      if (name && (name.includes("Oxnard") || name.includes("United States"))) {
        const baseName = name.replace(/ — .*$/, "");
        name = label ? `${baseName} — ${label}` : baseName;
      }

      return {
        ...s,
        name,
        advantagePlus: s.advantagePlus ?? false,
        geoLocations: s.geoLocations ?? undefined,
        locationLabel: label,
      };
    },
  ) as CampaignDraft["adSetSuggestions"];
  draft.creativeAssignments = draft.creativeAssignments ?? {};

  // Migrate: move any launch-injected engagement audience IDs from
  // customAudienceIds → engagementAudienceIds so the UI doesn't show
  // them as user-selected. This only affects drafts saved by older code
  // that injected engagement IDs into customAudienceIds during launch.
  if (Array.isArray(draft.audiences?.pageGroups)) {
    for (const g of draft.audiences.pageGroups) {
      if (!g.engagementAudienceIds && g.customAudienceIds?.length > 0 && draft.status === "published") {
        // Published drafts with IDs in customAudienceIds but no engagementAudienceIds
        // field were saved by the old code. Move all IDs to engagementAudienceIds
        // and clear customAudienceIds since the user never manually selected them.
        g.engagementAudienceIds = g.customAudienceIds;
        g.customAudienceIds = [];
        console.log(`[migrateDraft] Moved ${g.engagementAudienceIds.length} engagement IDs out of customAudienceIds for group "${g.name}"`);
      }
    }
  }

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
