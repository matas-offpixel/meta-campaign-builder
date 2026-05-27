/**
 * lib/db/canonical-tickets-window.ts
 *
 * Pure picker for the canonical "tickets sold" number, used by the
 * Campaign Performance card / Performance Summary table / Pacing line
 * across the event report block.
 *
 * Lives next to `event-daily-timeline-window.ts` because it solves the
 * same shape (window → number | null) but with two upstream sources:
 *
 *   - `event_daily_rollups.tickets_sold` (API cadence — Eventbrite /
 *     4thefans cron writes this row-per-day from a live sync).
 *   - `tier_channel_sales.tickets_sold` (manual cadence — operators
 *     enter the latest cumulative; backfill writes per-day cumulative
 *     into `tier_channel_sales_daily_history` with
 *     `source_kind = 'manual_backfill'`).
 *
 * Per-event rule:
 *   1. If the event has a `manual_backfill` row in `dailyHistory`
 *      AND `tierChannelLifetime > 0`:
 *        - Lifetime (windowDays === null) → `tierChannelLifetime`
 *          (the latest manual cumulative is authoritative; summing
 *          per-day corroborated deltas would baseline-suppress the
 *          first-row cumulative for events that started pre-backfill
 *          — e.g. Innervisions opening at 489).
 *        - Windowed → sum per-day deltas from
 *          `buildCorroboratedDailyDeltas`, mirroring PR #464's
 *          manual-bypass pattern on the trend chart.
 *   2. Otherwise (API cadence, brand campaigns, no ticketing
 *      connection) → existing path: `sumTicketsInWindow(rollups, ...)`.
 *
 * This is pure — no DB / network / `server-only`. Tests exercise it
 * directly; the supabase-backed wrapper lives in
 * `canonical-tickets-resolver.ts`.
 *
 * Keep imports relative — the test runner can't resolve `@/` aliases.
 */

import { sumTicketsInWindow } from "./event-daily-timeline-window.ts";
import {
  buildCorroboratedDailyDeltas,
  buildVenueDailyHistoryTimelines,
} from "../dashboard/venue-trend-points.ts";
import type { TierChannelDailyHistoryRow } from "./tier-channel-daily-history.ts";

export interface PickTicketsSoldInput {
  /**
   * Every `event_daily_rollups` row across the scope (one event or a
   * venue's events). Used for the API-cadence path AND as the
   * corroboration activity gate on the manual-cadence windowed path
   * (PR #464). Date strings must be YYYY-MM-DD.
   */
  rollups: ReadonlyArray<{ date: string; tickets_sold: number | null }>;
  /**
   * `tier_channel_sales_daily_history` rows for the events in
   * `eventIds`. Mixed sources allowed — the picker treats any row whose
   * `source_kind === 'manual_backfill'` as a date that bypasses the
   * rollup corroboration gate (matches PR #464 semantics for the
   * trend chart).
   */
  dailyHistory: ReadonlyArray<TierChannelDailyHistoryRow>;
  /**
   * Set of event_ids whose history rows should participate in the
   * cumulative envelope. Single-event resolvers pass `{eventId}`;
   * venue resolvers pass every event under the event_code.
   */
  eventIds: ReadonlySet<string>;
  /**
   * SUM of `tier_channel_sales.tickets_sold` across the events in
   * `eventIds`. `null` means no `tier_channel_sales` rows for the
   * scope — the picker falls back to the API-cadence path.
   */
  tierChannelLifetime: number | null;
  /**
   * `resolvePresetToDays(datePreset, customRange)` output. `null` ⇒
   * lifetime / unranged custom — sum every row regardless of date.
   */
  windowDays: readonly string[] | null;
}

/**
 * Pick the canonical "tickets sold" number for the supplied window.
 * Returns:
 *   - `null` only when BOTH upstream sources are empty — caller falls
 *     back to the legacy `events.tickets_sold` / plan-day mount-time
 *     snapshot (matches prior `sumTicketsInWindow` semantics).
 *   - A non-negative number otherwise.
 *
 * Reads tier-channel as authoritative when the event has any
 * `manual_backfill` row AND a non-zero `tier_channel_sales` SUM. All
 * other shapes (cron-only history, no history, brand campaign, no
 * tier-channel rows) keep the existing rollup-sum behaviour.
 */
export function pickTicketsSoldInWindow(
  input: PickTicketsSoldInput,
): number | null {
  const useTierChannel = shouldUseTierChannelCanonical(input);

  if (!useTierChannel) {
    return sumTicketsInWindow(input.rollups, input.windowDays);
  }

  if (input.windowDays === null) {
    // Lifetime → latest tier_channel_sales cumulative wins.
    return input.tierChannelLifetime ?? 0;
  }

  // Windowed → per-day corroborated deltas, summed in window.
  // Mirrors PR #464's bypass pattern: manual_backfill snapshot_dates
  // emit deltas without requiring rollup activity (the J2 flat-zero
  // rollup case); cron / smoothed_historical dates still require
  // corroboration so phantom reconciliation jumps stay suppressed.
  const eventIdSet = new Set(input.eventIds);
  const scopedHistory = input.dailyHistory.filter((r) =>
    eventIdSet.has(r.event_id),
  );
  if (scopedHistory.length === 0) {
    return sumTicketsInWindow(input.rollups, input.windowDays);
  }
  const cumulative = buildVenueDailyHistoryTimelines(
    Array.from(scopedHistory),
    eventIdSet,
  );
  if (cumulative.tickets.length === 0) {
    return sumTicketsInWindow(input.rollups, input.windowDays);
  }
  const { tickets: deltas } = buildCorroboratedDailyDeltas({
    cumulativeTickets: cumulative.tickets,
    cumulativeRevenue: cumulative.revenue,
    rollups: input.rollups.map((r) => ({
      date: r.date,
      tickets_sold: r.tickets_sold,
      revenue: null,
    })),
    historyRows: scopedHistory,
  });
  const windowSet = new Set(input.windowDays);
  let total = 0;
  for (const [date, count] of deltas) {
    if (windowSet.has(date)) total += count;
  }
  return total;
}

/**
 * Pick the canonical lifetime cumulative — used by sell-out pacing
 * which needs the true running cumulative, not a sum of windowed
 * deltas. Returns `null` when neither the tier-channel side nor the
 * rollup side has any data (caller falls back to legacy sources).
 *
 * Same routing rule as `pickTicketsSoldInWindow` with `windowDays`
 * fixed to `null`, but exposed as its own export so pacing call sites
 * don't have to know about windowing semantics.
 */
export function pickCanonicalLifetimeTickets(
  input: Omit<PickTicketsSoldInput, "windowDays">,
): number | null {
  return pickTicketsSoldInWindow({ ...input, windowDays: null });
}

function shouldUseTierChannelCanonical(input: PickTicketsSoldInput): boolean {
  if (input.tierChannelLifetime == null || input.tierChannelLifetime <= 0) {
    return false;
  }
  const eventIdSet = new Set(input.eventIds);
  for (const row of input.dailyHistory) {
    if (
      row.source_kind === "manual_backfill" &&
      eventIdSet.has(row.event_id)
    ) {
      return true;
    }
  }
  return false;
}
