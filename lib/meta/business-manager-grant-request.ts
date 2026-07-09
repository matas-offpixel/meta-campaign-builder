/**
 * lib/meta/business-manager-grant-request.ts
 *
 * Pure request-building helper for `grantUserPagePermission`
 * (`lib/meta/business-manager.ts`). Lives outside that file — which imports
 * `client.ts` for `graphPostWithToken` / `MetaApiError` — so unit tests
 * (running via Node's `--experimental-strip-types` mode) can byte-diff the
 * built request without dragging in `client.ts`'s TypeScript-parameter-
 * property class declaration (strip-only mode rejects those). Same rationale
 * as `error-classify.ts`.
 *
 * Regression note (2026-07-09): grants were originally posted to
 * `/{bizId}/pages/{pageId}/user_permissions` with a `role` field. That
 * three-segment path is not a real Graph API edge (Meta deprecated the old
 * `{business-id}/userpermissions` scheme in v2.11) — every live grant
 * against it failed with "Unknown path components". The correct, current
 * edge is `POST /{pageId}/assigned_users` with `user` + a `tasks` array —
 * no business id in the path.
 */

import type { BMPageRole } from "@/lib/bm/types";

/**
 * Our internal BMPageRole vocabulary → the `tasks` values Meta's Page
 * Assigned Users edge actually accepts (MANAGE / CREATE_CONTENT / MODERATE /
 * ADVERTISE / ANALYZE — see
 * developers.facebook.com/docs/graph-api/reference/page/assigned_users).
 * V1 only ever grants ADVERTISER, but the map covers the full BMPageRole
 * union so a future non-V1 role doesn't silently send the wrong task.
 */
export const ROLE_TO_META_TASKS: Record<BMPageRole, string[]> = {
  ADVERTISER: ["ADVERTISE"],
  ANALYST: ["ANALYZE"],
  EDITOR: ["CREATE_CONTENT"],
  ADMIN: ["MANAGE"],
};

export interface GrantUserPagePermissionRequest {
  /** Graph API path — deliberately has NO business id segment. */
  path: string;
  body: { user: string; tasks: string[] };
}

/** Builds the `POST /{pageId}/assigned_users` path + body for a grant call. */
export function buildGrantUserPagePermissionRequest(
  pageId: string,
  targetUserId: string,
  role: BMPageRole,
): GrantUserPagePermissionRequest {
  return {
    path: `/${pageId}/assigned_users`,
    body: { user: targetUserId, tasks: ROLE_TO_META_TASKS[role] },
  };
}
