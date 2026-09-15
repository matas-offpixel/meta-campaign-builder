/**
 * lib/db/signup-source-snapshots.ts
 *
 * Read path for Cirqlin (and later) per-day signup snapshots.
 * Same contract the Daily Tracker already uses for Mailchimp:
 * an ordered list of day rows, oldest first.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CirqlinSnapshotRow } from "../cirqlin/types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any>;

export async function loadCirqlinSnapshotsForEvents(
  supabase: AnySupabase,
  eventIds: readonly string[],
): Promise<Map<string, CirqlinSnapshotRow[]>> {
  const out = new Map<string, CirqlinSnapshotRow[]>();
  if (eventIds.length === 0) return out;

  const { data, error } = await supabase
    .from("signup_source_snapshots")
    .select("event_id, day, signups_day, signups_total, snapshot_at, raw_json")
    .eq("source", "cirqlin")
    .in("event_id", [...eventIds])
    .order("day", { ascending: true });

  if (error || !data) return out;

  for (const row of data as Array<{
    event_id: string;
    day: string;
    signups_day: number;
    signups_total: number;
    snapshot_at: string;
    raw_json: Record<string, unknown> | null;
  }>) {
    const list = out.get(row.event_id) ?? [];
    list.push({
      day: row.day,
      signups_day: row.signups_day,
      signups_total: row.signups_total,
      snapshot_at: row.snapshot_at,
      raw_json: row.raw_json,
    });
    out.set(row.event_id, list);
  }
  return out;
}

export async function loadCirqlinSnapshotsForEvent(
  supabase: AnySupabase,
  eventId: string,
): Promise<CirqlinSnapshotRow[]> {
  const map = await loadCirqlinSnapshotsForEvents(supabase, [eventId]);
  return map.get(eventId) ?? [];
}
