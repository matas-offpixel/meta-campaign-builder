/**
 * lib/tiktok/thumbnail-cache-run.ts
 *
 * One pass of `cacheTikTokThumbnails` over snapshot rows grouped by TikTok
 * account. Shared by `/api/cron/tiktok-active-creatives` (after the
 * snapshot rows are written) and `scripts/backfill-tiktok-thumbnails.mts`.
 *
 * The advertiser id is `tiktok_accounts.tiktok_advertiser_id`, the same
 * value `readActiveTikTokCreativesSnapshot` reads back, so the Storage key
 * written here is the key the reader looks for. An account without it is
 * skipped and its ids count as missing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getTikTokCredentials } from "./credentials.ts";
import {
  cacheTikTokThumbnails,
  thumbnailIdsForRows,
  TIKTOK_THUMB_MAX_CALLS_PER_RUN,
  type CacheTikTokThumbnailsInput,
  type TikTokThumbnailMissingReason,
} from "./thumbnail-cache.ts";

export interface ThumbnailRowIds {
  video_id?: string | null;
  image_ids?: string[] | null;
}

export interface TikTokThumbnailRunStats {
  calls: number;
  cached: number;
  stored: number;
  missing: number;
  /** Rows with neither a video_id nor an image id (Spark ads with only tiktok_item_id). */
  rowsWithoutIds: number;
  /** `${accountId}:${kind}:${id}` → outcome. */
  outcomes: Map<
    string,
    { kind: "cached" | "stored" | "missing"; reason?: TikTokThumbnailMissingReason | "no_credentials" }
  >;
}

export async function cacheThumbnailsForAccounts(input: {
  supabase: SupabaseClient;
  rowsByAccount: ReadonlyMap<string, readonly ThumbnailRowIds[]>;
  dryRun?: boolean;
  maxCalls?: number;
  /** Test hooks. */
  readCredentials?: (accountId: string) => Promise<{ access_token: string } | null>;
  request?: CacheTikTokThumbnailsInput["request"];
  fetchImage?: typeof fetch;
}): Promise<TikTokThumbnailRunStats> {
  const stats: TikTokThumbnailRunStats = {
    calls: 0,
    cached: 0,
    stored: 0,
    missing: 0,
    rowsWithoutIds: 0,
    outcomes: new Map(),
  };
  const budget = { callsLeft: input.maxCalls ?? TIKTOK_THUMB_MAX_CALLS_PER_RUN };
  const readCredentials =
    input.readCredentials ??
    ((accountId: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getTikTokCredentials(input.supabase as any, accountId));

  for (const [accountId, rows] of input.rowsByAccount) {
    const { videoIds, imageIds } = thumbnailIdsForRows(rows);
    stats.rowsWithoutIds += rows.filter(
      (r) => !r.video_id && !(r.image_ids?.length),
    ).length;
    const idCount = videoIds.length + imageIds.length;
    if (idCount === 0) continue;

    const advertiserId = await readAdvertiserId(input.supabase, accountId);
    let token: string | null = null;
    try {
      token = advertiserId ? ((await readCredentials(accountId))?.access_token ?? null) : null;
    } catch (err) {
      console.warn(
        `[tiktok-thumbnail-cache] credentials failed account=${accountId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (!advertiserId || !token) {
      console.warn(
        `[tiktok-thumbnail-cache] skip account=${accountId} advertiser=${advertiserId ?? "none"} token=${token ? "yes" : "no"}`,
      );
      stats.missing += idCount;
      for (const id of videoIds) stats.outcomes.set(`${accountId}:video:${id}`, { kind: "missing", reason: "no_credentials" });
      for (const id of imageIds) stats.outcomes.set(`${accountId}:image:${id}`, { kind: "missing", reason: "no_credentials" });
      continue;
    }

    const res = await cacheTikTokThumbnails({
      admin: input.supabase,
      advertiserId,
      token,
      videoIds,
      imageIds,
      budget,
      dryRun: input.dryRun,
      request: input.request,
      fetchImage: input.fetchImage,
    });
    stats.calls += res.calls;
    stats.cached += res.cached;
    stats.stored += res.stored;
    stats.missing += res.missing;
    for (const [key, outcome] of res.outcomes) {
      stats.outcomes.set(`${accountId}:${key}`, { kind: outcome.kind, reason: outcome.reason });
    }
  }
  return stats;
}

async function readAdvertiserId(
  supabase: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("tiktok_accounts")
    .select("tiktok_advertiser_id")
    .eq("id", accountId)
    .maybeSingle();
  return (data as { tiktok_advertiser_id?: string | null } | null)?.tiktok_advertiser_id ?? null;
}
