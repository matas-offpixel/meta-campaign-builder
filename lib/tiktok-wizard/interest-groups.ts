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

export function flattenTikTokInterestGroups(
  groups: TikTokInterestGroup[],
  previous?: TikTokFlatTargeting,
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
  const fromGroups: TikTokFlatTargeting = {
    interestCategoryIds: unique(interestCategoryIds),
    interestCategoryLabels,
    interestKeywordIds: unique(interestKeywordIds),
    behaviourCategoryIds: unique(behaviourCategoryIds),
    behaviourCategoryLabels,
  };
  if (!groups.some(isTikTokInterestGroupNonEmpty) && previous) {
    return {
      interestCategoryIds: unique([
        ...fromGroups.interestCategoryIds,
        ...previous.interestCategoryIds,
      ]),
      interestCategoryLabels: {
        ...previous.interestCategoryLabels,
        ...fromGroups.interestCategoryLabels,
      },
      interestKeywordIds: unique([
        ...fromGroups.interestKeywordIds,
        ...previous.interestKeywordIds,
      ]),
      behaviourCategoryIds: unique([
        ...fromGroups.behaviourCategoryIds,
        ...previous.behaviourCategoryIds,
      ]),
      behaviourCategoryLabels: {
        ...previous.behaviourCategoryLabels,
        ...fromGroups.behaviourCategoryLabels,
      },
    };
  }
  return fromGroups;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}
