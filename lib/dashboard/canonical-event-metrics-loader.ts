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
    /**
     * Per-event_id `tier_channel_sales.tickets_sold` SUM. PR #422 wires
     * this through so `ticketsTrue` and `attribution` populate on
     * surfaces that read from the resolver directly. Optional for
     * backwards-compat with funnel-pacing's per-region path which
     * doesn't render the attribution tile.
     */
    tierChannelTicketsByEventId?: ReadonlyMap<string, number | null>;
    /**
     * PR #423 — per-event_id Meta-purchase column sum + verified-
     * purchase count. Both optional so legacy callers continue to
     * compose without surfacing the new fields. Loader is provided
     * separately as `loadPurchaseAttributionMaps`.
     */
    metaPurchasesByEventId?: ReadonlyMap<string, number | null>;
    offpixelAttributedPurchasesByEventId?: ReadonlyMap<string, number | null>;
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
    tierChannelTicketsByEventId: args.tierChannelTicketsByEventId,
    metaPurchasesByEventId: args.metaPurchasesByEventId,
    offpixelAttributedPurchasesByEventId:
      args.offpixelAttributedPurchasesByEventId,
  });
}

/**
 * PR #423 — bulk loader for the two new attribution maps.
 *
 * Returns:
 *   - `metaPurchasesByEventId`: per-event SUM of
 *     `event_daily_rollups.meta_purchases` over `windowDays`. Empty
 *     map when no rollup row reports a purchase yet (pre-Joe). The
 *     caller will hand this to `computeCanonicalEventMetrics`,
 *     which treats an empty map as "we haven't asked Meta yet" →
 *     `metaReportedPurchases` returns `null`.
 *   - `offpixelAttributedPurchasesByEventId`: per-event count of
 *     `attribution_order_matches` rows with `match_strategy !=
 *     'unmatched'`. Always returns a number (zero is the honest
 *     pre-Joe answer; the resolver folds zero into a non-null
 *     `offpixelAttributedPurchases`).
 *
 * The function is dark-build safe — both queries return zero
 * matches gracefully when the migration-094 tables are empty (or
 * even when they don't exist yet, in which case the caller sees
 * an empty map and the resolver still composes correctly).
 */
export async function loadPurchaseAttributionMaps(
  supabase: SupabaseClient,
  args: {
    clientId: string;
    eventIds: ReadonlyArray<string>;
    windowDays?: ReadonlySet<string> | null;
  },
): Promise<{
  metaPurchasesByEventId: Map<string, number>;
  offpixelAttributedPurchasesByEventId: Map<string, number>;
}> {
  const metaPurchasesByEventId = new Map<string, number>();
  const offpixelAttributedPurchasesByEventId = new Map<string, number>();
  if (args.eventIds.length === 0) {
    return {
      metaPurchasesByEventId,
      offpixelAttributedPurchasesByEventId,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  // ── Layer A read: meta_purchases sum per event_id ──────────────
  try {
    const { data, error } = await sb
      .from("event_daily_rollups")
      .select("event_id, date, meta_purchases")
      .in("event_id", args.eventIds);
    if (error) {
      console.warn(
        `[canonical-loader] meta_purchases read failed: ${error.message}`,
      );
    } else {
      for (const row of (data ?? []) as Array<{
        event_id: string;
        date: string;
        meta_purchases: number | null;
      }>) {
        if (args.windowDays && !args.windowDays.has(row.date)) continue;
        if (row.meta_purchases == null) continue;
        metaPurchasesByEventId.set(
          row.event_id,
          (metaPurchasesByEventId.get(row.event_id) ?? 0) +
            row.meta_purchases,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[canonical-loader] meta_purchases read threw: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
  }

  // ── Layer B read: verified matches per event_id ────────────────
  try {
    const { data, error } = await sb
      .from("attribution_order_matches")
      .select("event_id, match_strategy")
      .eq("client_id", args.clientId)
      .neq("match_strategy", "unmatched")
      .in("event_id", args.eventIds);
    if (error) {
      // Graceful degrade — table not yet created in this env, or
      // RLS denied. Both produce an empty map; the resolver then
      // returns 0 verified purchases (the honest pre-Joe answer).
      console.warn(
        `[canonical-loader] verified-matches read failed: ${error.message}`,
      );
    } else {
      for (const row of (data ?? []) as Array<{ event_id: string }>) {
        offpixelAttributedPurchasesByEventId.set(
          row.event_id,
          (offpixelAttributedPurchasesByEventId.get(row.event_id) ?? 0) + 1,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[canonical-loader] verified-matches read threw: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
  }

  return {
    metaPurchasesByEventId,
    offpixelAttributedPurchasesByEventId,
  };
}
