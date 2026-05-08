/**
 * lib/dashboard/venue-trend-points.ts
 *
 * Pure helpers that build TrendChartPoint arrays from venue ticket snapshot
 * rows. Extracted from components/share/client-portal-venue-table.tsx so they
 * can be unit-tested without a React environment.
 *
 * Key design invariant
 * --------------------
 * When weekly ticket snapshots exist for a venue, they are the AUTHORITATIVE
 * cumulative source (Eventbrite / FourtheFans). Rollup `tickets_sold` (which
 * contains `meta_regs` — on-Meta conversion events) must NOT be mixed into the
 * same points array as cumulative snapshot points, because:
 *
 *   1. The aggregator (aggregateTrendChartPoints) enters cumulative mode when
 *      ANY point has `ticketsKind: "cumulative_snapshot"`. In cumulative mode,
 *      each ticket value REPLACES the running total rather than adding to it.
 *   2. A rollup `tickets_sold = 4` (today's meta_regs) processed after a
 *      snapshot point with `tickets = 699` would silently set the "cumulative
 *      total" back to 4 — producing a cliff-drop from 699 → 4 on the chart.
 *
 * The caller (`buildVenueTrendPoints`) is responsible for setting
 * `tickets: null` on rollup points when snapshot points exist.
 */

import type { WeeklyTicketSnapshotRow } from "@/lib/db/client-portal-server";
import type { TrendChartPoint } from "@/lib/dashboard/trend-chart-data";

/**
 * Convert weekly ticket snapshot rows (each holding a cumulative total at the
 * snapshot date) into TrendChartPoint records tagged as
 * `ticketsKind: "cumulative_snapshot"`.
 *
 * The aggregator's carry-forward pass then fills in every calendar day between
 * snapshot dates with the last known cumulative total, producing the smooth
 * growing tickets line on the trend chart.
 *
 * Per-event isolation: we track the latest snapshot per event independently
 * and sum across all events for each date. This means a four-fixture venue
 * returns the combined cumulative total across all four fixtures at each date.
 */
export function buildVenueTicketSnapshotPoints(
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
  venueEventIds: Set<string>,
): TrendChartPoint[] {
  // Group snapshot rows by event, keeping only rows for this venue.
  const byEvent = new Map<string, WeeklyTicketSnapshotRow[]>();
  for (const row of weeklyTicketSnapshots) {
    if (!venueEventIds.has(row.event_id)) continue;
    const rows = byEvent.get(row.event_id) ?? [];
    rows.push(row);
    byEvent.set(row.event_id, rows);
  }
  if (byEvent.size === 0) return [];

  // Collect all distinct snapshot dates across events and sort them.
  const dates = new Set<string>();
  for (const rows of byEvent.values()) {
    rows.sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
    for (const row of rows) dates.add(row.snapshot_at);
  }

  // For each snapshot date: sum the latest known cumulative total across all
  // events (carry the previous snapshot forward when an event has no entry on
  // this exact date).
  return [...dates].sort().map((date) => {
    let total = 0;
    let hasTickets = false;
    for (const rows of byEvent.values()) {
      // Binary-search-style: walk backward to find the most recent snapshot
      // for this event that is on or before `date`.
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]!;
        if (row.snapshot_at <= date) {
          total += row.tickets_sold;
          hasTickets = true;
          break;
        }
      }
    }
    return {
      date,
      spend: null,
      tickets: hasTickets ? total : null,
      revenue: null,
      linkClicks: null,
      ticketsKind: "cumulative_snapshot" as const,
    };
  });
}
