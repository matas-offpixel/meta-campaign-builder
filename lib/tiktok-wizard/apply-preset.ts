import type { TikTokInterestGroup } from "../types/tiktok-draft.ts";
import { createEmptyTikTokInterestGroup } from "./interest-groups.ts";
import {
  formatTikTokUnresolvedPresetPaths,
  mergeTikTokPresetTaxonomy,
  type TikTokGenrePreset,
  type TikTokPresetTaxonomySelection,
} from "./genre-presets.ts";

export function applyTikTokPresetTaxonomyToGroup(
  group: TikTokInterestGroup,
  taxonomy: TikTokPresetTaxonomySelection,
): TikTokInterestGroup {
  const merged = mergeTikTokPresetTaxonomy(group, taxonomy);
  return { ...group, ...merged };
}

export function createTikTokInterestGroupFromPreset(input: {
  preset: TikTokGenrePreset;
  taxonomy: TikTokPresetTaxonomySelection;
  id?: string;
}): TikTokInterestGroup {
  const group = createEmptyTikTokInterestGroup();
  if (input.id) group.id = input.id;
  group.name = input.preset.label;
  return applyTikTokPresetTaxonomyToGroup(group, input.taxonomy);
}

export function formatTikTokPresetResolution(input: {
  taxonomy: TikTokPresetTaxonomySelection;
  keywordMatches: number;
}): string {
  const categories = input.taxonomy.interestItems.length;
  const behaviours = input.taxonomy.behaviourItems.length;
  const summary = `${categories} ${
    categories === 1 ? "category" : "categories"
  }, ${behaviours} ${
    behaviours === 1 ? "behaviour" : "behaviours"
  }, ${input.keywordMatches} keyword ${
    input.keywordMatches === 1 ? "match" : "matches"
  }.`;
  const unresolved = formatTikTokUnresolvedPresetPaths(
    input.taxonomy.unresolvedPaths,
  );
  return unresolved ? `${summary} ${unresolved}` : summary;
}
