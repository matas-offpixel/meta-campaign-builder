export interface FourthefansSnapshotForBackfill {
  event_id: string;
  user_id: string;
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
