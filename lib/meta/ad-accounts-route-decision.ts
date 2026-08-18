/**
 * lib/meta/ad-accounts-route-decision.ts
 *
 * Pure route-level decision for `/api/meta/ad-accounts`:
 *   - fresh live list → success (caller upserts cache)
 *   - rate-limited live failure + cache → stale success
 *   - rate-limited live failure + no cache → error passthrough
 *   - non-rate-limit live failure → error passthrough
 *
 * Kept free of lib/meta/client.ts / supabase so node --test
 * --experimental-strip-types can load it.
 */

import type { MetaAdAccount } from "../types.ts";

export type AdAccountsRouteDecision =
  | {
      kind: "fresh";
      accounts: MetaAdAccount[];
      /** Caller should upsert this into user_ad_account_list_cache. */
      shouldUpsertCache: true;
    }
  | {
      kind: "stale";
      accounts: MetaAdAccount[];
      staleAsOf: string;
      shouldUpsertCache: false;
    }
  | {
      kind: "error";
      err: unknown;
      shouldUpsertCache: false;
    };

export type AdAccountsRouteDecisionInput = {
  /** Live fetch result when it succeeded. */
  liveAccounts: MetaAdAccount[] | null;
  /** Live fetch error when it threw. */
  liveError: unknown | null;
  /** Cached row, if any. */
  cached: { accounts: MetaAdAccount[]; updatedAt: string } | null;
  /** Rate-limit classifier (inject `classifyEnrichError(...).rateLimited`). */
  isRateLimited: (err: unknown) => boolean;
};

/**
 * Decide what `/api/meta/ad-accounts` should return.
 *
 * Success path takes precedence: if `liveAccounts` is non-null, return fresh
 * even if `liveError` is also set (defensive — callers should pass one or the other).
 */
export function decideAdAccountsRouteResponse(
  input: AdAccountsRouteDecisionInput,
): AdAccountsRouteDecision {
  if (input.liveAccounts != null) {
    return {
      kind: "fresh",
      accounts: input.liveAccounts,
      shouldUpsertCache: true,
    };
  }

  const err = input.liveError;
  if (err == null) {
    return {
      kind: "error",
      err: new Error("ad-accounts: no live result and no error"),
      shouldUpsertCache: false,
    };
  }

  if (input.isRateLimited(err) && input.cached) {
    return {
      kind: "stale",
      accounts: input.cached.accounts,
      staleAsOf: input.cached.updatedAt,
      shouldUpsertCache: false,
    };
  }

  return {
    kind: "error",
    err,
    shouldUpsertCache: false,
  };
}
