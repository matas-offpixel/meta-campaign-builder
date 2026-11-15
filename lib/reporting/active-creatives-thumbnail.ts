export interface ActiveCreativeThumbnailPreview {
  image_url: string | null;
  is_low_res_fallback?: boolean;
}

/**
 * The video whose cached thumbnail should replace this preview's image:
 * any low-res tier (`top_thumbnail_url` 64px, `afs_video_thumb`,
 * `video_id_graph_fallback`) on a creative that has a video id.
 */
export function videoIdToUpgrade(
  preview: { video_id?: string | null; is_low_res_fallback?: boolean } | null | undefined,
): string | null {
  if (preview?.is_low_res_fallback !== true) return null;
  return preview.video_id?.trim() || null;
}

export function resolveActiveCreativeModalImage(
  preview: ActiveCreativeThumbnailPreview,
  representativeThumbnail: string | null,
): string | null {
  if (preview.is_low_res_fallback === true && representativeThumbnail) {
    return representativeThumbnail;
  }
  return preview.image_url ?? representativeThumbnail;
}
