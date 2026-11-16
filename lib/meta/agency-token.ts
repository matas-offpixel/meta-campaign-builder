/**
 * lib/meta/agency-token.ts
 *
 * `META_ACCESS_TOKEN` is the agency's system token. A request may fall back
 * to it only when the caller is an operator (`isOperator`). A non-operator
 * — a client_users member, or any other signed-in account — uses their own
 * stored Facebook token or nothing.
 *
 * The /api proxy gate already refuses non-operators on these routes; this is
 * the second line. Crons and other system paths with no caller read the env
 * token directly and are unchanged.
 */

import { isOperator } from "../auth/operator-allowlist.ts";

/** The existing "no token" message, reused so no visible text changes. */
export const NO_META_TOKEN_MESSAGE =
  "No Meta access token available. Connect your Facebook account in Account Setup.";

/** True when this caller may end up on the agency token. */
export function mayUseAgencyMetaToken(userId: string | null | undefined): boolean {
  return typeof userId === "string" && isOperator(userId);
}

/** The agency token for an operator caller; null for anyone else or when unset. */
export function agencyMetaToken(userId: string | null | undefined): string | null {
  if (!mayUseAgencyMetaToken(userId)) return null;
  return process.env.META_ACCESS_TOKEN || null;
}
