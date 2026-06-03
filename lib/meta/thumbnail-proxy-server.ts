import "server-only";

import { graphGetWithToken } from "@/lib/meta/client";
import { withActPrefix, withoutActPrefix } from "@/lib/meta/ad-account-id";

export function normalizeMetaAdAccountId(
  raw: string | null | undefined,
): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  return withoutActPrefix(t);
}

/** Compare Graph `account_id` (may be `act_…` or digits) to stored client id. */
export function adAccountMatchesClient(
  graphAccountId: string | null | undefined,
  clientAdAccountId: string | null | undefined,
): boolean {
  if (!graphAccountId || !clientAdAccountId) return false;
  return (
    normalizeMetaAdAccountId(graphAccountId) ===
    normalizeMetaAdAccountId(clientAdAccountId)
  );
}

interface CreativeThumbnailFields {
  creative?: {
    thumbnail_url?: string;
    image_url?: string;
    video_id?: string;
  };
}

interface VideoThumbnailsResponse {
  data?: Array<{ uri?: string; width?: number; is_preferred?: boolean }>;
}

function pickVideoThumbnailUri(
  data: VideoThumbnailsResponse["data"],
): string | null {
  if (!data?.length) return null;
  const valid = data
    .map((row, index) => ({
      uri: row.uri?.trim() || null,
      width: typeof row.width === "number" && Number.isFinite(row.width) ? row.width : 0,
      isPreferred: row.is_preferred === true,
      index,
    }))
    .filter((row): row is { uri: string; width: number; isPreferred: boolean; index: number } =>
      Boolean(row.uri),
    );
  if (valid.length === 0) return null;
  return (
    valid.find((row) => row.isPreferred) ??
    [...valid].sort((a, b) => b.width - a.width || a.index - b.index)[0]
  ).uri;
}

export async function fetchThumbnailImageBytes(
  adId: string,
  fbToken: string,
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
  // Reels-format ads), fall back to /{video_id}/thumbnails which returns a
  // richer set of CDN URLs and always has at least one entry.
  if (!url && row.creative?.video_id) {
    try {
      const thumbRes = await graphGetWithToken<VideoThumbnailsResponse>(
        `/${row.creative.video_id}/thumbnails`,
        { fields: "uri,width,is_preferred" },
        fbToken,
      );
      url = pickVideoThumbnailUri(thumbRes.data);
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
  clientAdAccountId: string,
): Promise<boolean> {
  const head = await graphGetWithToken<{ account_id?: string }>(
    `/${adId}`,
    { fields: "account_id" },
    fbToken,
  );
  return adAccountMatchesClient(head.account_id, clientAdAccountId);
}

export { withActPrefix };
