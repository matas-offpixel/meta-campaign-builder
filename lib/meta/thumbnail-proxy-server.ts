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
  };
}

export async function fetchThumbnailImageBytes(
  adId: string,
  fbToken: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const row = await graphGetWithToken<CreativeThumbnailFields>(
    `/${adId}`,
    { fields: "creative{thumbnail_url,image_url}" },
    fbToken,
  );
  const url =
    row.creative?.thumbnail_url?.trim() ||
    row.creative?.image_url?.trim() ||
    null;
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
