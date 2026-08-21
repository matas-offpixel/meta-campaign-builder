import type {
  TikTokAudiences,
  TikTokInterestGroup,
  TikTokTargetingItem,
} from "../types/tiktok-draft.ts";

export type TikTokFlatTargeting = Pick<
  TikTokAudiences,
  | "interestCategoryIds"
  | "interestCategoryLabels"
  | "interestKeywordIds"
  | "behaviourCategoryIds"
  | "behaviourCategoryLabels"
>;

export function createEmptyTikTokInterestGroup(): TikTokInterestGroup {
  return {
    id: crypto.randomUUID(),
    name: "",
    interestIds: [],
    hashtagIds: [],
    behaviourIds: [],
  };
}

export function isTikTokInterestGroupNonEmpty(
  group: TikTokInterestGroup,
): boolean {
  return (
    group.interestIds.length > 0 ||
    group.hashtagIds.length > 0 ||
    group.behaviourIds.length > 0
  );
}

export function isTikTokInterestGroupNamed(
  group: TikTokInterestGroup,
): boolean {
  return group.name.trim().length > 0;
}

/**
 * A named group with no interests/hashtags/behaviours is a deliberate
 * broad ad group. An unnamed empty card is still unconfigured.
 */
export function isTikTokInterestGroupBroad(
  group: TikTokInterestGroup,
): boolean {
  return isTikTokInterestGroupNamed(group) && !isTikTokInterestGroupNonEmpty(group);
}

export function isTikTokInterestGroupLaunchable(
  group: TikTokInterestGroup,
): boolean {
  return isTikTokInterestGroupNamed(group) || isTikTokInterestGroupNonEmpty(group);
}

export function tikTokInterestGroupCounts(group: TikTokInterestGroup): {
  interests: number;
  hashtags: number;
  behaviours: number;
} {
  return {
    interests: group.interestIds.length,
    hashtags: group.hashtagIds.length,
    behaviours: group.behaviourIds.length,
  };
}

export function formatTikTokInterestGroupCounts(
  group: TikTokInterestGroup,
): string {
  const counts = tikTokInterestGroupCounts(group);
  return [
    `${counts.interests} ${counts.interests === 1 ? "interest" : "interests"}`,
    `${counts.hashtags} ${counts.hashtags === 1 ? "hashtag" : "hashtags"}`,
    `${counts.behaviours} ${counts.behaviours === 1 ? "behaviour" : "behaviours"}`,
  ].join(" · ");
}

export function targetingItemIds(
  items: TikTokTargetingItem[],
  kind?: TikTokTargetingItem["kind"],
): string[] {
  return items
    .filter((item) => (kind ? item.kind === kind : true))
    .map((item) => item.id);
}

export function hasLegacyTikTokTargeting(audiences: TikTokAudiences): boolean {
  return (
    audiences.interestCategoryIds.length > 0 ||
    audiences.interestKeywordIds.length > 0 ||
    audiences.behaviourCategoryIds.length > 0
  );
}

export function seedTikTokInterestGroupFromLegacy(
  audiences: TikTokAudiences,
): TikTokInterestGroup {
  const group = createEmptyTikTokInterestGroup();
  group.name = "Existing targeting";
  group.interestIds = [
    ...audiences.interestCategoryIds.map((id) => ({
      id,
      name: audiences.interestCategoryLabels[id] ?? id,
      kind: "category" as const,
    })),
    ...audiences.interestKeywordIds.map((id) => ({
      id,
      name: id,
      kind: "keyword" as const,
    })),
  ];
  group.behaviourIds = audiences.behaviourCategoryIds.map((id) => ({
    id,
    name: audiences.behaviourCategoryLabels[id] ?? id,
    kind: "category" as const,
  }));
  return group;
}

/**
 * Flattens the groups into the legacy flat targeting fields the mapper falls
 * back to for ad groups with no `interestGroupId`.
 *
 * This deliberately takes no "previous" snapshot to merge back in. It used to:
 * when every group was empty it re-merged the previous flat IDs, so an
 * operator who emptied or deleted every group still launched with the
 * targeting they had just removed. Clearing the UI now clears the payload.
 */
export function flattenTikTokInterestGroups(
  groups: TikTokInterestGroup[],
): TikTokFlatTargeting {
  const interestCategoryIds: string[] = [];
  const interestCategoryLabels: Record<string, string> = {};
  const interestKeywordIds: string[] = [];
  const behaviourCategoryIds: string[] = [];
  const behaviourCategoryLabels: Record<string, string> = {};
  for (const group of groups) {
    for (const item of group.interestIds) {
      if (item.kind === "keyword") {
        interestKeywordIds.push(item.id);
      } else {
        interestCategoryIds.push(item.id);
        interestCategoryLabels[item.id] = item.name;
      }
    }
    for (const item of group.hashtagIds) interestKeywordIds.push(item.id);
    for (const item of group.behaviourIds) {
      behaviourCategoryIds.push(item.id);
      behaviourCategoryLabels[item.id] = item.name;
    }
  }
  return {
    interestCategoryIds: unique(interestCategoryIds),
    interestCategoryLabels,
    interestKeywordIds: unique(interestKeywordIds),
    behaviourCategoryIds: unique(behaviourCategoryIds),
    behaviourCategoryLabels,
  };
}

export function removeTikTokInterestGroup(
  audiences: TikTokAudiences,
  groupId: string,
): TikTokAudiences {
  const interestGroups = audiences.interestGroups.filter(
    (group) => group.id !== groupId,
  );
  return {
    ...audiences,
    interestGroups,
    ...flattenTikTokInterestGroups(interestGroups),
  };
}

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}
