export type TikTokAssignmentMap = Record<string, string[]>;

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

export function toggleTikTokAssignment(
  byAdGroupId: TikTokAssignmentMap,
  adGroupId: string,
  creativeId: string,
): TikTokAssignmentMap {
  const current = byAdGroupId[adGroupId] ?? [];
  const next = current.includes(creativeId)
    ? current.filter((id) => id !== creativeId)
    : [...current, creativeId];
  return { ...byAdGroupId, [adGroupId]: next };
}

export function assignTikTokCreativesToAdGroup(
  byAdGroupId: TikTokAssignmentMap,
  adGroupId: string,
  creativeIds: string[],
): TikTokAssignmentMap {
  return { ...byAdGroupId, [adGroupId]: unique(creativeIds) };
}

export function clearTikTokAdGroupAssignments(
  byAdGroupId: TikTokAssignmentMap,
  adGroupId: string,
): TikTokAssignmentMap {
  return { ...byAdGroupId, [adGroupId]: [] };
}

export function assignTikTokCreativeToAllAdGroups(
  byAdGroupId: TikTokAssignmentMap,
  adGroupIds: string[],
  creativeId: string,
): TikTokAssignmentMap {
  const next = { ...byAdGroupId };
  for (const adGroupId of adGroupIds) {
    const current = next[adGroupId] ?? [];
    next[adGroupId] = current.includes(creativeId)
      ? [...current]
      : [...current, creativeId];
  }
  return next;
}

export function clearTikTokCreativeFromAllAdGroups(
  byAdGroupId: TikTokAssignmentMap,
  adGroupIds: string[],
  creativeId: string,
): TikTokAssignmentMap {
  const next = { ...byAdGroupId };
  for (const adGroupId of adGroupIds) {
    next[adGroupId] = (next[adGroupId] ?? []).filter((id) => id !== creativeId);
  }
  return next;
}

export function assignTikTokEverything(
  byAdGroupId: TikTokAssignmentMap,
  adGroupIds: string[],
  creativeIds: string[],
): TikTokAssignmentMap {
  const next = { ...byAdGroupId };
  const ids = unique(creativeIds);
  for (const adGroupId of adGroupIds) {
    next[adGroupId] = [...ids];
  }
  return next;
}

/**
 * Drops assignment entries for ad groups that no longer exist. Without this a
 * creative assigned only to a removed ad group still satisfies
 * `everyCreativeAssigned`, so the review checklist reads green while that
 * creative launches nowhere.
 */
export function pruneTikTokAssignments(
  byAdGroupId: TikTokAssignmentMap,
  adGroupIds: string[],
): { byAdGroupId: TikTokAssignmentMap; pruned: boolean } {
  const keep = new Set(adGroupIds);
  const entries = Object.entries(byAdGroupId).filter(([adGroupId]) =>
    keep.has(adGroupId),
  );
  return {
    byAdGroupId: Object.fromEntries(entries),
    pruned: entries.length !== Object.keys(byAdGroupId).length,
  };
}

export function clearTikTokEverything(
  byAdGroupId: TikTokAssignmentMap,
  adGroupIds: string[],
): TikTokAssignmentMap {
  const next = { ...byAdGroupId };
  for (const adGroupId of adGroupIds) {
    next[adGroupId] = [];
  }
  return next;
}
