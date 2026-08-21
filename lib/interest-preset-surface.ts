import { getPersonaPresetsForCluster, type PersonaPreset } from "./audience-personas.ts";
import { inferClusterFromName } from "./interest-suggestions.ts";
import { getSceneHintPresets, type SceneHintPreset } from "./scene-hint-presets.ts";

/** Empty-state copy when a group has no cluster — the moment presets are most useful. */
export const CLUSTER_CHOOSER_PROMPT =
  "Pick a category to see suggested audiences";

/** Shown instead of a blank persona row for clusters that have scene hints only. */
export const PERSONA_ROW_INTENTIONAL_EMPTY =
  "No audience personas for this category — scene hints above are the presets";

export type InterestPresetSurface =
  | { kind: "cluster-chooser"; prompt: string }
  | {
      kind: "presets";
      clusterLabel: string;
      sceneHints: SceneHintPreset[];
      personaPresets: PersonaPreset[];
      personaEmptyLabel: string | null;
    };

export function resolveInterestPresetSurface(group: {
  clusterType?: string;
  name: string;
}): InterestPresetSurface {
  const trimmed = group.clusterType?.trim();
  const clusterLabel = trimmed || inferClusterFromName(group.name);
  if (!clusterLabel) {
    return { kind: "cluster-chooser", prompt: CLUSTER_CHOOSER_PROMPT };
  }
  const sceneHints = getSceneHintPresets({ clusterLabel });
  const personaPresets = getPersonaPresetsForCluster(clusterLabel);
  return {
    kind: "presets",
    clusterLabel,
    sceneHints,
    personaPresets,
    personaEmptyLabel:
      personaPresets.length === 0 ? PERSONA_ROW_INTENTIONAL_EMPTY : null,
  };
}

/** Collapsed empty groups should still show the category chooser. */
export function shouldShowCollapsedClusterChooser(group: {
  clusterType?: string;
  name: string;
  interests: { id: string }[];
}): boolean {
  if (group.interests.length > 0) return false;
  return resolveInterestPresetSurface(group).kind === "cluster-chooser";
}

/**
 * Pages stays the first tab for a blank campaign (page targeting is the
 * usual starting point). Land on Interest Groups only when the draft
 * already has interest work and no page audiences — otherwise the
 * presets stay behind the fifth tab.
 */
export function initialAudienceTab(audiences: {
  interestGroups: unknown[];
  pageGroups: { pageIds: string[] }[];
}): "pages" | "interests" {
  const hasInterestGroups = audiences.interestGroups.length > 0;
  const hasPageAudiences = audiences.pageGroups.some((g) => g.pageIds.length > 0);
  if (hasInterestGroups && !hasPageAudiences) return "interests";
  return "pages";
}
