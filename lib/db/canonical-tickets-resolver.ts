import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { listRollupsForEvent } from "@/lib/db/event-daily-rollups";
import {
  listDailyHistoryForEvents,
  type TierChannelDailyHistoryRow,
} from "@/lib/db/tier-channel-daily-history";
import {
  pickCanonicalLifetimeTickets,
  pickTicketsSoldInWindow,
} from "@/lib/db/canonical-tickets-window";
import { resolvePresetToDays } from "@/lib/insights/date-chunks";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";

/**
 * lib/db/canonical-tickets-resolver.ts
 *
 * Server-side supabase glue for the canonical "tickets sold" picker
 * (`pickTicketsSoldInWindow`). Single seam used by every consumer of
 * the event-level / venue-level "tickets sold in window" stat so
 * manual-cadence clients (J2, Innervisions, KOC) see
 * `tier_channel_sales.tickets_sold` instead of the rollup-only sum
 * — which the previous `sumTicketsSoldInWindow` returned. See PR
 * description for the audit + consumer list.
 *
 * The picker handles routing (tier-channel vs rollup) per event;
 * this module owns the I/O.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

/**
 * Per-event SUM of `tier_channel_sales.tickets_sold` across all tiers
 * and channels. Mirrors the aggregation in
 * `lib/db/client-portal-server.ts` (the portal payload's
 * `tier_channel_sales_tickets`) — same upsert key
 * (`event_id, tier_name, channel_id`) so a raw SUM is double-count-
 * free. Returns a Map<event_id, number | null>; events with no rows
 * map to `null` so the picker can distinguish "no tier_channel side"
 * (fall back to rollup) from "tier_channel says 0" (a real reading).
 */
export async function getTierChannelSalesSumByEvent(
  supabase: AnySupabaseClient,
  eventIds: readonly string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const id of eventIds) out.set(id, null);
  if (eventIds.length === 0) return out;
  const { data, error } = await supabase
    .from("tier_channel_sales")
    .select("event_id, tickets_sold")
    .in("event_id", eventIds as string[]);
  if (error) {
    console.warn("[canonical-tickets-resolver tcs]", error.message);
    return out;
  }
  for (const row of data ?? []) {
    const eid = row.event_id as string;
    const t = Number(row.tickets_sold ?? 0);
    if (!Number.isFinite(t)) continue;
    out.set(eid, (out.get(eid) ?? 0) + t);
  }
  return out;
}

/**
 * Single-event canonical "tickets sold" for the supplied window.
 * Drop-in replacement for `sumTicketsSoldInWindow` — same shape,
 * same `null` semantics, but routes through the canonical picker so
 * manual-cadence events read from `tier_channel_sales`.
 */
export async function resolveCanonicalTicketsSoldInWindow(
  supabase: AnySupabaseClient,
  eventId: string,
  datePreset: DatePreset,
  customRange?: CustomDateRange,
): Promise<number | null> {
  const [rollups, dailyHistory, tierSums] = await Promise.all([
    listRollupsForEvent(supabase, eventId),
    listDailyHistoryForEvents(supabase, [eventId]),
    getTierChannelSalesSumByEvent(supabase, [eventId]),
  ]);
  return pickTicketsSoldInWindow({
    rollups: rollups.map((r) => ({
      date: r.date,
      tickets_sold: r.tickets_sold ?? null,
    })),
    dailyHistory,
    eventIds: new Set([eventId]),
    tierChannelLifetime: tierSums.get(eventId) ?? null,
    windowDays: resolvePresetToDays(datePreset, customRange),
  });
}

/**
 * Venue (multi-event) canonical "tickets sold" for the window. Drop-in
 * for `sumVenueTicketsSoldInWindow`. Same canonical routing rule
 * applied per-event-set: manual-cadence venues (KOC and future) use
 * the tier-channel SUM as authoritative; API venues (Brighton) keep
 * the rollup-sum path.
 */
export async function resolveCanonicalVenueTicketsSoldInWindow(
  supabase: AnySupabaseClient,
  eventIds: readonly string[],
  datePreset: DatePreset,
  customRange?: CustomDateRange,
): Promise<number | null> {
  if (eventIds.length === 0) return null;
  const [rollupsResult, dailyHistory, tierSums] = await Promise.all([
    supabase
      .from("event_daily_rollups")
      .select("date, tickets_sold")
      .in("event_id", eventIds as string[]),
    listDailyHistoryForEvents(supabase, eventIds as string[]),
    getTierChannelSalesSumByEvent(supabase, eventIds),
  ]);
  if (rollupsResult.error) throw rollupsResult.error;
  let tierLifetime = 0;
  let anyTier = false;
  for (const v of tierSums.values()) {
    if (v != null) {
      tierLifetime += v;
      anyTier = true;
    }
  }
  return pickTicketsSoldInWindow({
    rollups: (rollupsResult.data ?? []).map((r) => ({
      date: r.date as string,
      tickets_sold: (r.tickets_sold as number | null) ?? null,
    })),
    dailyHistory,
    eventIds: new Set(eventIds),
    tierChannelLifetime: anyTier ? tierLifetime : null,
    windowDays: resolvePresetToDays(datePreset, customRange),
  });
}

/**
 * Canonical LIFETIME cumulative for a single event. Used by sell-out
 * pacing — `computeSellOutPacing` previously summed corroborated
 * per-day deltas from the timeline, which baseline-suppresses the
 * first-row cumulative (Innervisions opened at 489 pre-tool-adoption,
 * baseline = 489, summed deltas = current − 489 ≠ true cumulative).
 *
 * Returns the same value the canonical picker would return for the
 * `windowDays === null` (lifetime) case. Exposed as its own function
 * so the pacing helper doesn't have to fabricate a `DatePreset`.
 */
export async function resolveCanonicalLifetimeTickets(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<number | null> {
  const [rollups, dailyHistory, tierSums] = await Promise.all([
    listRollupsForEvent(supabase, eventId),
    listDailyHistoryForEvents(supabase, [eventId]),
    getTierChannelSalesSumByEvent(supabase, [eventId]),
  ]);
  return pickCanonicalLifetimeTickets({
    rollups: rollups.map((r) => ({
      date: r.date,
      tickets_sold: r.tickets_sold ?? null,
    })),
    dailyHistory,
    eventIds: new Set([eventId]),
    tierChannelLifetime: tierSums.get(eventId) ?? null,
  });
}

/** Re-exported type for callers that bundle the history fetch. */
export type { TierChannelDailyHistoryRow };
