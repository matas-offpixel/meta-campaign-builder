/**
 * lib/meta/business-manager-assets.ts
 *
 * Server-only Graph API readers + grant calls for the BM Asset Sync v2 asset
 * types: ad accounts, pixels and Instagram accounts. The Pages equivalents stay
 * in `business-manager.ts` (v1, untouched by this PR).
 *
 * Like v1, every call runs as the OPERATOR (Matas's personal OAuth token) —
 * never the shared META_ACCESS_TOKEN. Retry policy is inherited wholesale from
 * `client.ts`: GET reads retry with backoff, POST grants stay single-shot. Do
 * not add a bespoke retry loop here.
 *
 * ── Why the list calls return access state too ───────────────────────────────
 * `GET /{assetId}/assigned_users` requires a `business` param on all three
 * types, and there is no bulk "assets assigned to me" edge for pixels or IG
 * (`/{businessUserId}/assigned_pixels` and `assigned_instagram_accounts` both
 * 404 — only `assigned_ad_accounts` and `assigned_pages` exist). Rather than
 * issue one assigned_users read per asset (N+1: LWE alone would be ~15 extra
 * calls per scan, ~750 across all connected BMs), the list request inlines the
 * assignments via `assigned_users.business(<bizId>){id,tasks}` field expansion.
 * That makes a full multi-asset scan 6 paginated calls per BM regardless of how
 * many assets it holds. Verified working on all six edges — see
 * `business-manager-asset-requests.ts` for the shape and the live capture.
 *
 * Import ONLY from Route Handlers / cron routes — never from client components.
 */

import "server-only";

import { graphPostWithToken } from "./client.ts";
import { paginateAll } from "./business-manager.ts";
import {
  buildAssetGrantRequest,
  buildAssetListRequest,
  extractUserTasks,
  type AssignedUserEntry,
  type BMAssetOwnership,
} from "./business-manager-asset-requests.ts";
import {
  areTasksValidForKind,
  tasksForRole,
  type BMAssetKind,
} from "@/lib/bm/asset-kinds";
import type { BMPageRole } from "@/lib/bm/types";

// ─── Raw Graph row shapes (as verified live, v23.0, 2026-07-28) ──────────────

interface WithAssignedUsers {
  assigned_users?: { data?: AssignedUserEntry[] };
}

export interface MetaBMAdAccount extends WithAssignedUsers {
  /** "act_"-prefixed node id — the id grants address. */
  id: string;
  /** Bare numeric form. */
  account_id?: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
  disable_reason?: number;
}

export interface MetaBMPixel extends WithAssignedUsers {
  id: string;
  name?: string;
  /** Valid field, but frequently absent from the payload. */
  last_fired_time?: string;
  creation_time?: string;
  is_unavailable?: boolean;
  enable_automatic_matching?: boolean;
  data_use_setting?: string;
}

export interface MetaBMIgAsset extends WithAssignedUsers {
  /** BUSINESS ASSET id — what grants address. NOT interchangeable with ig_user_id. */
  id: string;
  /** IG user id — what the ads/wizard side joins on. */
  ig_user_id?: string;
  ig_username?: string;
  /** Accepted as a field but empty for most assets. */
  profile_pic?: string;
  followed_by_count?: number;
  media_count?: number;
}

// ─── Generic reader ──────────────────────────────────────────────────────────

/**
 * Reads one owned/client edge for a kind, with assignments inlined.
 *
 * Note on `client_*` edges: an empty `data` array is a normal, common result
 * (most BMs own their assets outright) and must NOT be treated as an error.
 * A genuinely missing edge surfaces as a thrown MetaApiError instead — which is
 * how `client_instagram_accounts` was caught as non-existent.
 */
async function listAssetsForEdge<T>(
  kind: BMAssetKind,
  bizId: string,
  ownership: BMAssetOwnership,
  token: string,
): Promise<T[]> {
  const { path, params } = buildAssetListRequest(kind, bizId, ownership);
  return paginateAll<T>(path, params, token);
}

// ─── The six list functions ──────────────────────────────────────────────────

/** GET /{bizId}/owned_ad_accounts — ad accounts the BM owns outright. */
export function listOwnedAdAccounts(bizId: string, token: string): Promise<MetaBMAdAccount[]> {
  return listAssetsForEdge<MetaBMAdAccount>("ad_account", bizId, "owned", token);
}

/** GET /{bizId}/client_ad_accounts — ad accounts shared into the BM. */
export function listClientAdAccounts(bizId: string, token: string): Promise<MetaBMAdAccount[]> {
  return listAssetsForEdge<MetaBMAdAccount>("ad_account", bizId, "client", token);
}

/** GET /{bizId}/owned_pixels — pixels the BM owns outright. */
export function listOwnedPixels(bizId: string, token: string): Promise<MetaBMPixel[]> {
  return listAssetsForEdge<MetaBMPixel>("pixel", bizId, "owned", token);
}

