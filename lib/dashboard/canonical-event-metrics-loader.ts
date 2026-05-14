/**
 * lib/dashboard/canonical-event-metrics-loader.ts
 *
 * Supabase-backed convenience wrappers around
 * `computeCanonicalEventMetrics` (the pure compute layer in
 * `canonical-event-metrics.ts`). Use these when the caller doesn't
 * already have the cache row in scope.
 *
 * Most surfaces already have rollups + events + cache loaded as
 * part of the portal payload (`loadPortalForClientId` already pulls
 * `lifetimeMetaByEventCode` for every event_code under the client).
 * Those surfaces should call the pure `computeCanonicalEventMetrics`
 * directly with `portal.lifetimeMetaByEventCode.find(...)` as the
 * cache row — see `<VenueStatsGrid>` and `<VenueFullReport>`.
 *
 * Scope of this file:
 *   - `loadCanonicalEventMetrics` — single-event_code loader. Used
 *     by funnel-pacing's per-region flow which doesn't otherwise
 *     hit the lifetime cache.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadEventCodeLifetimeMetaCache } from "@/lib/db/event-code-lifetime-meta-cache";
import {
  computeCanonicalEventMetrics,
  type CanonicalEventMetrics,
} from "./canonical-event-metrics";
import type { DailyRollupRow } from "@/lib/db/client-portal-server";

/**
 * Load the lifetime cache row for `(clientId, eventCode)`, then compose
 * the canonical struct from caller-supplied rollups + events + tickets
 * / revenue. The single async hop is one cache `select`; no rollup
 * round-trip (the caller already has those rows from the portal
 * payload).
 *
 * Mirrors the pure `computeCanonicalEventMetrics` signature. The only
 * difference is the cache row is loaded on the caller's behalf.
 */
export async function loadCanonicalEventMetrics(
  supabase: SupabaseClient,
  args: {
    clientId: string;
    eventCode: string;
    dailyRollups: ReadonlyArray<DailyRollupRow>;
    events: ReadonlyArray<{ id: string; event_code: string | null }>;
    tickets?: number;
    revenue?: number | null;
    windowDays?: ReadonlySet<string> | null;
  },
): Promise<CanonicalEventMetrics> {
  const cacheRow = await loadEventCodeLifetimeMetaCache(supabase, {
    clientId: args.clientId,
    eventCode: args.eventCode,
  });
  return computeCanonicalEventMetrics({
    cacheRow,
    dailyRollups: args.dailyRollups,
    events: args.events,
    tickets: args.tickets,
    revenue: args.revenue,
    windowDays: args.windowDays,
  });
}
