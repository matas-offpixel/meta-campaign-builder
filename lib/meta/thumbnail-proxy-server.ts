import "server-only";

import { graphGetWithToken } from "@/lib/meta/client";
import { withActPrefix } from "@/lib/meta/ad-account-id";
import {
  fetchThumbnailUrl,
  type VideoThumbnailCacheClient,
} from "@/lib/meta/video-thumbnail-cache";
import {
  adAccountMatchesAny,
} from "@/lib/meta/thumbnail-ad-account-allowlist";

export {
  adAccountMatchesAny,
  adAccountMatchesClient,
  normalizeMetaAdAccountId,
} from "@/lib/meta/thumbnail-ad-account-allowlist";

interface CreativeThumbnailFields {
  creative?: {
    thumbnail_url?: string;
    image_url?: string;
    video_id?: string;
  };
}

export async function fetchThumbnailImageBytes(
  adId: string,
  fbToken: string,
  admin: VideoThumbnailCacheClient,
): Promise<{ buffer: Buffer; contentType: string }> {
  const row = await graphGetWithToken<CreativeThumbnailFields>(
    `/${adId}`,
    { fields: "creative{thumbnail_url,image_url,video_id}" },
    fbToken,
  );
  let url =
    row.creative?.thumbnail_url?.trim() ||
    row.creative?.image_url?.trim() ||
    null;

  // For video creatives that don't expose thumbnail_url directly (e.g. some
  // Reels-format ads), fall back to the video_id-keyed thumbnail cache
  // (lib/meta/video-thumbnail-cache.ts) — the ONLY path allowed to call
  // Meta's /{video_id}/thumbnails edge. Storage-cache-first; only hits
  // Meta on a genuine miss.
  if (!url && row.creative?.video_id) {
    try {
      url = await fetchThumbnailUrl({
        videoId: row.creative.video_id,
        token: fbToken,
        admin,
      });
    } catch {
      // non-fatal — fall through to the error below
    }
  }

  if (!url) {
    throw new Error("No thumbnail URL on creative");
  }
  const imgRes = await fetch(url, { cache: "no-store" });
  if (!imgRes.ok) {
    throw new Error(`Thumbnail fetch failed: HTTP ${imgRes.status}`);
  }
  const contentType =
    imgRes.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  return { buffer, contentType };
}

export async function verifyAdAccountForThumbnail(
  adId: string,
  fbToken: string,
  /**
   * One or more allowed Meta ad account ids (client default and/or
   * per-event overrides). Bare digits or `act_` — normalised before compare.
   */
  allowedAdAccountIds: string | readonly string[],
): Promise<boolean> {
  const allowed = (
    typeof allowedAdAccountIds === "string"
      ? [allowedAdAccountIds]
      : [...allowedAdAccountIds]
  ).filter((id) => id.trim().length > 0);
  if (allowed.length === 0) return false;

  const head = await graphGetWithToken<{ account_id?: string }>(
    `/${adId}`,
    { fields: "account_id" },
    fbToken,
  );
  // Prefer set match; single-id callers (warm path) still work via the array wrap.
  return adAccountMatchesAny(head.account_id, allowed);
}

export { withActPrefix };
