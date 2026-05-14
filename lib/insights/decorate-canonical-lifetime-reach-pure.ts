import type { EventCodeLifetimeMetaCacheRow } from "../db/event-code-lifetime-meta-cache.ts";
import type { InsightsResult } from "./types.ts";

/**
 * lib/insights/decorate-canonical-lifetime-reach-pure.ts
 *
 * Pure compute layer for the venue insights canonical-reach
 * decorator (PR #419, Bug 2). Extracted from
 * `decorate-canonical-lifetime-reach.ts` so it can be unit-tested
 * under `node --experimental-strip-types --test` without tripping
 * the `@/` path-alias resolver or the `server-only` import guard
 * (mirrors the PR #418 pure-vs-loader split for canonical-event-
 * metrics).
 *
 * Inputs are pre-resolved (cache row already loaded by the caller,
 * scope flag already computed). Output is the decorated
 * `InsightsResult`.
 *
 * The `DatePreset` union deliberately stays out of this file — the
 * caller computes `isLifetimeScope` (== `datePreset === "maximum" &&
 * !customRange`) itself. Keeping the union out keeps the pure
 * helper insulated from `lib/insights/types.ts` shape changes.
 */

/**
 * Apply the lifetime cache row to the insights result.
 *
 * Decision matrix:
 *   - !result.ok                       → pass through verbatim
 *   - !isLifetimeScope                 → reach=undefined, source="non_lifetime_scope"
 *   - isLifetimeScope + cacheRow null  → reach=null, source="lifetime_cache_miss"
 *   - isLifetimeScope + meta_reach null→ reach=null, source="lifetime_cache_miss"
 *   - isLifetimeScope + cache hit      → reach=cacheRow.meta_reach, source="lifetime_cache_hit"
 *
 * `totals.reachSum` is preserved on every branch — surfaces that
 * still want the per-campaign sum (and the breakdown table that
 * shows per-campaign deduped reach) keep working.
 */
export function applyCanonicalLifetimeReach(args: {
  result: InsightsResult;
  cacheRow: EventCodeLifetimeMetaCacheRow | null;
  isLifetimeScope: boolean;
}): InsightsResult {
  const { result, cacheRow, isLifetimeScope } = args;
  if (!result.ok) return result;

  if (!isLifetimeScope) {
    return {
      ...result,
      data: {
        ...result.data,
        totals: {
          ...result.data.totals,
          reach: undefined,
          reachSource: "non_lifetime_scope",
        },
      },
    };
  }

  const reach = cacheRow?.meta_reach ?? null;
  const reachSource: "lifetime_cache_hit" | "lifetime_cache_miss" =
    reach == null ? "lifetime_cache_miss" : "lifetime_cache_hit";
  return {
    ...result,
    data: {
      ...result.data,
      totals: {
        ...result.data.totals,
        reach,
        reachSource,
      },
    },
  };
}
