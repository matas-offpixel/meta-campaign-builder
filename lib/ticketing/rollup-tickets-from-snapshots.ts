/**
 * Snapshot → collapse → daily rollup tickets.
 *
 * `ticket_sales_snapshots.tickets_sold` is a CUMULATIVE lifetime total.
 * `event_daily_rollups.tickets_sold` is the per-day delta readers SUM.
 *
 * The rollup-sync tickets leg used to write live Eventbrite order buckets
 * and a 4TF "today minus yesterday" delta, and never read snapshots
 * through collapse. Manual / xlsx purchases (the funnel-engine purchase
 * input) never landed, and a dead live fetch wrote 0s for a quarter.
 *
 * One collapse per consumer — this is the only tickets-from-snapshots
 * math. Cron, backfill, and tests all call it.
 */

import { collapseWeekly } from "../db/event-history-collapse.ts";

export interface SnapshotForRollupTickets {
  snapshot_at: string;
  tickets_sold: number;
  source: string;
  gross_revenue_cents?: number | null;
  /** When set, same-source listings on one event are summed per day. */
  external_event_id?: string | null;
  connection_id?: string | null;
}

export interface RollupTicketDeltaRow {
  date: string;
  tickets_sold: number;
  revenue: number;
}

/**
 * Latest intra-day snapshot of the winning source first, so
 * `collapseWeekly`'s equal-priority "keep first" rule keeps the
 * end-of-day cumulative rather than the morning one.
 */
function preferLatestIntraDay<T extends SnapshotForRollupTickets>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const dayA = a.snapshot_at.slice(0, 10);
    const dayB = b.snapshot_at.slice(0, 10);
    if (dayA !== dayB) return dayA.localeCompare(dayB);
    return b.snapshot_at.localeCompare(a.snapshot_at);
  });
}

function revenuePounds(cents: number | null | undefined): number | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return Number((Math.max(0, cents) / 100).toFixed(2));
}

/**
 * Latest snapshot per (source, listing, day), then SUM listings that
 * share a source. Two 4TF links on one event (218 and 4,318) must not
 * bounce the collapsed lifetime between those totals — that invented
 * 28k "sales" on Villa. Matches `aggregateMultiLinkSnapshots`.
 */
function aggregateSameSourceListings(
  snapshots: SnapshotForRollupTickets[],
): SnapshotForRollupTickets[] {
  const latestPerLink = new Map<string, SnapshotForRollupTickets>();
  for (const snap of snapshots) {
    const day = snap.snapshot_at.slice(0, 10);
    if (!day) continue;
    const listing = snap.external_event_id ?? snap.connection_id ?? "";
    const key = `${snap.source}|${listing}|${day}`;
    const cur = latestPerLink.get(key);
    if (!cur || snap.snapshot_at > cur.snapshot_at) {
      latestPerLink.set(key, snap);
    }
  }

  const sumByDaySource = new Map<string, SnapshotForRollupTickets>();
  for (const snap of latestPerLink.values()) {
    const day = snap.snapshot_at.slice(0, 10);
    const key = `${snap.source}|${day}`;
    const cur = sumByDaySource.get(key);
    if (!cur) {
      sumByDaySource.set(key, { ...snap });
    } else {
      cur.tickets_sold += snap.tickets_sold;
      if (snap.gross_revenue_cents != null) {
        cur.gross_revenue_cents =
          (cur.gross_revenue_cents ?? 0) + snap.gross_revenue_cents;
      }
      if (snap.snapshot_at > cur.snapshot_at) {
        cur.snapshot_at = snap.snapshot_at;
      }
    }
  }
  return [...sumByDaySource.values()];
}

export function buildRollupTicketDeltasFromSnapshots(
  snapshots: SnapshotForRollupTickets[],
): RollupTicketDeltaRow[] {
  if (snapshots.length === 0) return [];

  const aggregated = preferLatestIntraDay(
    aggregateSameSourceListings(snapshots),
  );
  const collapsed = collapseWeekly(aggregated);
  const revenueByDay = new Map<string, number | null>();
  for (const snap of aggregated) {
    const day = snap.snapshot_at.slice(0, 10);
    if (!day) continue;
    if (collapsed.some((c) => c.snapshot_at === day && c.source === snap.source)) {
      revenueByDay.set(day, revenuePounds(snap.gross_revenue_cents));
    }
  }

  const rows: RollupTicketDeltaRow[] = [];
  let previousTickets: number | null = null;
  let previousRevenue: number | null = null;

  for (const day of collapsed) {
    const tickets = Math.max(0, Math.round(day.tickets_sold));
    const revenue = revenueByDay.get(day.snapshot_at) ?? null;
    const deltaTickets =
      previousTickets == null ? tickets : Math.max(0, tickets - previousTickets);
    const deltaRevenue =
      revenue == null
        ? 0
        : previousRevenue == null
          ? Math.max(0, revenue)
          : Math.max(0, Number((revenue - previousRevenue).toFixed(2)));

    rows.push({
      date: day.snapshot_at,
      tickets_sold: deltaTickets,
      revenue: deltaRevenue,
    });

    previousTickets = tickets;
    if (revenue != null) previousRevenue = Math.max(0, revenue);
  }

  return rows;
}

export function filterRollupTicketDeltasFrom(
  rows: RollupTicketDeltaRow[],
  fromDate: string,
): RollupTicketDeltaRow[] {
  return rows.filter((r) => r.date >= fromDate);
}
