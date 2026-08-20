import type { TikTokAudienceCategory } from "../tiktok/audience.ts";
import type { TikTokTargetingItem } from "../types/tiktok-draft.ts";

export const TIKTOK_GENRE_PRESET_LIMITATION_NOTE =
  "TikTok has no genre-level interest categories, so a genre preset maps to broad music and dance interests plus keyword matches, and precision comes from geo, age and custom audiences.";

export const TIKTOK_ELECTRONIC_INTEREST_LABELS = [
  "Music",
  "Dance",
  "Entertainment",
] as const;

export const TIKTOK_ELECTRONIC_BEHAVIOUR_LABELS = [
  "Music",
  "Dance",
  "Singing & Dancing",
  "Performance",
] as const;

export interface TikTokGenrePreset {
  id: string;
  label: string;
  seeds: string[];
  interestLabels: readonly string[];
  behaviourLabels: readonly string[];
}

export const TIKTOK_GENRE_PRESETS: TikTokGenrePreset[] = [
  {
    id: "electronic-music",
    label: "Electronic music",
    // Single words only: FUZZ_MATCH is a literal substring matcher, so
    // "tech house" / "house music" return 0 and "edm" matches "edmonton".
    seeds: ["techno", "house", "disco", "electronic", "dance"],
    interestLabels: TIKTOK_ELECTRONIC_INTEREST_LABELS,
    behaviourLabels: TIKTOK_ELECTRONIC_BEHAVIOUR_LABELS,
  },
];

export interface TikTokPresetKeywordRow {
  id: string;
  name: string;
  audienceSize: number | null;
  seeds: string[];
}

export interface TikTokPresetTaxonomySelection {
  interestItems: TikTokTargetingItem[];
  behaviourItems: TikTokTargetingItem[];
}

export function resolveTikTokPresetTaxonomy(
  catalog: {
    interests: TikTokAudienceCategory[];
    behaviours: TikTokAudienceCategory[];
  },
  preset: Pick<TikTokGenrePreset, "interestLabels" | "behaviourLabels">,
): TikTokPresetTaxonomySelection {
  return {
    interestItems: matchCatalogLabels(catalog.interests, preset.interestLabels).map(
      (row) => ({
        id: row.id,
        name: row.label,
        kind: "category" as const,
      }),
    ),
    behaviourItems: matchCatalogLabels(
      catalog.behaviours,
      preset.behaviourLabels,
    ).map((row) => ({
      id: row.id,
      name: row.label,
      kind: "category" as const,
    })),
  };
}

export function mergeTikTokPresetTaxonomy(
  group: {
    interestIds: TikTokTargetingItem[];
    behaviourIds: TikTokTargetingItem[];
  },
  taxonomy: TikTokPresetTaxonomySelection,
): {
  interestIds: TikTokTargetingItem[];
  behaviourIds: TikTokTargetingItem[];
} {
  return {
    interestIds: unionById(group.interestIds, taxonomy.interestItems),
    behaviourIds: unionById(group.behaviourIds, taxonomy.behaviourItems),
  };
}

export async function expandTikTokPresetKeywords(
  seeds: string[],
  fetchSeed: (seed: string) => Promise<
    Array<{ id: string; name: string; audienceSize?: number | null }>
  >,
): Promise<{
  rows: TikTokPresetKeywordRow[];
  failedSeeds: string[];
  requested: number;
}> {
  const trimmed = [...new Set(seeds.map((seed) => seed.trim()).filter(Boolean))];
  const settled = await Promise.allSettled(
    trimmed.map((seed) => fetchSeed(seed)),
  );
  const byId = new Map<string, TikTokPresetKeywordRow>();
  const failedSeeds: string[] = [];
  settled.forEach((result, index) => {
    const seed = trimmed[index];
    if (result.status === "rejected") {
      failedSeeds.push(seed);
      return;
    }
    for (const item of result.value) {
      const existing = byId.get(item.id);
      if (existing) {
        if (!existing.seeds.includes(seed)) existing.seeds.push(seed);
        continue;
      }
      byId.set(item.id, {
        id: item.id,
        name: item.name,
        audienceSize: item.audienceSize ?? null,
        seeds: [seed],
      });
    }
  });
  return {
    rows: [...byId.values()],
    failedSeeds,
    requested: trimmed.length,
  };
}

export function tikTokHashtagPresetQuery(seeds: string[]): {
  keywords: string[];
  operator: "OR";
} {
  return {
    keywords: seeds.map((seed) => seed.trim()).filter(Boolean).slice(0, 10),
    operator: "OR",
  };
}

function matchCatalogLabels(
  rows: TikTokAudienceCategory[],
  labels: readonly string[],
): TikTokAudienceCategory[] {
  const wanted = new Map(
    labels.map((label) => [normaliseLabel(label), label] as const),
  );
  const matched = new Map<string, TikTokAudienceCategory>();
  for (const row of rows) {
    const key = normaliseLabel(row.label);
    if (!wanted.has(key)) continue;
    const existing = matched.get(key);
    if (!existing || (existing.parent_id && !row.parent_id)) {
      matched.set(key, row);
    }
  }
  return labels
    .map((label) => matched.get(normaliseLabel(label)))
    .filter((row): row is TikTokAudienceCategory => Boolean(row));
}

function unionById(
  current: TikTokTargetingItem[],
  extra: TikTokTargetingItem[],
): TikTokTargetingItem[] {
  const seen = new Set(current.map((item) => item.id));
  const next = [...current];
  for (const item of extra) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

function normaliseLabel(label: string): string {
  return label.trim().toLowerCase();
}
