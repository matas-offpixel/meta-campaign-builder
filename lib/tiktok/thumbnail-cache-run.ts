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
  cacheTikTokSparkItemThumbnails,
  cacheTikTokThumbnails,
  thumbnailIdsForRows,
  TIKTOK_THUMB_MAX_CALLS_PER_RUN,
  type CacheTikTokThumbnailsInput,
  type SparkThumbnailItem,
  type TikTokThumbnailMissingReason,
} from "./thumbnail-cache.ts";

export interface ThumbnailRowIds {
  video_id?: string | null;
  image_ids?: string[] | null;
  tiktok_item_id?: string | null;
  identity_id?: string | null;
  identity_type?: string | null;
  identity_bc_id?: string | null;
}

export interface TikTokThumbnailRunStats {
  calls: number;
  cached: number;
  stored: number;
  missing: number;
  /** Rows with no video id, no image id, and no tiktok_item_id. */
  rowsWithoutIds: number;
  /** `/tt_video/list/` pages fetched for Spark covers. */
  sparkPages: number;
  /** Identities skipped because the post list was denied or Spark auth had ended. */
  sparkIdentitiesSkipped: number;
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
    sparkPages: 0,
    sparkIdentitiesSkipped: 0,
    outcomes: new Map(),
  };
  const budget = { callsLeft: input.maxCalls ?? TIKTOK_THUMB_MAX_CALLS_PER_RUN };
  const ready: Array<{
    accountId: string;
    advertiserId: string;
    token: string;
    rows: readonly ThumbnailRowIds[];
  }> = [];
  const readCredentials =
    input.readCredentials ??
    ((accountId: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getTikTokCredentials(input.supabase as any, accountId));

  for (const [accountId, rows] of input.rowsByAccount) {
    const { videoIds, imageIds } = thumbnailIdsForRows(rows);
    stats.rowsWithoutIds += rows.filter(
      (r) => !r.video_id && !(r.image_ids?.length) && !r.tiktok_item_id,
    ).length;
    const idCount = videoIds.length + imageIds.length;
    const spark = sparkItems(rows);
    if (idCount === 0 && spark.length === 0) continue;

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
      for (const item of spark) {
        stats.missing += 1;
        stats.outcomes.set(`${accountId}:item:${item.itemId}`, {
          kind: "missing",
          reason: item.identityId && item.identityType ? "no_credentials" : "spark_identity_missing",
        });
      }
      continue;
    }
    ready.push({ accountId, advertiserId, token, rows });
    if (idCount === 0) continue;

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

  for (const account of ready) {
    const items = sparkItems(account.rows);
    if (items.length === 0) continue;
    const res = await cacheTikTokSparkItemThumbnails({
      admin: input.supabase,
      advertiserId: account.advertiserId,
      token: account.token,
      items,
      budget,
      dryRun: input.dryRun,
      request: input.request,
      fetchImage: input.fetchImage,
    });
    stats.calls += res.calls;
    stats.sparkPages += res.pages;
    stats.sparkIdentitiesSkipped += res.identitiesSkipped;
    stats.cached += res.cached;
    stats.stored += res.stored;
    stats.missing += res.missing;
    for (const [key, outcome] of res.outcomes) {
      stats.outcomes.set(`${account.accountId}:${key}`, { kind: outcome.kind, reason: outcome.reason });
    }
  }
  return stats;
}

function sparkItems(rows: readonly ThumbnailRowIds[]): SparkThumbnailItem[] {
  const byId = new Map<string, SparkThumbnailItem>();
  for (const row of rows) {
    if (row.video_id || row.image_ids?.length || !row.tiktok_item_id) continue;
    if (byId.has(row.tiktok_item_id)) continue;
    byId.set(row.tiktok_item_id, {
      itemId: row.tiktok_item_id,
      identityId: row.identity_id ?? null,
      identityType: row.identity_type ?? null,
      identityBcId: row.identity_bc_id ?? null,
    });
  }
  return [...byId.values()];
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
