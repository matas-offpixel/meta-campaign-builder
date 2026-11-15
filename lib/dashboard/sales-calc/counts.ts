/**
 * lib/dashboard/sales-calc/counts.ts
 *
 * One ticket count per show per day, one source each, never summed or
 * blended (D8). The priority is lib/db/event-history-collapse.ts's
 * (manual > internal_counts > xlsx_import > fourthefans > eventbrite).
 *
 * Windows subtract consecutive counts, so a show's series follows one
 * reporting flow: its highest-priority automatic source (Internal Counts
 * for NX). A manual entry is a person correcting a figure, so it replaces
 * that day's count, or adds the day. A lower source's days are dropped
 * rather than mixed in, which would make a window out of two different
 * totals.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { SOURCE_PRIORITY } from "../../db/event-history-collapse.ts";
import type { CountSource, ShowCount } from "./types.ts";

export interface SnapshotRow {
  snapshot_at: string;
  tickets_sold: number;
  source: string;
  /** Internal Counts' comps (raw_payload.comps). */
  comps?: number | null;
  /** Tie-break inside one source and day: the later row wins. */
  created_at?: string | null;
}

const KNOWN: ReadonlySet<string> = new Set(["manual", "internal_counts", "xlsx_import", "fourthefans", "foursomething", "eventbrite"]);

export function collapseCounts(rows: readonly SnapshotRow[]): ShowCount[] {
  const bySourceDay = new Map<string, SnapshotRow>();
  for (const r of rows) {
    if (!KNOWN.has(r.source) || !Number.isFinite(Number(r.tickets_sold))) continue;
    const day = r.snapshot_at.slice(0, 10);
    const key = `${r.source}|${day}`;
    const current = bySourceDay.get(key);
    const later = (a: SnapshotRow, b: SnapshotRow) =>
      (a.snapshot_at > b.snapshot_at) || (a.snapshot_at === b.snapshot_at && (a.created_at ?? "") > (b.created_at ?? ""));
    if (!current || later(r, current)) bySourceDay.set(key, r);
  }
  let flow: string | null = null;
  for (const r of bySourceDay.values()) {
    if (r.source === "manual") continue;
    if (flow == null || (SOURCE_PRIORITY[r.source] ?? 0) > (SOURCE_PRIORITY[flow] ?? 0)) flow = r.source;
  }
  const byDay = new Map<string, ShowCount>();
  for (const r of bySourceDay.values()) {
    if (r.source !== flow) continue;
    const day = r.snapshot_at.slice(0, 10);
    byDay.set(day, { day, sold: Number(r.tickets_sold), comps: r.comps == null ? null : Number(r.comps), source: r.source as CountSource });
  }
  for (const r of bySourceDay.values()) {
    if (r.source !== "manual") continue;
    const day = r.snapshot_at.slice(0, 10);
    byDay.set(day, { day, sold: Number(r.tickets_sold), comps: null, source: "manual" });
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
