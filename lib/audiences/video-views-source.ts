import { AUDIENCE_SUBTYPE_LABELS } from "./metadata.ts";

export interface VideoViewsDraftParts {
  /** Flat `sourceId` from request (comma-separated video ids). */
  flatSourceId?: string;
  /** Per-subtype override map */
  sourceIdsVideo?: string;
  videoIds: string[];
  campaignIds: string[];
}

/**
 * Resolves the persisted `source_id` key for video_views (comma-separated video ids).
 * @throws If campaigns are selected but no videos; if nothing usable is provided.
 */
export function resolveVideoViewsSourceId(parts: VideoViewsDraftParts): string {
  const flat =
    (parts.flatSourceId ?? "").trim() ||
    (parts.sourceIdsVideo ?? "").trim();

  if (parts.videoIds.length > 0) {
    return parts.videoIds.join(",");
  }
  if (flat) {
    return flat;
  }
  if (parts.campaignIds.length > 0) {
    throw new Error("No video creatives selected for this audience.");
  }
  throw new Error(
    `${AUDIENCE_SUBTYPE_LABELS.video_views} source ID is required`,
  );
}
