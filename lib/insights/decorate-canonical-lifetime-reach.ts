import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadEventCodeLifetimeMetaCache,
  type EventCodeLifetimeMetaCacheRow,
} from "@/lib/db/event-code-lifetime-meta-cache";
import { applyCanonicalLifetimeReach } from "@/lib/insights/decorate-canonical-lifetime-reach-pure";
import type {
  CustomDateRange,
  DatePreset,
  InsightsResult,
} from "@/lib/insights/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

/**
 * lib/insights/decorate-canonical-lifetime-reach.ts
 *
 * PR #419 (audit follow-up — Bug 2, +15.9% Manchester Creative
 * Insights drift). The pre-PR Creative Insights surface rendered
 * `totals.reachSum` (per-campaign sum) for the lifetime preset, the
 * Cat F bug class for venue scope.
 *
 * `fetchEventInsights` itself stays unchanged — it's still consumed
 * by the share/report route, /api/overview/stats, and the per-event
 * insights routes that legitimately want the per-campaign-row data.
 * The fix lives in the *route* layer: post-fetch, decorate the
 * response with the cross-campaign deduplicated reach pulled out of
 * `event_code_lifetime_meta_cache` (the PR #418 Cat F-fixed cache
 * row). UI prefers `totals.reach` over `totals.reachSum` and
 * hard-fails to "—" on cache miss, mirroring the Stats Grid pattern
 * from PR #418.
 *
 * Used by both venue insights routes:
 *   - app/api/share/venue/[token]/insights/route.ts (public share)
 *   - app/api/insights/venue/[clientId]/[event_code]/route.ts (internal)
 *
 * The `server-only` Supabase round-trip is isolated here; the pure
 * decoration logic lives in `decorate-canonical-lifetime-reach-pure.ts`
 * so it can be unit-tested under `node --experimental-strip-types`
 * without tripping the `@/` path-alias / `server-only` restrictions.
 */
export async function decorateWithCanonicalLifetimeReach(args: {
  result: InsightsResult;
  supabase: AnySupabaseClient;
  clientId: string;
  eventCode: string;
  datePreset: DatePreset;
  customRange: CustomDateRange | undefined;
}): Promise<InsightsResult> {
  const { result, supabase, clientId, eventCode, datePreset, customRange } =
    args;
  if (!result.ok) return result;

  const isLifetimeScope = datePreset === "maximum" && !customRange;
  if (!isLifetimeScope) {
    return applyCanonicalLifetimeReach({
      result,
      cacheRow: null,
      isLifetimeScope: false,
    });
  }

  const cacheRow: EventCodeLifetimeMetaCacheRow | null =
    await loadEventCodeLifetimeMetaCache(supabase, {
      clientId,
      eventCode,
    });
  return applyCanonicalLifetimeReach({
    result,
    cacheRow,
    isLifetimeScope: true,
  });
}
