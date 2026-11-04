import "server-only";

import { graphGetWithToken } from "@/lib/meta/client";
import { withActPrefix } from "@/lib/meta/ad-account-id";
import type { VideoThumbnailCacheClient } from "@/lib/meta/video-thumbnail-cache";
import {
  adAccountMatchesAny,
} from "@/lib/meta/thumbnail-ad-account-allowlist";
import { fetchThumbnailImageBytes as readThumbnailImageBytes } from "@/lib/meta/thumbnail-proxy-order";

export {
  adAccountMatchesAny,
  adAccountMatchesClient,
  normalizeMetaAdAccountId,
} from "@/lib/meta/thumbnail-ad-account-allowlist";

export async function fetchThumbnailImageBytes(
  adId: string,
  fbToken: string,
  admin: VideoThumbnailCacheClient,
): Promise<{ buffer: Buffer; contentType: string }> {
  return readThumbnailImageBytes(adId, fbToken, admin, {
    graphGet: graphGetWithToken,
  });
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
