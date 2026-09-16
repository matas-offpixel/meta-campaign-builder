/**
 * D.O.D Cirqlin days as counted on prod: 19 live rows, 1,843 total.
 * Mid-window (26 Aug – 8 Sept) is 1,556 — the per-day split here is
 * even so the sums stay exact; the tests pin the sums, not the shape.
 */

import type { CirqlinSnapshotRow } from "../../cirqlin/types.ts";

const SNAPSHOT_AT = "2026-09-15T12:00:00.000Z";

function row(day: string, signups_day: number): CirqlinSnapshotRow {
  return {
    day,
    signups_day,
    signups_total: 1843,
    snapshot_at: SNAPSHOT_AT,
    raw_json: { totals: { counted: 1843 } },
  };
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** 18 Aug 1 · 19 Aug 3 · 24 Aug 130 · 25 Aug 120 · 26 Aug–8 Sept 1,556 · 9 Sept 33. */
export function dodCirqlinDays(): CirqlinSnapshotRow[] {
  const mid = daysBetween("2026-08-26", "2026-09-08");
  const base = Math.floor(1556 / mid.length);
  let rem = 1556 - base * mid.length;
  const midRows = mid.map((day) => {
    const n = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
    return row(day, n);
  });
  return [
    row("2026-08-18", 1),
    row("2026-08-19", 3),
    row("2026-08-24", 130),
    row("2026-08-25", 120),
    ...midRows,
    row("2026-09-09", 33),
    {
      day: "1970-01-01",
      signups_day: 0,
      signups_total: 0,
      snapshot_at: SNAPSHOT_AT,
      raw_json: { reason: "unauthorized" },
    },
  ];
}

export const DOD_GENERAL_SALE_AT = "2026-09-09T13:00:00+00:00";
export const DOD_SPEND = 1439.37;
