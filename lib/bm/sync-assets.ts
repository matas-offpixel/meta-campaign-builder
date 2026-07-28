import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  listClientAdAccounts,
  listClientInstagramAssets,
  listClientPixels,
  listOwnedAdAccounts,
  listOwnedInstagramAssets,
  listOwnedPixels,
  readOperatorTasks,
  type MetaBMAdAccount,
  type MetaBMIgAsset,
  type MetaBMPixel,
} from "@/lib/meta/business-manager-assets";
import { resolveBusinessScopedUserId } from "@/lib/meta/business-manager";
import {
  getBusinessManagerToken,
  markBusinessManagerTokenExpired,
  updateBusinessManagerScanState,
} from "@/lib/db/business-managers";
import {
  logAssetAccessEvent,
  logAssetAccessEventsBulk,
  upsertBMAssets,
  type UpsertAdAccountInput,
  type UpsertAssetInput,
  type UpsertIgAccountInput,
  type UpsertPixelInput,
} from "@/lib/db/bm-assets";
import { BM_V2_ASSET_KINDS, describeAssetKind, type BMAssetKind } from "@/lib/bm/asset-kinds";
import { isTokenExpiredMetaError } from "@/lib/bm/sync";
import { chunk } from "@/lib/bm/chunk";
import type { BusinessManager } from "@/lib/bm/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

/** Mirrors the page-scan checkpoint boundary (see lib/bm/sync.ts). */
const DETECTED_NEW_CHECKPOINT_BOUNDARY = 100;

export interface AssetScanResult {
  businessId: string;
  kind: BMAssetKind;
  scanned: number;
  newAssets: number;
  missingAccess: number;
  ok: boolean;
  error?: string;
}

function emptyResult(bizId: string, kind: BMAssetKind, error: string): AssetScanResult {
  return {
    businessId: bizId,
    kind,
    scanned: 0,
    newAssets: 0,
    missingAccess: 0,
    ok: false,
    error,
  };
}

/** Meta returns timestamps like "2026-05-26T14:11:17+0100" — valid for Postgres timestamptz. */
function toTimestamp(value: string | undefined): string | null {
  return value ?? null;
}

function mapAdAccount(
  row: MetaBMAdAccount,
  ownedByBm: boolean,
  bsuId: string,
): UpsertAdAccountInput {
  const tasks = readOperatorTasks(row, bsuId);
  return {
    ad_account_id: row.id,
    account_id: row.account_id ?? null,
    name: row.name ?? null,
    account_status: row.account_status ?? null,
    currency: row.currency ?? null,
    timezone_name: row.timezone_name ?? null,
    disable_reason: row.disable_reason ?? null,
    is_owned_by_bm: ownedByBm,
    user_has_access: tasks.length > 0,
    user_tasks: tasks,
  };
}

function mapPixel(row: MetaBMPixel, ownedByBm: boolean, bsuId: string): UpsertPixelInput {
  const tasks = readOperatorTasks(row, bsuId);
  return {
    pixel_id: row.id,
    name: row.name ?? null,
    last_fired_time: toTimestamp(row.last_fired_time),
    creation_time: toTimestamp(row.creation_time),
    is_unavailable: row.is_unavailable ?? null,
    enable_automatic_matching: row.enable_automatic_matching ?? null,
    data_use_setting: row.data_use_setting ?? null,
    is_owned_by_bm: ownedByBm,
    user_has_access: tasks.length > 0,
    user_tasks: tasks,
  };
}

function mapIgAsset(row: MetaBMIgAsset, ownedByBm: boolean, bsuId: string): UpsertIgAccountInput {
  const tasks = readOperatorTasks(row, bsuId);
  return {
    ig_asset_id: row.id,
    ig_user_id: row.ig_user_id ?? null,
    ig_username: row.ig_username ?? null,
    profile_pic_url: row.profile_pic ?? null,
    followers: row.followed_by_count ?? null,
    media_count: row.media_count ?? null,
    is_owned_by_bm: ownedByBm,
    user_has_access: tasks.length > 0,
    user_tasks: tasks,
  };
}

