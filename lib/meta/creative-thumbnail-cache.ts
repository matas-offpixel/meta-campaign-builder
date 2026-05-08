/**
 * Supabase Storage-backed cache for Meta ad creative thumbnails.
 *
 * Meta's snapshot-stored `creative.thumbnail_url` values expire within
 * minutes. We re-resolve via Graph at cache-miss time, persist bytes to
 * `creative-thumbnails/{ad_id}.{ext}`, and serve from Storage on hits so
 * `/api/proxy/creative-thumbnail` stays fast and deploy-stable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { fetchThumbnailImageBytes } from "@/lib/meta/thumbnail-proxy-server";
import {
  CREATIVE_THUMBNAIL_BUCKET,
  CREATIVE_THUMB_CACHE_SEC,
  storagePathForAd,
} from "@/lib/meta/creative-thumbnail-pure";

export {
  CREATIVE_THUMBNAIL_BUCKET,
  CREATIVE_THUMB_CACHE_SEC,
  metaPlaceholderSvgBytes,
  storagePathForAd,
} from "@/lib/meta/creative-thumbnail-pure";

function sanitizeAdId(adId: string): string | null {
  const t = adId.trim();
  if (!t || t.length > 64) return null;
  if (!/^[0-9]+$/.test(t)) return null;
  return t;
}

/**
 * Try to download a previously cached object. Tries common extensions.
 */
export async function downloadCachedThumbnail(
  admin: SupabaseClient<Database>,
  adId: string,
): Promise<{ buffer: Buffer; contentType: string; path: string } | null> {
  const safe = sanitizeAdId(adId);
  if (!safe) return null;
  for (const ext of ["jpg", "png", "webp", "gif"]) {
    const path = `${safe}.${ext}`;
    const { data, error } = await admin.storage
      .from(CREATIVE_THUMBNAIL_BUCKET)
      .download(path);
    if (error || !data) continue;
    const arr = new Uint8Array(await data.arrayBuffer());
    const ct =
      ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : ext === "gif"
            ? "image/gif"
            : "image/jpeg";
    return { buffer: Buffer.from(arr), contentType: ct, path };
  }
  return null;
}

export async function uploadThumbnailToCache(
  admin: SupabaseClient<Database>,
  adId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const safe = sanitizeAdId(adId);
  if (!safe) throw new Error("Invalid ad_id");
  const path = storagePathForAd(safe, contentType);
  const { error } = await admin.storage
    .from(CREATIVE_THUMBNAIL_BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: true,
      cacheControl: `${CREATIVE_THUMB_CACHE_SEC}`,
    });
  if (error) throw new Error(error.message);
  return path;
}

export interface FetchAndCacheThumbnailArgs {
  admin: SupabaseClient<Database>;
  adId: string;
  fbToken: string;
}

/**
 * Ensure Storage has fresh bytes for this ad (download Graph → CDN → upload).
 * Caller must have verified ad account ownership before calling.
 */
export async function fetchAndCacheThumbnail(
  args: FetchAndCacheThumbnailArgs,
): Promise<{ buffer: Buffer; contentType: string }> {
  const { buffer, contentType } = await fetchThumbnailImageBytes(
    args.adId,
    args.fbToken,
  );
  await uploadThumbnailToCache(args.admin, args.adId, buffer, contentType);
  return { buffer, contentType };
}

/**
 * Resolve thumbnail bytes: cache hit → Storage; miss → Meta fetch + upload.
 */
export async function resolveThumbnailBytes(
  args: FetchAndCacheThumbnailArgs,
): Promise<{
  buffer: Buffer;
  contentType: string;
  source: "cache" | "meta";
}> {
  const cached = await downloadCachedThumbnail(args.admin, args.adId);
  if (cached) {
    return {
      buffer: cached.buffer,
      contentType: cached.contentType,
      source: "cache",
    };
  }
  const fresh = await fetchAndCacheThumbnail(args);
  return { ...fresh, source: "meta" };
}
