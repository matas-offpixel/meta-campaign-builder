/**
 * lib/cirqlin/tracker-signups.ts
 *
 * Per-day and range totals for the Daily Tracker REGS column when
 * Cirqlin snapshots exist. Cirqlin's `signups_day` is already a
 * day's count (not a cumulative), so the bucket is a sum, not a delta.
 */

import type { CirqlinSnapshotRow } from "./types.ts";

export function isCirqlinNoPageRow(row: CirqlinSnapshotRow): boolean {
  return row.raw_json?.reason === "no_page";
}

/** True when Cirqlin has a real page and at least one day of counts. */
export function hasCirqlinRegs(
  rows: readonly CirqlinSnapshotRow[] | null | undefined,
): boolean {
  if (!rows || rows.length === 0) return false;
  return rows.some((row) => !isCirqlinNoPageRow(row));
}

export function cirqlinSignupsForDay(
  rows: readonly CirqlinSnapshotRow[],
  day: string,
): number | null {
  let found: number | null = null;
  for (const row of rows) {
    if (isCirqlinNoPageRow(row)) continue;
    if (row.day === day) found = row.signups_day;
  }
  return found;
}

export function cirqlinSignupsForRange(
  rows: readonly CirqlinSnapshotRow[],
  startDay: string,
  endDayInclusive: string,
): number | null {
  if (endDayInclusive < startDay) return null;
  let total = 0;
  let any = false;
  for (const row of rows) {
    if (isCirqlinNoPageRow(row)) continue;
    if (row.day < startDay || row.day > endDayInclusive) continue;
    total += row.signups_day;
    any = true;
  }
  return any ? total : null;
}

export function cirqlinSignupsForWeek(
  rows: readonly CirqlinSnapshotRow[],
  weekStartMonday: string,
): number | null {
  const d = new Date(`${weekStartMonday}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 6);
  return cirqlinSignupsForRange(rows, weekStartMonday, d.toISOString().slice(0, 10));
}
