/**
 * M.3 live mirror — notice Meta wizard edits without polling or
 * auto-deriving. The operator clicks Re-derive; this module only
 * decides when the chip must appear.
 */

export function isDerivedStale(
  metaUpdatedAt: string | null | undefined,
  lastDerivedAt: string | null | undefined,
): boolean {
  if (!metaUpdatedAt) return false;
  const metaMs = Date.parse(metaUpdatedAt);
  if (!Number.isFinite(metaMs)) return false;
  if (!lastDerivedAt) return true;
  const derivedMs = Date.parse(lastDerivedAt);
  if (!Number.isFinite(derivedMs)) return true;
  return metaMs > derivedMs;
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "recently";
  const deltaSec = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (deltaSec < 45) return "just now";
  const minutes = Math.round(deltaSec / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function formatMetaStaleChip(input: {
  metaUpdatedAt: string | null | undefined;
  lastDerivedAt: string | null | undefined;
  now?: Date;
}): string | null {
  if (!isDerivedStale(input.metaUpdatedAt, input.lastDerivedAt)) return null;
  const rel = formatRelativeTime(input.metaUpdatedAt!, input.now ?? new Date());
  return `Meta changed ${rel} after last derivation — Re-derive`;
}

/**
 * First visit this session: record ids, mark nothing new.
 * Later visits: ids not in the previous snapshot are new. The snapshot
 * advances after the comparison so a refresh of the same set clears the
 * marker.
 */
export function diffNewAssetIds(
  currentIds: readonly string[],
  seenIds: readonly string[] | null,
): { newIds: string[]; nextSeen: string[] } {
  const nextSeen = [...new Set(currentIds)];
  if (seenIds == null) {
    return { newIds: [], nextSeen };
  }
  const seen = new Set(seenIds);
  return {
    newIds: nextSeen.filter((id) => !seen.has(id)),
    nextSeen,
  };
}

export const PLAN_SEEN_ASSETS_KEY_PREFIX = "plan-seen-assets:";

export function planSeenAssetsStorageKey(planId: string): string {
  return `${PLAN_SEEN_ASSETS_KEY_PREFIX}${planId}`;
}
