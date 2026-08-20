import type {
  TikTokInterestGroup,
  TikTokTargetingItem,
} from "../types/tiktok-draft.ts";

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
