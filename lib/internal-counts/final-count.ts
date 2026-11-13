/**
 * lib/internal-counts/final-count.ts
 *
 * A show's final count (ruling c): the latest written Internal Counts count
 * dated on or after show day. Earlier post-show counts stay stored for
 * audit. The flag is kept on internal_count_blocks.is_final by
 * write_internal_count_block (migration 234); this is the read helper HD3
 * uses ("Final count · Internal Counts, 5 Oct", the chart ending at show day
 * with it) and D10's library uses (DJ EZ: 305 paid + 218 comps).
 *
 * "After show day" is read as on or after: Modern Funktion's last count is
 * its show-day sheet (996, 16 Oct).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { pageAll } from "../db/paged-read.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export interface FinalCount {
  eventId: string;
  blockId: string;
  countDate: string;
  paid: number;
  comps: number;
  total: number;
}

export interface CountRow {
  blockId: string;
  countDate: string;
  paid: number;
  comps: number;
  total: number;
  writtenAt?: string | null;
}

/** Pure: the final among an event's written counts, or null before show day. */
export function pickFinal(rows: readonly CountRow[], showDate: string | null): CountRow | null {
  if (!showDate) return null;
  const after = rows.filter((r) => r.countDate >= showDate);
  after.sort((a, b) => b.countDate.localeCompare(a.countDate) || (b.writtenAt ?? "").localeCompare(a.writtenAt ?? ""));
  return after[0] ?? null;
}

/** The stored final counts for these events (at most one each). */
export async function loadFinalCounts(sb: Db, eventIds: readonly string[]): Promise<Map<string, FinalCount>> {
  const out = new Map<string, FinalCount>();
  if (eventIds.length === 0) return out;
  const data = await pageAll<{ id: string }>(
    (from, to) =>
      sb
        .from("internal_count_blocks")
        .select("id,event_id,count_date,paid_tickets,comp_tickets,total_tickets")
        .in("event_id", [...eventIds])
        .eq("is_final", true)
        .eq("status", "written")
        .order("id", { ascending: true })
        .range(from, to),
    ["id"],
    "internal_count_blocks read failed",
  );
  for (const r of data as unknown as Array<{
    id: string;
    event_id: string;
    count_date: string;
    paid_tickets: number;
    comp_tickets: number;
    total_tickets: number;
  }>) {
    out.set(r.event_id, {
      eventId: r.event_id,
      blockId: r.id,
      countDate: r.count_date,
      paid: r.paid_tickets,
      comps: r.comp_tickets,
      total: r.total_tickets,
    });
  }
  return out;
}