/** Fetches + maps both edges for a kind. Owned wins the ownership flag on collision. */
async function fetchAndMap(
  kind: BMAssetKind,
  bizId: string,
  token: string,
  bsuId: string,
): Promise<Map<string, UpsertAssetInput>> {
  const merged = new Map<string, UpsertAssetInput>();

  if (kind === "ad_account") {
    const [owned, client] = await Promise.all([
      listOwnedAdAccounts(bizId, token),
      listClientAdAccounts(bizId, token),
    ]);
    for (const row of client) merged.set(row.id, mapAdAccount(row, false, bsuId));
    for (const row of owned) merged.set(row.id, mapAdAccount(row, true, bsuId));
    return merged;
  }

  if (kind === "pixel") {
    const [owned, client] = await Promise.all([
      listOwnedPixels(bizId, token),
      listClientPixels(bizId, token),
    ]);
    for (const row of client) merged.set(row.id, mapPixel(row, false, bsuId));
    for (const row of owned) merged.set(row.id, mapPixel(row, true, bsuId));
    return merged;
  }

  const [owned, client] = await Promise.all([
    listOwnedInstagramAssets(bizId, token),
    listClientInstagramAssets(bizId, token),
  ]);
  for (const row of client) merged.set(row.id, mapIgAsset(row, false, bsuId));
  for (const row of owned) merged.set(row.id, mapIgAsset(row, true, bsuId));
  return merged;
}

/**
 * Scan one asset kind for one Business Manager: enumerate owned + client assets
 * (with assignments inlined), upsert them, and write a `detected_new` event for
 * anything seen for the first time.
 *
 * NEVER grants access — detection only, same "flag, don't auto-action"
 * invariant as the page scan. Grants live behind an explicit UI click.
 *
 * Access state comes from the inlined `assigned_users` expansion rather than a
 * separate per-asset read, which is why the operator's business-scoped user id
 * must be resolved first: the expansion returns business-scoped ids, and the
 * Facebook-level `/me` id will never match one.
 */
