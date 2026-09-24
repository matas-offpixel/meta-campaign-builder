import type { RawCreative } from "./creative-preview-extract.ts";

/**
 * Derive a stable asset signature for the second-layer grouper.
 * First non-null in the priority order wins:
 *   1. object_story_spec.video_data.video_id → "video:${id}"
 *   2. object_story_spec.link_data.image_hash → "image:${hash}"
 *   3. asset_feed_spec.images[].hash (sorted)  → "assetset:${hashes}"
 *   4. asset_feed_spec.videos[].video_id (sorted) → "videoset:${ids}"
 *   5. top-level creative.video_id              → "video:${id}"
 *
 * Pure / structural — exported for unit tests and re-use from any
 * fetch path that produces the same RawCreative shape. Lives here,
 * not in `active-creatives-fetch.ts`, so a node test can call it
 * without loading `lib/meta/client.ts`.
 *
 * Returns `null` when nothing usable is present.
 */
export function deriveAssetSignature(
  creative: RawCreative | undefined,
): string | null {
  if (!creative) return null;
  const oss = creative.object_story_spec;
  const ossVideoId = oss?.video_data?.video_id?.trim();
  if (ossVideoId) return `video:${ossVideoId}`;

  const imageHash = oss?.link_data?.image_hash?.trim();
  if (imageHash) return `image:${imageHash}`;

  const afsImageHashes = creative.asset_feed_spec?.images
    ?.map((i) => i.hash?.trim())
    .filter((h): h is string => !!h && h.length > 0)
    .sort();
  if (afsImageHashes && afsImageHashes.length > 0) {
    return `assetset:${afsImageHashes.join("|")}`;
  }

  const afsVideoIds = creative.asset_feed_spec?.videos
    ?.map((v) => v.video_id?.trim())
    .filter((id): id is string => !!id && id.length > 0)
    .sort();
  if (afsVideoIds && afsVideoIds.length > 0) {
    return `videoset:${afsVideoIds.join("|")}`;
  }

  const topVideoId = creative.video_id?.trim();
  if (topVideoId) return `video:${topVideoId}`;

  return null;
}
