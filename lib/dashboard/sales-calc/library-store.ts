/**
 * lib/dashboard/sales-calc/library-store.ts
 *
 * Stores D10 library entries the calc computed and the table doesn't hold
 * yet (migration 238). Insert-only: an existing row (same show, final day
 * and final figure) is left as it is, so a lift is never recomputed
 * silently. Only the internal page calls this, on the owner's session;
 * the share route never writes.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingTable } from "./load.ts";
import type { LiftEntry } from "./types.ts";

type Db = Pick<SupabaseClient, "from">;

export function libraryRow(entry: Omit<LiftEntry, "computedAt">, owner: { userId: string; clientId: string }) {
  return {
    user_id: owner.userId,
    client_id: owner.clientId,
    event_id: entry.eventId,
    event_code: entry.code,
    show_date: entry.showDate,
    d21_day: entry.d21Day,
    d21_sold: entry.d21Sold,
    d7_day: entry.d7Day,
    d7_sold: entry.d7Sold,
    final_day: entry.finalDay,
    final_paid: entry.finalPaid,
    comps_excluded: entry.compsExcluded,
    per_day_before: entry.perDayBefore,
    per_day_final_week: entry.perDayFinalWeek,
    lift: entry.lift,
    final_block_id: entry.finalBlockId,
  };
}

/** Returns how many rows were offered; 0 and no error when migration 238 isn't applied yet. */
export async function storeLibraryEntries(
  sb: Db,
  entries: readonly Omit<LiftEntry, "computedAt">[],
  owner: { userId: string; clientId: string },
): Promise<{ stored: number; skipped: "no_table" | null }> {
  if (!entries.length) return { stored: 0, skipped: null };
  const { error } = await sb
    .from("reference_lift_library")
    .upsert(entries.map((e) => libraryRow(e, owner)), { onConflict: "event_id,final_day,final_paid", ignoreDuplicates: true });
  if (error) {
    if (isMissingTable(new Error(`reference_lift_library: ${error.message}`))) return { stored: 0, skipped: "no_table" };
    throw new Error(`reference_lift_library insert failed: ${error.message}`);
  }
  return { stored: entries.length, skipped: null };
}
