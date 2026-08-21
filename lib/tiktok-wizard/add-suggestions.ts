import type {
  TikTokInterestGroup,
  TikTokTargetingItem,
} from "../types/tiktok-draft.ts";

export type TikTokGroupItemKey = "interestIds" | "hashtagIds" | "behaviourIds";

export function tikTokAddAllLabel(count: number): string {
  return `Add all ${count}`;
}

/**
 * Interest tree is 716 nodes — never offer a blanket add. Behaviours and
 * recommend chips may bulk-add whatever is currently on screen.
 */
export function shouldOfferTikTokCategoryBulkActions(input: {
  visibleCount: number;
  filterQuery: string;
  allowUnfiltered: boolean;
}): boolean {
  if (input.visibleCount === 0) return false;
  if (input.allowUnfiltered) return true;
  return input.filterQuery.trim().length > 0;
}

/** Additive and idempotent. Existing rows (and their provenance) stay put. */
export function addTikTokTargetingItems(
  current: TikTokTargetingItem[],
  incoming: TikTokTargetingItem[],
): TikTokTargetingItem[] {
  const seen = new Set(current.map((item) => item.id));
  const next = [...current];
  for (const item of incoming) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

export function removeTikTokTargetingItems(
  current: TikTokTargetingItem[],
  ids: readonly string[],
): TikTokTargetingItem[] {
  const drop = new Set(ids.filter(Boolean));
  if (drop.size === 0) return current;
  return current.filter((item) => !drop.has(item.id));
}

export function addVisibleToTikTokGroup(
  groups: TikTokInterestGroup[],
  groupId: string,
  key: TikTokGroupItemKey,
  incoming: TikTokTargetingItem[],
): TikTokInterestGroup[] {
  return groups.map((group) =>
    group.id === groupId
      ? { ...group, [key]: addTikTokTargetingItems(group[key], incoming) }
      : group,
  );
}

export function removeVisibleFromTikTokGroup(
  groups: TikTokInterestGroup[],
  groupId: string,
  key: TikTokGroupItemKey,
  ids: readonly string[],
): TikTokInterestGroup[] {
  return groups.map((group) =>
    group.id === groupId
      ? { ...group, [key]: removeTikTokTargetingItems(group[key], ids) }
      : group,
  );
}
