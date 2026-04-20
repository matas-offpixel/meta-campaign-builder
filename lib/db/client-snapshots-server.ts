import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Server-side helper to fetch the latest weekly snapshot per event for
 * a single client.
 *
 * Why a separate file:
 *   `events-server.ts` keeps event reads to a single table. Joining
 *   snapshots there would force every events query (calendar, today,
 *   pending-action filter, etc.) to pay the snapshot read cost. The
 *   stats panel on the client overview is the only admin surface that
 *   needs this today, so we read snapshots in parallel from the page's
 *   Promise.all and merge in the component.
 *
 * Why not reuse `loadClientPortalData`:
 *   The portal helper uses a service-role client (the public token has
 *   already been validated). The dashboard runs under the user's
 *   Supabase session and must respect RLS — separate read path.
 *
 * Returns a plain `Record<event_id, LatestSnapshot>` rather than a Map
 * so the value can cross the RSC → client-component prop boundary
 * without serialization gotchas.
 */

export interface LatestSnapshot {
  tickets_sold: number | null;
  revenue: number | null;
  captured_at: string;
  week_start: string;
}

export async function listLatestSnapshotsForClient(
  userId: string,
  clientId: string,
): Promise<Record<string, LatestSnapshot>> {
  const supabase = await createClient();

  // captured_at DESC + take-first-per-event in memory. The table is
  // bounded per (client_id, week_start) so the row count is at most
  // weeks-elapsed × events-per-client — well under any pagination
  // threshold we'd reasonably need to worry about for one client.
  const { data, error } = await supabase
    .from("client_report_weekly_snapshots")
    .select("event_id, tickets_sold, revenue, captured_at, week_start")
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .order("captured_at", { ascending: false });

  if (error) {
    console.warn(
      "Supabase listLatestSnapshotsForClient error:",
      error.message,
    );
    return {};
  }

  const out: Record<string, LatestSnapshot> = {};
  for (const row of data ?? []) {
    if (out[row.event_id]) continue;
    out[row.event_id] = {
      tickets_sold: row.tickets_sold,
      revenue: row.revenue,
      captured_at: row.captured_at,
      week_start: row.week_start,
    };
  }
  return out;
}
