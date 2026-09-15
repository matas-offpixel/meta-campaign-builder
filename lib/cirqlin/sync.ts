/**
 * lib/cirqlin/sync.ts
 *
 * Persist Cirqlin's partner-read payload into `signup_source_snapshots`.
 * One row per (event, source, day). A Cirqlin miss never throws — the
 * Mailchimp refresh / EOD cron report it and keep writing.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchCirqlinSignupsByTag } from "./client.ts";
import { buildCirqlinSnapshotRows } from "./snapshot-rows.ts";
import type { CirqlinFetchFailureReason } from "./types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any>;

export interface CirqlinSyncResult {
  eventId: string;
  ok: boolean;
  reason?: CirqlinFetchFailureReason | "upsert";
  counted?: number;
  daysWritten?: number;
  error?: string;
}

async function writeNoPageRow(
  supabase: AnySupabase,
  eventId: string,
  tag: string,
): Promise<CirqlinSyncResult> {
  const day = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("signup_source_snapshots").upsert(
    {
      event_id: eventId,
      source: "cirqlin",
      day,
      signups_day: 0,
      signups_total: 0,
      raw_json: { reason: "no_page", tag },
      snapshot_at: new Date().toISOString(),
    },
    { onConflict: "event_id,source,day" },
  );
  if (error) {
    return { eventId, ok: false, reason: "upsert", error: error.message };
  }
  return { eventId, ok: true, reason: "no_page", counted: 0, daysWritten: 1 };
}

/**
 * Fetch Cirqlin for `tag` and upsert the daily rows. `no_page` writes a
 * sentinel row so the card can say Cirqlin has no page without guessing.
 * Network / 5xx / missing secret leave the table alone.
 */
export async function syncCirqlinSignupsForEvent(
  supabase: AnySupabase,
  input: { eventId: string; tag: string },
): Promise<CirqlinSyncResult> {
  const fetched = await fetchCirqlinSignupsByTag(input.tag);
  if (!fetched.ok) {
    if (fetched.reason === "no_page") {
      return writeNoPageRow(supabase, input.eventId, input.tag);
    }
    return {
      eventId: input.eventId,
      ok: false,
      reason: fetched.reason,
      error: fetched.message,
    };
  }

  const rows = buildCirqlinSnapshotRows(input.eventId, fetched.payload);

  const { error } = await supabase
    .from("signup_source_snapshots")
    .upsert(rows, { onConflict: "event_id,source,day" });

  if (error) {
    return {
      eventId: input.eventId,
      ok: false,
      reason: "upsert",
      error: error.message,
    };
  }

  return {
    eventId: input.eventId,
    ok: true,
    counted: fetched.payload.totals.counted,
    daysWritten: rows.length,
  };
}
