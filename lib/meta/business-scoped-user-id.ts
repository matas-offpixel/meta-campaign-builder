/**
 * lib/meta/business-scoped-user-id.ts
 *
 * Pure matching helpers for `resolveBusinessScopedUserId`
 * (`lib/meta/business-manager.ts`). Lives outside that file — which imports
 * `client.ts` for `graphGetWithToken` / `MetaApiError` — so unit tests
 * (running via Node's `--experimental-strip-types` mode) can exercise the
 * matching logic without dragging in `client.ts`'s TypeScript-parameter-
 * property class declaration (strip-only mode rejects those). Same
 * rationale as `error-classify.ts` and `business-manager-grant-request.ts`.
 *
 * Regression note (2026-07-09): grants against LWE's BM failed with Meta
 * subcode 1752100 "User is not business-scoped" even after PR #709 fixed
 * the request shape. Root cause: `getMetaUserId` (`GET /me?fields=id`)
 * returns Matas's Facebook-level user id — Meta's `POST
 * /{page_id}/assigned_users` edge requires a BUSINESS-SCOPED user id, a
 * distinct alias per Business Manager he belongs to.
 */

/** One row of `GET /me?fields=business_users{id,business{id}}`. */
export interface MeBusinessUserAssociation {
  /** The business-scoped user id for THIS association. */
  id?: string;
  business?: { id?: string };
}

/** One row of `GET /{bizId}/business_users?fields=id,name`. */
export interface BusinessUserMember {
  /** The business-scoped user id within this BM. */
  id?: string;
  name?: string;
}

/**
 * Option B (preferred — one call covers every BM the token belongs to):
 * from the token owner's own `/me` business_users associations, pick the
 * one scoped to `bizId`.
 */
export function pickBusinessScopedUserIdFromMe(
  associations: MeBusinessUserAssociation[] | undefined,
  bizId: string,
): string | undefined {
  return associations?.find((row) => row.business?.id === bizId && !!row.id)?.id;
}

/**
 * Option A fallback (one call per BM): from the BM's member list, pick the
 * row whose display name matches the token owner's own `/me` name.
 * Returns undefined if `meName` is missing/blank — never guesses.
 */
export function pickBusinessScopedUserIdByName(
  members: BusinessUserMember[] | undefined,
  meName: string | undefined,
): string | undefined {
  if (!meName) return undefined;
  return members?.find((m) => !!m.id && m.name === meName)?.id;
}
