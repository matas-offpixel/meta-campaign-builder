import { capCreativeName } from "../creative-name-from-filename.ts";
import type { AdCreativeDraft, CreativeAssignmentMatrix } from "../types.ts";
import { creativeTriggersVariationRotation } from "./creative.ts";

/**
 * Meta's ad set holds 50 ads
 * (https://www.facebook.com/business/help/272570294319874).
 * A creative with N variations launches as N ads unless it opts into rotation.
 */
export const META_ADS_PER_AD_SET_LIMIT = 50;

/** How many ads this creative becomes. Rotation stays one ad. */
export function adsThisCreativeLaunches(creative: AdCreativeDraft): number {
  if (creative.sourceType === "existing_post") return 1;
  const count = creative.assetVariations?.length ?? 0;
  if (count < 2) return 1;
  if (creativeTriggersVariationRotation(creative)) return 1;
  return count;
}

export function variationLaunchName(creativeName: string, index: number): string {
  const suffix = ` — V${index}`;
  const base = capCreativeName(creativeName.trim() || "Ad", suffix.length);
  return `${base}${suffix}`;
}

/**
 * One creative per ad. A rotation creative (toggle on) stays one creative.
 * An existing post stays one creative. Everything else with 2+ variations
 * becomes one creative per variation, named "<creative> — V1".
 */
export function expandCreativesForLaunch(creatives: AdCreativeDraft[]): AdCreativeDraft[] {
  const out: AdCreativeDraft[] = [];
  for (const creative of creatives) {
    const variations = creative.assetVariations ?? [];
    if (
      variations.length < 2 ||
      creative.sourceType === "existing_post" ||
      creativeTriggersVariationRotation(creative)
    ) {
      out.push(creative);
      continue;
    }
    variations.forEach((variation, i) => {
      const index = i + 1;
      out.push({
        ...creative,
        id: `${creative.id}:v${index}`,
        name: variationLaunchName(creative.name, index),
        nameSource: "operator",
        assetVariations: [variation],
        rotateVariations: false,
      });
    });
  }
  return out;
}

export function expandVariationAds(
  creatives: AdCreativeDraft[],
  assignments: CreativeAssignmentMatrix,
): { creatives: AdCreativeDraft[]; assignments: CreativeAssignmentMatrix } {
  const slices = new Map<string, string[]>();
  const nextCreatives: AdCreativeDraft[] = [];
  for (const creative of creatives) {
    const before = nextCreatives.length;
    const expanded = expandCreativesForLaunch([creative]);
    nextCreatives.push(...expanded);
    if (expanded.length === 1 && expanded[0]?.id === creative.id) continue;
    slices.set(
      creative.id,
      nextCreatives.slice(before).map((child) => child.id),
    );
  }
  const nextAssignments: CreativeAssignmentMatrix = {};
  for (const [adSetId, creativeIds] of Object.entries(assignments)) {
    nextAssignments[adSetId] = (creativeIds ?? []).flatMap((id) => slices.get(id) ?? [id]);
  }
  return { creatives: nextCreatives, assignments: nextAssignments };
}

export function adSetAdLimitMessage(
  rows: Array<{ name: string; existingAds: number; newAds: number }>,
): string | null {
  const over = rows.filter((row) => row.existingAds + row.newAds > META_ADS_PER_AD_SET_LIMIT);
  if (over.length === 0) return null;
  const detail = over
    .map((row) => `"${row.name}" would have ${row.existingAds + row.newAds}`)
    .join(", ");
  return `Meta allows ${META_ADS_PER_AD_SET_LIMIT} ads in an ad set. ${detail}.`;
}

/**
 * The assignment matrix is ad set id → creative ids. The first existing-post
 * creative on an ad set supplies that ad set's placement override.
 */
export function firstExistingPostByAdSet(
  assignments: CreativeAssignmentMatrix,
  creatives: AdCreativeDraft[],
): Map<string, AdCreativeDraft> {
  const byId = new Map(creatives.map((creative) => [creative.id, creative]));
  const out = new Map<string, AdCreativeDraft>();
  for (const [adSetId, creativeIds] of Object.entries(assignments)) {
    for (const creativeId of creativeIds ?? []) {
      const creative = byId.get(creativeId);
      if (creative?.sourceType !== "existing_post" || !creative.existingPost) continue;
      out.set(adSetId, creative);
      break;
    }
  }
  return out;
}
