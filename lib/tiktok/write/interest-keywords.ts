import type { TikTokCampaignDraft, TikTokTargetingItem } from "../../types/tiktok-draft.ts";
import { fetchTikTokInterestKeywordsByIds } from "../audience.ts";
import type { tiktokGet } from "../client.ts";
import { suggestTikTokAdGroups } from "../../tiktok-wizard/review.ts";

type TikTokGet = typeof tiktokGet;

export const TIKTOK_KEYWORD_STALE_MS = 14 * 24 * 60 * 60 * 1000;

export const TIKTOK_RETIRED_INTEREST_KEYWORD_GUIDANCE =
  "one or more saved keyword interests have been retired by TikTok — reopen Audiences, clear and re-search the keyword chips for the affected group";

export interface RetiredInterestKeywordGroup {
  groupId: string;
  groupName: string;
  adGroupId: string;
  items: Array<{ id: string; name: string }>;
}

export function isTikTokRetiredInterestKeywordMessage(
  message: string | undefined,
): boolean {
  return /additional interest\(s\) that are no longer available/i.test(
    message ?? "",
  );
}

export function collectDraftInterestKeywordItems(
  draft: TikTokCampaignDraft,
): Array<{
  groupId: string;
  groupName: string;
  adGroupId: string;
  item: TikTokTargetingItem;
}> {
  const adGroups = suggestTikTokAdGroups(draft);
  const rows: Array<{
    groupId: string;
    groupName: string;
    adGroupId: string;
    item: TikTokTargetingItem;
  }> = [];
  for (const group of draft.audiences.interestGroups ?? []) {
    const adGroup = adGroups.find(
      (candidate) => candidate.interestGroupId === group.id,
    );
    for (const item of group.interestIds) {
      if (item.kind !== "keyword" || !item.id) continue;
      rows.push({
        groupId: group.id,
        groupName: group.name.trim() || group.id,
        adGroupId: adGroup?.id ?? group.id,
        item,
      });
    }
  }
  return rows;
}

/**
 * Resolve every saved keyword chip against TikTok. Does not drop ids from
 * the draft — missing ids become preflight blockers.
 */
export async function hydrateDraftInterestKeywordIds(input: {
  draft: TikTokCampaignDraft;
  token: string;
  request?: TikTokGet;
}): Promise<RetiredInterestKeywordGroup[]> {
  const rows = collectDraftInterestKeywordItems(input.draft);
  const keywordIds = [...new Set(rows.map((row) => row.item.id))];
  if (keywordIds.length === 0) return [];
  const advertiserId = input.draft.accountSetup.advertiserId;
  if (!advertiserId) return [];
  let known: Set<string>;
  try {
    known = await fetchTikTokInterestKeywordsByIds({
      advertiserId,
      token: input.token,
      keywordIds,
      request: input.request,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[tiktok/launch] interest keyword hydrate failed advertiser=${advertiserId}: ${message}`,
    );
    return [];
  }

  if (known.size === 0) {
    console.error(
      `[tiktok/launch] interest keyword hydrate resolved 0/${keywordIds.length} — treating as unverified`,
    );
    return [];
  }

  const retiredByGroup = new Map<string, RetiredInterestKeywordGroup>();
  for (const row of rows) {
    if (known.has(row.item.id)) continue;
    const existing = retiredByGroup.get(row.groupId);
    const chip = { id: row.item.id, name: row.item.name || row.item.id };
    if (existing) {
      existing.items.push(chip);
      continue;
    }
    retiredByGroup.set(row.groupId, {
      groupId: row.groupId,
      groupName: row.groupName,
      adGroupId: row.adGroupId,
      items: [chip],
    });
  }
  return [...retiredByGroup.values()];
}

export function tikTokKeywordChipIsStale(
  item: TikTokTargetingItem,
  now = new Date(),
): boolean {
  if (item.kind !== "keyword" || !item.resolvedAt) return false;
  const at = Date.parse(item.resolvedAt);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at > TIKTOK_KEYWORD_STALE_MS;
}

export function staleTikTokKeywordChips(
  draft: TikTokCampaignDraft,
  now = new Date(),
): TikTokTargetingItem[] {
  return collectDraftInterestKeywordItems(draft)
    .map((row) => row.item)
    .filter((item) => tikTokKeywordChipIsStale(item, now));
}

export function stampTikTokKeywordResolvedAt(
  item: TikTokTargetingItem,
  now = new Date(),
): TikTokTargetingItem {
  if (item.kind !== "keyword") return item;
  return { ...item, resolvedAt: now.toISOString() };
}

/** Stamp only chips that are not already in `current`. Existing rows keep their (missing) resolvedAt. */
export function stampNewTikTokKeywordChips(
  current: TikTokTargetingItem[],
  incoming: TikTokTargetingItem[],
  now = new Date(),
): TikTokTargetingItem[] {
  const existing = new Set(
    current.filter((item) => item.id).map((item) => `${item.kind}:${item.id}`),
  );
  return incoming.map((item) =>
    item.id && existing.has(`${item.kind}:${item.id}`)
      ? item
      : stampTikTokKeywordResolvedAt(item, now),
  );
}
