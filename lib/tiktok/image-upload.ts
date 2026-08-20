import { TikTokApiError, type BodyValue } from "./client.ts";
import { postTikTokWrite } from "./write/request.ts";
import type { TikTokPost, Sleep } from "./write/idempotency.ts";

/**
 * Official image upload for ad creatives.
 * FileImageAdUpload: upload_type is UPLOAD_BY_FILE | UPLOAD_BY_URL | UPLOAD_BY_FILE_ID.
 * UPLOAD_BY_VIDEO_ID is documented only on AdUploadBody (video bind), not here.
 * https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/FileImageAdUpload.md
 * https://ads.tiktok.com/marketing_api/docs?id=1739067433456642
 */
export const TIKTOK_AD_IMAGE_UPLOAD_PATH = "/file/image/ad/upload/";

export function readTikTokUploadedImageId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) {
    return readTikTokUploadedImageId(data[0]);
  }
  const record = data as Record<string, unknown>;
  if (typeof record.image_id === "string" && record.image_id.trim()) {
    return record.image_id.trim();
  }
  if (Array.isArray(record.list)) {
    return readTikTokUploadedImageId(record.list[0]);
  }
  return null;
}

export async function uploadTikTokAdImageByUrl(input: {
  advertiserId: string;
  token: string;
  imageUrl: string;
  fileName?: string;
  request?: TikTokPost;
  sleep?: Sleep;
}): Promise<string> {
  const imageUrl = input.imageUrl.trim();
  if (!imageUrl) {
    throw new TikTokApiError("UPLOAD_BY_URL requires an image URL");
  }
  const body: Record<string, BodyValue> = {
    advertiser_id: input.advertiserId,
    upload_type: "UPLOAD_BY_URL",
    image_url: imageUrl,
  };
  const fileName = input.fileName?.trim();
  if (fileName) body.file_name = fileName.slice(0, 100);

  const data = await postTikTokWrite<unknown>({
    path: TIKTOK_AD_IMAGE_UPLOAD_PATH,
    body,
    token: input.token,
    request: input.request,
    sleep: input.sleep,
  });
  const imageId = readTikTokUploadedImageId(data);
  if (!imageId) {
    const keys =
      data && typeof data === "object" ? Object.keys(data as object) : [];
    console.error(
      `[tiktok/image-upload] ${TIKTOK_AD_IMAGE_UPLOAD_PATH} returned no image_id keys=[${keys.join(",")}]`,
    );
    throw new TikTokApiError(
      `TikTok image upload returned no image_id. keys=[${keys.join(",")}]`,
    );
  }
  return imageId;
}
