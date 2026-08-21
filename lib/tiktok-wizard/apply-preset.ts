import type { TikTokInterestGroup } from "../types/tiktok-draft.ts";
import { createEmptyTikTokInterestGroup } from "./interest-groups.ts";
import {
  formatTikTokUnresolvedPresetKeywords,
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
  keywordTerms: number;
  unresolvedKeywordTerms?: readonly string[];
}): string {
  const categories = input.taxonomy.interestItems.length;
  const behaviours = input.taxonomy.behaviourItems.length;
  const summary = `${categories} ${
    categories === 1 ? "category" : "categories"
  }, ${behaviours} ${
    behaviours === 1 ? "behaviour" : "behaviours"
  }, ${input.keywordTerms} keyword ${
    input.keywordTerms === 1 ? "term" : "terms"
  }.`;
  const unresolved = [
    formatTikTokUnresolvedPresetPaths(input.taxonomy.unresolvedPaths),
    formatTikTokUnresolvedPresetKeywords(input.unresolvedKeywordTerms ?? []),
  ].filter((part): part is string => Boolean(part));
  return unresolved.length > 0 ? `${summary} ${unresolved.join(" ")}` : summary;
}
