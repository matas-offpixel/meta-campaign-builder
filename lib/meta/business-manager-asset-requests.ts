/**
 * lib/meta/business-manager-asset-requests.ts
 *
 * Pure request builders for the BM Asset Sync v2 asset types (ad accounts,
 * pixels, Instagram accounts). Kept free of `client.ts` imports so the
 * byte-diff tests can run under Node's `--experimental-strip-types` mode —
 * same rationale as `business-manager-grant-request.ts`, which this file is
 * the multi-asset sibling of.
 *
 * Every shape here is pinned to a response captured live from Graph API v23.0
 * on 2026-07-28 (fixtures in `lib/bm/__tests__/fixtures/`). Two findings drove
 * the design:
 *
 * ── 1. One grant body shape, not three ──────────────────────────────────────
 * The original brief assumed each asset type needed its own body. Verified
 * against the real API, `POST /{assetId}/assigned_users` with a JSON body of
 * `{business, user, tasks: string[]}` succeeds for ad accounts, pixels AND
 * Instagram assets — the same shape v1 already sends for pages. So there is
 * exactly ONE builder.
 *
 * The subtlety that makes this true: `graphPostWithToken` sends
 * `Content-Type: application/json`. Under FORM encoding the three types do
 * diverge (IG rejects a JSON-stringified `tasks` array with code 100 "Failed to
 * parse the request body parameters" and needs indexed `tasks[0]=…` instead).
 * We never send form-encoded bodies on this path, so the divergence is moot —
 * but it is why `buildAssetGrantRequest` returns a structured `tasks: string[]`
 * and must keep being posted as JSON. If anyone ever switches this call to
 * `URLSearchParams`, IG grants break and the tests below will not catch it.
 *
 * ── 2. `business` is required on every assigned_users READ ──────────────────
 * `GET /{assetId}/assigned_users` without `business` fails with code 100 "The
 * parameter business is required" on all three types. Passing it as a nested
 * field param (`assigned_users.business(<bizId>){id,tasks}`) lets the LIST
 * call return each asset's assignments inline, collapsing what would be an
 * N+1 (one assigned_users read per asset) into one paginated call per edge.
 */

import {
  describeAssetKind,
  tasksForRole,
  type BMAssetKind,
} from "../bm/asset-kinds.ts";
import type { BMPageRole } from "../bm/types.ts";

/** Which side of the BM an asset sits on. */
export type BMAssetOwnership = "owned" | "client";

export interface AssetListRequest {
  path: string;
  params: { fields: string };
}

/**
 * Builds `GET /{bizId}/{owned|client}_<assets>` including the inline
 * `assigned_users` expansion, so one call yields both the asset list and the
 * operator's access state.
 *
 * The nested `.business(<bizId>)` argument is mandatory — without it Meta
 * rejects the whole request (code 100), it does not merely omit the field.
 */
export function buildAssetListRequest(
  kind: BMAssetKind,
  bizId: string,
  ownership: BMAssetOwnership,
): AssetListRequest {
  const descriptor = describeAssetKind(kind);
  const edge = ownership === "owned" ? descriptor.ownedEdge : descriptor.clientEdge;
  const fields = [
    ...descriptor.listFields,
    `assigned_users.business(${bizId}){id,tasks}`,
  ].join(",");
  return { path: `/${bizId}/${edge}`, params: { fields } };
}

export interface AssetGrantRequest {
  /** Graph path — no business id segment; `business` travels in the body. */
  path: string;
  body: { business: string; user: string; tasks: string[] };
}

/**
 * Builds `POST /{assetId}/assigned_users` for a grant.
 *
 * `assetId` must be the id Meta's grant edge addresses, which is not always the
 * id you would guess:
 *   - ad accounts → the `act_`-prefixed node id
 *   - Instagram   → the BUSINESS ASSET id, NOT `ig_user_id`
 *
 * MUST be posted as a JSON body (see the header note on form encoding).
 */
export function buildAssetGrantRequest(
  kind: BMAssetKind,
  assetId: string,
  bizId: string,
  targetUserId: string,
  role: BMPageRole,
): AssetGrantRequest {
  return {
    path: `/${assetId}/assigned_users`,
    body: {
      business: bizId,
      user: targetUserId,
      tasks: tasksForRole(kind, role),
    },
  };
}

/** One `assigned_users` entry as Meta returns it inside the list expansion. */
export interface AssignedUserEntry {
  id: string;
  tasks?: string[];
  /** Present on ad accounts and pixels only; absent on IG assets. */
  permitted_tasks?: string[];
}

/**
 * Reads the operator's granted tasks for one asset out of a list-expansion row.
 *
 * Returns `[]` both when the operator has no assignment AND when the
 * `assigned_users` key is absent entirely — Meta OMITS the key rather than
 * returning an empty array when an asset has no assignments at all (verified:
 * 1 of 3 rows carried the key on LWE's owned_instagram_assets).
 */
export function extractUserTasks(
  row: { assigned_users?: { data?: AssignedUserEntry[] } },
  businessScopedUserId: string,
): string[] {
  const entries = row.assigned_users?.data ?? [];
  const mine = entries.find((e) => e.id === businessScopedUserId);
  return mine?.tasks ?? [];
}
