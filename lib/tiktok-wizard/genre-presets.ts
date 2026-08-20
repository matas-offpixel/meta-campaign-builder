import type { TikTokAudienceCategory } from "../tiktok/audience.ts";
import type { TikTokTargetingItem } from "../types/tiktok-draft.ts";

export const TIKTOK_GENRE_PRESET_LIMITATION_NOTE =
  "TikTok has no genre-level interest categories, so a genre preset maps to broad music and dance interests plus keyword matches, and precision comes from geo, age and custom audiences.";

export type TikTokTaxonomyPath = readonly string[];

export const TIKTOK_ELECTRONIC_INTEREST_PATHS = [
  ["News & Entertainment", "Culture & Art", "Music"],
  ["News & Entertainment", "Culture & Art", "Dance"],
] as const satisfies readonly TikTokTaxonomyPath[];

export const TIKTOK_ELECTRONIC_BEHAVIOUR_PATHS = [
  ["Entertainment", "Entertainment & Culture", "Music"],
  ["Talents", "Singing & Dancing"],
  ["Talents", "Singing & Dancing", "Dance"],
] as const satisfies readonly TikTokTaxonomyPath[];

export interface TikTokGenrePreset {
  id: string;
  label: string;
  seeds: string[];
  interestPaths: readonly TikTokTaxonomyPath[];
  behaviourPaths: readonly TikTokTaxonomyPath[];
}

export const TIKTOK_GENRE_PRESETS: TikTokGenrePreset[] = [
  {
    id: "electronic-music",
    label: "Electronic music",
    // Single words only: FUZZ_MATCH is a literal substring matcher, so
    // "tech house" / "house music" return 0 and "edm" matches "edmonton".
    seeds: ["techno", "house", "disco", "electronic", "dance"],
    interestPaths: TIKTOK_ELECTRONIC_INTEREST_PATHS,
    behaviourPaths: TIKTOK_ELECTRONIC_BEHAVIOUR_PATHS,
  },
];

export interface TikTokPresetKeywordRow {
  id: string;
  name: string;
  audienceSize: number | null;
  seeds: string[];
}

export interface TikTokUnresolvedPresetPath {
  kind: "interest" | "behaviour";
  path: TikTokTaxonomyPath;
}

export interface TikTokPresetTaxonomySelection {
  interestItems: TikTokTargetingItem[];
  behaviourItems: TikTokTargetingItem[];
  unresolvedPaths: TikTokUnresolvedPresetPath[];
}

export function formatTikTokTaxonomyPath(path: TikTokTaxonomyPath): string {
  return path.map((segment) => segment.trim()).filter(Boolean).join(" > ");
}

export function formatTikTokUnresolvedPresetPaths(
  unresolved: readonly TikTokUnresolvedPresetPath[],
): string | null {
  if (unresolved.length === 0) return null;
  const named = unresolved.map((item) => formatTikTokTaxonomyPath(item.path));
  return `TikTok catalog has no node for ${named.join("; ")}.`;
}

export function tikTokPresetTaxonomyPendingReason(input: {
  hasGroup: boolean;
  catalogLoaded: boolean;
}): "no-group" | "catalog-empty" | null {
  if (!input.hasGroup) return "no-group";
  if (!input.catalogLoaded) return "catalog-empty";
  return null;
}

export function resolveTikTokPresetTaxonomy(
  catalog: {
    interests: TikTokAudienceCategory[];
    behaviours: TikTokAudienceCategory[];
  },
  preset: Pick<TikTokGenrePreset, "interestPaths" | "behaviourPaths">,
): TikTokPresetTaxonomySelection {
  const unresolvedPaths: TikTokUnresolvedPresetPath[] = [];
  const interestItems: TikTokTargetingItem[] = [];
  for (const path of preset.interestPaths) {
    const row = matchCatalogPath(catalog.interests, path);
    if (!row) {
      unresolvedPaths.push({ kind: "interest", path });
      continue;
    }
    interestItems.push({
      id: row.id,
      name: formatTikTokTaxonomyPath(path),
      kind: "category",
    });
  }
  const behaviourItems: TikTokTargetingItem[] = [];
  for (const path of preset.behaviourPaths) {
    const row = matchCatalogPath(catalog.behaviours, path);
    if (!row) {
      unresolvedPaths.push({ kind: "behaviour", path });
      continue;
    }
    behaviourItems.push({
      id: row.id,
      name: formatTikTokTaxonomyPath(path),
      kind: "category",
    });
  }
  return { interestItems, behaviourItems, unresolvedPaths };
}

export function mergeTikTokPresetTaxonomy(
  group: {
    interestIds: TikTokTargetingItem[];
    behaviourIds: TikTokTargetingItem[];
  },
  taxonomy: Pick<TikTokPresetTaxonomySelection, "interestItems" | "behaviourItems">,
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

function matchCatalogPath(
  rows: TikTokAudienceCategory[],
  path: TikTokTaxonomyPath,
): TikTokAudienceCategory | null {
  const wanted = path.map(normaliseLabel);
  if (wanted.length === 0 || wanted.some((segment) => !segment)) return null;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const leaf = wanted[wanted.length - 1];
  for (const row of rows) {
    if (normaliseLabel(row.label) !== leaf) continue;
    if (ancestorPathEquals(row, wanted, byId)) return row;
  }
  return null;
}

function ancestorPathEquals(
  row: TikTokAudienceCategory,
  wanted: string[],
  byId: Map<string, TikTokAudienceCategory>,
): boolean {
  const walked: string[] = [];
  const seen = new Set<string>();
  let current: TikTokAudienceCategory | undefined = row;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    walked.unshift(normaliseLabel(current.label));
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  if (walked.length !== wanted.length) return false;
  return walked.every((segment, index) => segment === wanted[index]);
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
