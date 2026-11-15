/**
 * Supabase Storage-backed cache for Meta ad creative thumbnails.
 *
 * Meta's snapshot-stored `creative.thumbnail_url` values expire within
 * minutes. We re-resolve via Graph at cache-miss time, persist bytes to
 * `creative-thumbnails/v2/{ad_id}.{ext}`, and serve from Storage on hits so
 * `/api/proxy/creative-thumbnail` stays fast and deploy-stable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { fetchThumbnailImageBytes } from "@/lib/meta/thumbnail-proxy-server";
import {
  downloadVersionedThumbnail,
  resolveStoredThumbnail,
  uploadVersionedThumbnail,
} from "@/lib/meta/creative-thumbnail-store";
import { CREATIVE_THUMBNAIL_BUCKET } from "@/lib/meta/creative-thumbnail-pure";

export {
  CREATIVE_THUMBNAIL_BUCKET,
  CREATIVE_THUMB_CACHE_SEC,
  CREATIVE_THUMB_MIN_BYTES,
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
 * The refreshed `v2/{adId}.{ext}` object. A root `{adId}.{ext}` from the
 * old order is left unread so the next request fetches once.
 */
export async function downloadCachedThumbnail(
  admin: SupabaseClient<Database>,
  adId: string,
): Promise<{ buffer: Buffer; contentType: string; path: string } | null> {
  const safe = sanitizeAdId(adId);
  if (!safe) return null;
  return downloadVersionedThumbnail(
    admin.storage.from(CREATIVE_THUMBNAIL_BUCKET),
    safe,
  );
}

export async function uploadThumbnailToCache(
  admin: SupabaseClient<Database>,
  adId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const safe = sanitizeAdId(adId);
  if (!safe) throw new Error("Invalid ad_id");
  return uploadVersionedThumbnail(
    admin.storage.from(CREATIVE_THUMBNAIL_BUCKET),
    safe,
    buffer,
    contentType,
  );
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
  const resolved = await resolveThumbnailBytes(args);
  return { buffer: resolved.buffer, contentType: resolved.contentType };
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
  const safe = sanitizeAdId(args.adId);
  if (!safe) throw new Error("Invalid ad_id");
  return resolveStoredThumbnail({
    bucket: args.admin.storage.from(CREATIVE_THUMBNAIL_BUCKET),
    adId: safe,
    load: () => fetchThumbnailImageBytes(safe, args.fbToken, args.admin),
  });
}
