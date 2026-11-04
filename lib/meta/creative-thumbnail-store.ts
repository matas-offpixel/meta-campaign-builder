import {
  CREATIVE_THUMB_CACHE_SEC,
  CREATIVE_THUMB_PROXY_VERSION,
  versionedStoragePathForAd,
} from "./creative-thumbnail-pure.ts";

const EXTENSIONS = ["jpg", "png", "webp", "gif"] as const;

export interface ThumbnailBucket {
  download(path: string): Promise<{
    data: { arrayBuffer(): Promise<ArrayBuffer> } | null;
    error: { message: string } | null;
  }>;
  upload(
    path: string,
    body: Buffer,
    options?: { contentType?: string; upsert?: boolean; cacheControl?: string },
  ): Promise<{ error: { message: string } | null }>;
}

function contentTypeForExt(ext: string): string {
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

/**
 * A `v2/` object is the refreshed card. It is served even when it is
 * still under the size floor, so a creative whose best image is small
 * is not fetched again. An object at `{adId}.jpg` (the old order) is
 * not read.
 */
export async function downloadVersionedThumbnail(
  bucket: ThumbnailBucket,
  adId: string,
): Promise<{ buffer: Buffer; contentType: string; path: string } | null> {
  for (const ext of EXTENSIONS) {
    const path = `${CREATIVE_THUMB_PROXY_VERSION}/${adId}.${ext}`;
    const { data, error } = await bucket.download(path);
    if (error || !data) continue;
    return {
      buffer: Buffer.from(await data.arrayBuffer()),
      contentType: contentTypeForExt(ext),
      path,
    };
  }
  return null;
}

export async function uploadVersionedThumbnail(
  bucket: ThumbnailBucket,
  adId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const path = versionedStoragePathForAd(adId, contentType);
  const { error } = await bucket.upload(path, buffer, {
    contentType,
    upsert: true,
    cacheControl: `${CREATIVE_THUMB_CACHE_SEC}`,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function resolveStoredThumbnail(input: {
  bucket: ThumbnailBucket;
  adId: string;
  load: () => Promise<{ buffer: Buffer; contentType: string }>;
}): Promise<{ buffer: Buffer; contentType: string; source: "cache" | "meta" }> {
  const cached = await downloadVersionedThumbnail(input.bucket, input.adId);
  if (cached) {
    return { buffer: cached.buffer, contentType: cached.contentType, source: "cache" };
  }
  const fresh = await input.load();
  await uploadVersionedThumbnail(input.bucket, input.adId, fresh.buffer, fresh.contentType);
  return { ...fresh, source: "meta" };
}
