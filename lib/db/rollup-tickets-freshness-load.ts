import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ROLLUP_TICKETS_DEAD_WINDOW_DAYS,
  snapshotListingGrowth,
  type RollupTicketsFreshnessInput,
  type SnapshotListingLife,
} from "@/lib/ticketing/rollup-tickets-freshness";
import { dedupeOn } from "./paged-read.ts";

function windowStartIso(now: Date, days: number): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function windowStartDate(now: Date, days: number): string {
  return windowStartIso(now, days).slice(0, 10);
}

/**
 * Snapshot ingest vs rollup tickets for the freshness alarm.
 * Growth is per listing (event, source, external id), not per event:
 * two flat listings on one show are not growth.
 */
export async function loadRollupTicketsFreshnessInput(
  supabase: SupabaseClient,
  now = new Date(),
  windowDays = ROLLUP_TICKETS_DEAD_WINDOW_DAYS,
): Promise<RollupTicketsFreshnessInput> {
  const sinceIso = windowStartIso(now, windowDays);
  const sinceDate = windowStartDate(now, windowDays);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const snapCountRes = await sb
    .from("ticket_sales_snapshots")
    .select("id", { count: "exact", head: true })
    .gte("snapshot_at", sinceIso);
  const snapshotRowsInWindow = Number(snapCountRes.count ?? 0);

  const listings: SnapshotListingLife[] = [];
  const seenSnapshots = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("ticket_sales_snapshots")
      .select("id, event_id, source, external_event_id, connection_id, tickets_sold")
      .gte("snapshot_at", sinceIso)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) {
      console.warn("[rollup-tickets-freshness] snapshot page failed", error.message);
      break;
    }
    const page = (data ?? []) as Array<SnapshotListingLife & { id: string }>;
    for (const row of dedupeOn(page, ["id"])) {
      if (row.id != null) {
        if (seenSnapshots.has(row.id)) continue;
        seenSnapshots.add(row.id);
      }
      listings.push(row);
    }
    if (page.length < 1000) break;
  }
  const snapshotLifetimeGrowthInWindow = snapshotListingGrowth(listings);

  let rollupTicketsSumInWindow = 0;
  const seenRollups = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("event_daily_rollups")
      .select("id, tickets_sold")
      .gte("date", sinceDate)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) {
      console.warn("[rollup-tickets-freshness] rollup page failed", error.message);
      break;
    }
    const page = (data ?? []) as Array<{ id: string; tickets_sold: number | null }>;
    for (const row of page) {
      if (row.id != null) {
        if (seenRollups.has(row.id)) continue;
        seenRollups.add(row.id);
      }
      rollupTicketsSumInWindow += Number(row.tickets_sold ?? 0);
    }
    if (page.length < 1000) break;
  }

  return {
    snapshotRowsInWindow,
    snapshotLifetimeGrowthInWindow,
    rollupTicketsSumInWindow,
  };
}
