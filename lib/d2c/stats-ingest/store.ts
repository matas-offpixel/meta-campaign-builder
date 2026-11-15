/**
 * lib/d2c/stats-ingest/store.ts
 *
 * Upsert rows into d2c_broadcast_stats without ever writing NULL over a
 * stored value.
 *
 *   - A count, name, date or audience the provider didn't return this
 *     run is left out of the upsert, so the stored value stays. Rows are
 *     batched by the set of columns they carry, because a PostgREST
 *     upsert writes every column in its column list (a missing key
 *     becomes NULL).
 *   - client_id, event_id and attribution are always written together:
 *     they are worked out from this run's list names, and "no show" is a
 *     real answer, not a missing read. The run stops before writing if
 *     the events read fails, so a failed read never clears a show.
 *
 * Pure apart from the injected db.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { D2CStatsRow } from "./types.ts";

type Db = Pick<SupabaseClient, "from">;

export const STATS_CONFLICT = "provider,account_id,external_id";
const BATCH = 200;

/** Always written, even when null. */
const ALWAYS = new Set(["provider", "account_id", "external_id", "channel", "client_id", "event_id", "attribution", "audience_kind", "fetched_at"]);

/** The row with null / undefined optional columns removed. */
export function writableRow(row: D2CStatsRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (ALWAYS.has(k) || (v !== null && v !== undefined)) out[k] = v;
  }
  return out;
}

/** Writable rows grouped by their column set. */
export function batchesByColumns(rows: readonly D2CStatsRow[]): Record<string, unknown>[][] {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const w = writableRow(row);
    const key = Object.keys(w).sort().join(",");
    const list = groups.get(key) ?? [];
    list.push(w);
    groups.set(key, list);
  }
  const out: Record<string, unknown>[][] = [];
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i += BATCH) out.push(list.slice(i, i + BATCH));
  }
  return out;
}

/** Upsert; returns rows written. Throws on the first failed batch. */
export async function upsertStatsRows(db: Db, rows: readonly D2CStatsRow[]): Promise<number> {
  let written = 0;
  for (const batch of batchesByColumns(rows)) {
    const { error } = await db
      .from("d2c_broadcast_stats")
      .upsert(batch, { onConflict: STATS_CONFLICT, ignoreDuplicates: false });
    if (error) throw new Error(`d2c_broadcast_stats upsert: ${error.message}`);
    written += batch.length;
  }
  return written;
}
