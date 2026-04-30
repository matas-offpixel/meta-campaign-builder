export interface ActiveCreativeThumbnailPreview {
  image_url: string | null;
  is_low_res_fallback?: boolean;
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
