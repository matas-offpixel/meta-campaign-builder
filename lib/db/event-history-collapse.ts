/**
 * lib/db/event-history-collapse.ts
 *
 * Pure collapse helper lifted out of `event-history-resolver.ts` so
 * unit tests can import it without tripping the `server-only` guard
 * that belongs on anything holding a Supabase client.
 *
 * `collapseWeekly` is the single tie-break rule the dashboard (client
 * component) and the server loader both rely on — keeping it in a
 * thread-neutral module means the same code paths evaluate the same
 * way on both sides.
 */

export interface WeeklySnapshot {
  snapshot_at: string;
  tickets_sold: number;
  source: "eventbrite" | "manual" | "xlsx_import" | "foursomething";
}

/**
 * Resolve one snapshot per (eventId, snapshot_at week bucket),
 * preferring manual > xlsx_import > eventbrite when multiple rows
 * exist for the same week. Week bucket = the snapshot_at date
 * converted to YYYY-MM-DD (UTC), so two same-week rows with
 * different HH:MM still collapse correctly.
 */
export function collapseWeekly(
  rows: Array<{
    snapshot_at: string;
    tickets_sold: number;
    source: string;
  }>,
): WeeklySnapshot[] {
  // Source priority: higher number wins on ties. Matches the
  // "operator override" intuition — manual edits from the dashboard
  // always trump API-pulled or xlsx-bulk-loaded rows.
  const priority: Record<string, number> = {
    eventbrite: 1,
    foursomething: 2,
    xlsx_import: 3,
    manual: 4,
  };
  const byDay = new Map<string, WeeklySnapshot>();
  for (const r of rows) {
    const day = ymd(r.snapshot_at);
    if (!day) continue;
    const normalizedSource = normalizeSource(r.source);
    const current = byDay.get(day);
    if (
      !current ||
      (priority[normalizedSource] ?? 0) > (priority[current.source] ?? 0)
    ) {
      byDay.set(day, {
        snapshot_at: day,
        tickets_sold: Number(r.tickets_sold),
        source: normalizedSource,
      });
    }
  }
  return Array.from(byDay.values()).sort((a, b) =>
    a.snapshot_at.localeCompare(b.snapshot_at),
  );
}

function normalizeSource(s: string): WeeklySnapshot["source"] {
  if (
    s === "eventbrite" ||
    s === "manual" ||
    s === "xlsx_import" ||
    s === "foursomething"
  ) {
    return s;
  }
  // Unknown-but-valid (e.g. a future provider written by an older app
  // version) falls back to `eventbrite` rather than throwing — the
  // chart renders instead of disappearing, and the misclassification
  // is recoverable once the new app version ships.
  return "eventbrite";
}

function ymd(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}
