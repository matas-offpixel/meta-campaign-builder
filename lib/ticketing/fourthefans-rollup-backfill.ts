export interface FourthefansSnapshotForBackfill {
  event_id: string;
  user_id: string;
  snapshot_at: string;
  tickets_sold: number;
  gross_revenue_cents: number | null;
}

/**
 * Raw snapshot row including per-link identifiers. Used by the backfill
 * route before aggregating multi-link events into per-day sums.
 */
export interface FourthefansRawSnapshotForBackfill {
  event_id: string;
  user_id: string;
  connection_id: string;
  external_event_id: string;
  snapshot_at: string;
  tickets_sold: number;
  gross_revenue_cents: number | null;
}

export interface ExistingRollupForBackfill {
  date: string;
  tickets_sold: number | null;
}

export interface FourthefansBackfillRow {
  user_id: string;
  event_id: string;
  date: string;
  tickets_sold: number;
  revenue: number | null;
}

interface DailySnapshot {
  user_id: string;
  event_id: string;
  date: string;
  tickets_sold: number;
  gross_revenue_cents: number | null;
  snapshot_at: string;
}

export function reconstructFourthefansRollupDeltas(
  snapshots: FourthefansSnapshotForBackfill[],
  existingRollups: ExistingRollupForBackfill[] = [],
): FourthefansBackfillRow[] {
  const protectedDates = new Set(
    existingRollups
      .filter((row) => row.tickets_sold != null && row.tickets_sold > 0)
      .map((row) => row.date),
  );
  const dailySnapshots = latestSnapshotByDay(snapshots);
  const rows: FourthefansBackfillRow[] = [];
  let previousTickets: number | null = null;
  let previousRevenueCents: number | null = null;

  for (const snapshot of dailySnapshots) {
    const tickets = Math.max(0, Math.round(snapshot.tickets_sold));
    const deltaTickets =
      previousTickets == null ? tickets : Math.max(0, tickets - previousTickets);
    const revenueCents = snapshot.gross_revenue_cents;
    const deltaRevenueCents =
      revenueCents == null
        ? null
        : previousRevenueCents == null
          ? Math.max(0, revenueCents)
          : Math.max(0, revenueCents - previousRevenueCents);

    if (!protectedDates.has(snapshot.date)) {
      rows.push({
        user_id: snapshot.user_id,
        event_id: snapshot.event_id,
        date: snapshot.date,
        tickets_sold: deltaTickets,
        revenue:
          deltaRevenueCents == null
            ? null
            : Number((deltaRevenueCents / 100).toFixed(2)),
      });
    }

    previousTickets = tickets;
    if (revenueCents != null) previousRevenueCents = Math.max(0, revenueCents);
  }

  return rows;
}

/**
 * Collapses raw per-link snapshots into per-(event_id, date) sums so
 * `reconstructFourthefansRollupDeltas` sees a single lifetime total per
 * day rather than one row per external_event_id.
 *
 * Two-pass:
 *   1. Pick the latest snapshot per (event_id, connection_id,
 *      external_event_id, date) — discards stale intra-day duplicates.
 *   2. Sum tickets + revenue across links for the same (event_id, date).
 */
export function aggregateMultiLinkSnapshots(
  raw: FourthefansRawSnapshotForBackfill[],
): FourthefansSnapshotForBackfill[] {
  // Pass 1: latest per link-day
  const latestPerLink = new Map<
    string,
    FourthefansRawSnapshotForBackfill & { date: string }
  >();
  for (const snap of raw) {
    const date = snap.snapshot_at.slice(0, 10);
    const key = `${snap.event_id}|${snap.connection_id}|${snap.external_event_id}|${date}`;
    const cur = latestPerLink.get(key);
    if (!cur || snap.snapshot_at > cur.snapshot_at) {
      latestPerLink.set(key, { ...snap, date });
    }
  }

  // Pass 2: sum per (event_id, date)
  const sumByDay = new Map<
    string,
    {
      event_id: string;
      user_id: string;
      date: string;
      latest_snapshot_at: string;
      tickets_sold: number;
      gross_revenue_cents: number | null;
    }
  >();
  for (const snap of latestPerLink.values()) {
    const key = `${snap.event_id}|${snap.date}`;
    const cur = sumByDay.get(key);
    if (!cur) {
      sumByDay.set(key, {
        event_id: snap.event_id,
        user_id: snap.user_id,
        date: snap.date,
        latest_snapshot_at: snap.snapshot_at,
        tickets_sold: snap.tickets_sold,
        gross_revenue_cents: snap.gross_revenue_cents,
      });
    } else {
      if (snap.snapshot_at > cur.latest_snapshot_at) {
        cur.latest_snapshot_at = snap.snapshot_at;
      }
      cur.tickets_sold += snap.tickets_sold;
      if (snap.gross_revenue_cents != null) {
        cur.gross_revenue_cents =
          (cur.gross_revenue_cents ?? 0) + snap.gross_revenue_cents;
      }
    }
  }

  return [...sumByDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      event_id: row.event_id,
      user_id: row.user_id,
      snapshot_at: row.latest_snapshot_at,
      tickets_sold: row.tickets_sold,
      gross_revenue_cents: row.gross_revenue_cents,
    }));
}

function latestSnapshotByDay(
  snapshots: FourthefansSnapshotForBackfill[],
): DailySnapshot[] {
  const byDate = new Map<string, DailySnapshot>();
  for (const snapshot of snapshots) {
    const date = snapshot.snapshot_at.slice(0, 10);
    if (!date) continue;
    const current = byDate.get(date);
    if (current && current.snapshot_at >= snapshot.snapshot_at) continue;
    byDate.set(date, {
      user_id: snapshot.user_id,
      event_id: snapshot.event_id,
      date,
      tickets_sold: snapshot.tickets_sold,
      gross_revenue_cents: snapshot.gross_revenue_cents,
      snapshot_at: snapshot.snapshot_at,
    });
  }
  return [...byDate.values()].sort((a, b) =>
    a.date === b.date
      ? a.snapshot_at.localeCompare(b.snapshot_at)
      : a.date.localeCompare(b.date),
  );
}