/** GET /{bizId}/client_pixels — pixels shared into the BM. */
export function listClientPixels(bizId: string, token: string): Promise<MetaBMPixel[]> {
  return listAssetsForEdge<MetaBMPixel>("pixel", bizId, "client", token);
}

/**
 * GET /{bizId}/owned_instagram_assets — IG accounts the BM owns outright.
 * The edge is `..._assets`, not `..._accounts`.
 */
export function listOwnedInstagramAssets(bizId: string, token: string): Promise<MetaBMIgAsset[]> {
  return listAssetsForEdge<MetaBMIgAsset>("ig_account", bizId, "owned", token);
}

/**
 * GET /{bizId}/client_instagram_assets — IG accounts shared into the BM.
 * `client_instagram_accounts` does NOT exist (code 100) — do not "fix" this.
 */
export function listClientInstagramAssets(bizId: string, token: string): Promise<MetaBMIgAsset[]> {
  return listAssetsForEdge<MetaBMIgAsset>("ig_account", bizId, "client", token);
}

/** Reads the operator's granted tasks out of an inlined assignments payload. */
export function readOperatorTasks(
  row: WithAssignedUsers,
  businessScopedUserId: string,
): string[] {
  return extractUserTasks(row, businessScopedUserId);
}

// ─── Grants (mutations — single-shot, no retry) ───────────────────────────────

export interface AssetGrantResponse {
  success?: boolean;
  id?: string;
}

/**
 * POST /{assetId}/assigned_users — grant `targetUserId` a role on one asset.
 *
 * Verified idempotent: re-granting a role the user already holds returns
 * `{success: true}` rather than an error, so callers do not need a
 * "already assigned" special case.
 *
 * Guards the task list against the kind's verified permitted set BEFORE calling
 * Meta — sending e.g. MANAGE to a pixel produces a generic 400 that is painful
 * to diagnose from logs after the fact.
 *
 * Single-shot on purpose (graphPostWithToken). Throws MetaApiError on failure;
 * callers inspect `.subcode === 190` for an expired token.
 */
export async function grantUserAssetPermission(
  kind: BMAssetKind,
  bizId: string,
  assetId: string,
  targetUserId: string,
  role: BMPageRole,
  token: string,
): Promise<AssetGrantResponse> {
  const tasks = tasksForRole(kind, role);
  if (!areTasksValidForKind(kind, tasks)) {
    throw new Error(
      `Refusing to grant ${tasks.join(",")} on ${kind} — not in Meta's permitted task set for this asset type.`,
    );
  }
  const { path, body } = buildAssetGrantRequest(kind, assetId, bizId, targetUserId, role);
  console.log(
    `[bm grant] kind=${kind} biz=${bizId} asset=${assetId} user=${targetUserId} tasks=${body.tasks.join(",")}`,
  );
  return graphPostWithToken<AssetGrantResponse>(path, body, token);
}

/** POST /act_{id}/assigned_users. `adAccountId` must be the act_-prefixed id. */
export function grantUserAdAccountPermission(
  bizId: string,
  adAccountId: string,
  targetUserId: string,
  role: BMPageRole,
  token: string,
): Promise<AssetGrantResponse> {
  return grantUserAssetPermission("ad_account", bizId, adAccountId, targetUserId, role, token);
}

/** POST /{pixelId}/assigned_users. Remember: pixels have no MANAGE task. */
export function grantUserPixelPermission(
  bizId: string,
  pixelId: string,
  targetUserId: string,
  role: BMPageRole,
  token: string,
): Promise<AssetGrantResponse> {
  return grantUserAssetPermission("pixel", bizId, pixelId, targetUserId, role, token);
}

/**
 * POST /{igAssetId}/assigned_users.
 *
 * `igAssetId` MUST be the business asset id from `owned_/client_instagram_assets`,
 * not `ig_user_id`. Meta expands IG grants (a requested ADVERTISE reads back as
 * ADVERTISE+ANALYZE+CONTENT+MESSAGES+COMMUNITY_ACTIVITY), so verification is a
 * superset check — see `grantSatisfied`.
 */
export function grantUserInstagramPermission(
  bizId: string,
  igAssetId: string,
  targetUserId: string,
  role: BMPageRole,
  token: string,
): Promise<AssetGrantResponse> {
  return grantUserAssetPermission("ig_account", bizId, igAssetId, targetUserId, role, token);
}

/**
 * GET /{assetId}/assigned_users — direct read-back for one asset, used to
 * confirm a grant actually stuck. `business` is REQUIRED (code 100 without it).
 *
 * Kept separate from the list-expansion path because grant verification wants a
 * single fresh asset, not a re-scan of the whole BM.
 */
export async function readAssetAssignedUsers(
  assetId: string,
  bizId: string,
  token: string,
): Promise<AssignedUserEntry[]> {
  return paginateAll<AssignedUserEntry>(
    `/${assetId}/assigned_users`,
    { business: bizId, fields: "id,tasks" },
    token,
  );
}
