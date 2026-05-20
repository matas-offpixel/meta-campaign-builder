/**
 * Collect the FB Page IDs that own a Meta ad creative.
 *
 * Mirrors the multi-shape extraction PR #391 added to
 * `lib/audiences/sources.ts` (`walkCampaignAds`), distilled into a
 * pure helper so the snapshot writer (cron, runs from a different
 * fetch path) can use the SAME logic without duplicating it. Used
 * by `lib/audiences/snapshot-video-sources-from-payload.ts` to
 * pull (video_id, context_page_id) pairs out of a hydrated
 * creative and persist them in the snapshot payload — the read
 * side then feeds the page id straight into
 * `audience-payload.ts`'s `video_views` branch as
 * `source_meta.contextId`.
 *
 * Three creative shapes carry the owning Page id in production:
 *
 *   1. `creative.object_story_spec.page_id`         — standard ads
 *      (single page-post / single video / single link).
 *   2. `creative.platform_customizations.{facebook,instagram}.page_id`
 *      — Advantage+ / dynamic creatives that swap the per-placement
 *      page reference into the platform-specific block instead of
 *      surfacing it on the top-level OSS.
 *   3. `creative.asset_feed_spec.page_ids[]`         — asset-feed
 *      creatives that nominate a pool of pages Meta selects from
 *      per impression.
 *
 * Order of return matches Meta's surfacing convention: OSS first,
 * then platform_customizations (facebook then instagram), then
 * asset_feed_spec. Duplicates ARE preserved so callers can count
 * occurrences (the writer cares about pair-deduping, not
 * within-creative dedup); pass through `new Set()` if you only
 * want distinct ids.
 *
 * Empty result is a meaningful signal: this creative has no
 * resolvable owning Page from any of the three sources, which means
 * the audience builder MUST fall back to the live walk for the
 * containing event. The reader path uses this to filter "orphan"
 * snapshot videos and degrade per-event rather than per-cell.
 */
export function extractPageIdsFromCreative(
  creative: Record<string, unknown> | null | undefined,
): string[] {
  const ids: string[] = [];
  if (!creative || typeof creative !== "object") return ids;

  // 1. object_story_spec.page_id — top-level single string.
  const oss = creative.object_story_spec as
    | Record<string, unknown>
    | undefined;
  const ossPageId = oss?.page_id;
  if (typeof ossPageId === "string" && ossPageId) {
    ids.push(ossPageId);
  }

  // 2. platform_customizations.{facebook,instagram}.page_id.
  // Only the two surfaces Meta supports today — kept explicit
  // rather than walking every key so we don't accidentally
  // pull in unrelated string fields named `page_id` nested
  // deeper in the platform_customizations sub-tree.
  const platforms = creative.platform_customizations as
    | Record<string, { page_id?: unknown }>
    | undefined;
  for (const platform of ["facebook", "instagram"] as const) {
    const platformPageId = platforms?.[platform]?.page_id;
    if (typeof platformPageId === "string" && platformPageId) {
      ids.push(platformPageId);
    }
  }

  // 3. asset_feed_spec.page_ids[] — array of strings.
  const assetFeed = creative.asset_feed_spec as
    | { page_ids?: unknown }
    | undefined;
  if (Array.isArray(assetFeed?.page_ids)) {
    for (const id of assetFeed.page_ids) {
      if (typeof id === "string" && id) {
        ids.push(id);
      }
    }
  }

  return ids;
}
