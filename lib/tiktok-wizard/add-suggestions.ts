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

export type TikTokTargetingItemRef = Pick<TikTokTargetingItem, "id" | "kind">;

/** Categories and keywords are separate TikTok ID namespaces. */
export function tikTokTargetingItemKey(
  item: TikTokTargetingItemRef,
): string {
  return `${item.kind}:${item.id}`;
}

/** Additive and idempotent. Existing rows (and their provenance) stay put. */
export function addTikTokTargetingItems(
  current: TikTokTargetingItem[],
  incoming: TikTokTargetingItem[],
): TikTokTargetingItem[] {
  const seen = new Set(current.map(tikTokTargetingItemKey));
  const next = [...current];
  for (const item of incoming) {
    if (!item.id) continue;
    const key = tikTokTargetingItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

export function removeTikTokTargetingItems(
  current: TikTokTargetingItem[],
  items: readonly TikTokTargetingItemRef[],
): TikTokTargetingItem[] {
  const drop = new Set(
    items.filter((item) => item.id).map(tikTokTargetingItemKey),
  );
  if (drop.size === 0) return current;
  return current.filter((item) => !drop.has(tikTokTargetingItemKey(item)));
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
  items: readonly TikTokTargetingItemRef[],
): TikTokInterestGroup[] {
  return groups.map((group) =>
    group.id === groupId
      ? { ...group, [key]: removeTikTokTargetingItems(group[key], items) }
      : group,
  );
}