export async function scanBusinessManagerAssetKind(
  supabase: AnySupabaseClient,
  bm: BusinessManager,
  kind: BMAssetKind,
  opts: { actorUserId?: string | null; token?: string; businessScopedUserId?: string } = {},
): Promise<AssetScanResult> {
  const bizId = bm.business_id;
  const actorUserId = opts.actorUserId ?? bm.added_by_user_id ?? null;
  const label = describeAssetKind(kind).labelPlural;

  let token = opts.token ?? null;
  if (!token) {
    try {
      token = await getBusinessManagerToken(supabase, bm.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "decrypt_failed";
      console.error(`[bm-asset-scan] biz=${bizId} kind=${kind} token decrypt failed: ${msg}`);
      await updateBusinessManagerScanState(supabase, bizId, { lastError: msg });
      return emptyResult(bizId, kind, msg);
    }
  }
  if (!token) {
    const msg = "no_token_stored";
    console.error(`[bm-asset-scan] biz=${bizId} kind=${kind} ${msg}`);
    return emptyResult(bizId, kind, msg);
  }

  let bsuId: string;
  let merged: Map<string, UpsertAssetInput>;
  try {
    bsuId = opts.businessScopedUserId ?? (await resolveBusinessScopedUserId(bizId, token));
    merged = await fetchAndMap(kind, bizId, token, bsuId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isTokenExpiredMetaError(err)) {
      console.error(`[bm-asset-scan] biz=${bizId} kind=${kind} token expired: ${msg}`);
      await markBusinessManagerTokenExpired(supabase, bizId, msg);
      await logAssetAccessEvent(supabase, {
        businessId: bizId,
        kind,
        assetId: "-",
        userId: actorUserId,
        action: "sync_error",
        detail: { error: "token_expired", message: msg, phase: "scan" },
      });
      return emptyResult(bizId, kind, "token_expired");
    }
    console.error(`[bm-asset-scan] biz=${bizId} kind=${kind} fetch failed: ${msg}`);
    await updateBusinessManagerScanState(supabase, bizId, { lastError: msg });
    await logAssetAccessEvent(supabase, {
      businessId: bizId,
      kind,
      assetId: "-",
      userId: actorUserId,
      action: "sync_error",
      detail: { message: msg, phase: "scan" },
    });
    return emptyResult(bizId, kind, msg);
  }

  const assets = Array.from(merged.values());
  const { newAssetIds } = await upsertBMAssets(supabase, kind, bizId, assets);

  // The table is now fully written and the missing-access counts the UI shows
  // are computed live from it, so checkpoint here — the event-logging phase
  // below is the historically slow one (see lib/bm/sync.ts).
  await updateBusinessManagerScanState(supabase, bizId, { lastError: null });

  try {
    const idColumn = describeAssetKind(kind).idColumn;
    for (const idsChunk of chunk(newAssetIds, DETECTED_NEW_CHECKPOINT_BOUNDARY)) {
      await logAssetAccessEventsBulk(
        supabase,
        idsChunk.map((assetId) => {
          const asset = assets.find(
            (a) => String((a as unknown as Record<string, unknown>)[idColumn]) === assetId,
          ) as Record<string, unknown> | undefined;
          return {
            businessId: bizId,
            kind,
            assetId,
            userId: actorUserId,
            action: "detected_new" as const,
            detail: {
              name: asset?.name ?? asset?.ig_username ?? null,
              user_has_access: Boolean(asset?.user_has_access),
              is_owned_by_bm: Boolean(asset?.is_owned_by_bm),
            },
          };
        }),
      );
      await updateBusinessManagerScanState(supabase, bizId, { lastError: null });
    }
  } catch (err) {
    // The asset table is already correct; only the "which were new this run"
    // audit trail is incomplete. Record it, don't fail the scan over it.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bm-asset-scan] biz=${bizId} kind=${kind} detected_new logging failed: ${msg}`);
    await updateBusinessManagerScanState(supabase, bizId, { lastError: msg });
  }

  const missingAccess = assets.filter((a) => !a.user_has_access).length;
  console.error(
    `[bm-asset-scan] biz=${bizId} kind=${kind} (${label}) scanned=${assets.length} ` +
      `new=${newAssetIds.length} missing_access=${missingAccess}`,
  );

  return {
    businessId: bizId,
    kind,
    scanned: assets.length,
    newAssets: newAssetIds.length,
    missingAccess,
    ok: true,
  };
}

/**
 * Scan all three v2 asset kinds for one BM, reusing a single decrypted token
 * and a single resolved business-scoped user id across them.
 *
 * Kinds run SEQUENTIALLY on purpose: each already issues two paginated Graph
 * reads, and running all three concurrently triples the instantaneous request
 * rate against the same app budget — the exact pattern behind the 2026-07-09
 * Columbo Group rate-limit incident.
 */
export async function scanBusinessManagerAllAssets(
  supabase: AnySupabaseClient,
  bm: BusinessManager,
  opts: { actorUserId?: string | null } = {},
): Promise<AssetScanResult[]> {
  const bizId = bm.business_id;

  let token: string | null;
  try {
    token = await getBusinessManagerToken(supabase, bm.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "decrypt_failed";
    return BM_V2_ASSET_KINDS.map((kind) => emptyResult(bizId, kind, msg));
  }
  if (!token) {
    return BM_V2_ASSET_KINDS.map((kind) => emptyResult(bizId, kind, "no_token_stored"));
  }

  let bsuId: string;
  try {
    bsuId = await resolveBusinessScopedUserId(bizId, token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isTokenExpiredMetaError(err)) {
      await markBusinessManagerTokenExpired(supabase, bizId, msg);
      return BM_V2_ASSET_KINDS.map((kind) => emptyResult(bizId, kind, "token_expired"));
    }
    return BM_V2_ASSET_KINDS.map((kind) => emptyResult(bizId, kind, msg));
  }

  const results: AssetScanResult[] = [];
  for (const kind of BM_V2_ASSET_KINDS) {
    results.push(
      await scanBusinessManagerAssetKind(supabase, bm, kind, {
        actorUserId: opts.actorUserId,
        token,
        businessScopedUserId: bsuId,
      }),
    );
  }
  return results;
}
