import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { TicketSalesSnapshot } from "@/lib/ticketing/types";

/**
 * lib/db/ticket-snapshots.ts
 *
 * Read-side helper for `ticket_sales_snapshots` (migration 029). The
 * write path is owned by the cron + the per-link sync — this module
 * exists purely so dashboard surfaces (the new pacing card on the
 * event Reporting tab) can pull a windowed time-series without
 * dragging the full ticketing CRUD module into a server component.
 *
 * We don't reuse `listRecentSnapshotsForEvent` from `lib/db/ticketing.ts`
 * because that helper takes an explicit Supabase client (it lives in a
 * module shared with route handlers + the cron) and returns rows in
 * descending order. The pacing card needs ascending order over a
 * day-bound window, which is a simpler shape to expose at the
 * server-component boundary.
 */

export interface PacingSnapshot {
  snapshot_at: string;
  tickets_sold: number;
}

/**
 * Snapshots for `eventId` over the last `sinceDays` days, ascending
 * by `snapshot_at`. Returns an empty array when no snapshots exist
 * (the expected state for events whose client hasn't connected
 * Eventbrite yet) and on RLS / table-missing errors so the caller's
 * `.catch(...)` defensive fan-out keeps the page rendering.
 */
export async function getSnapshotsForEvent(
  eventId: string,
  options?: { sinceDays?: number },
): Promise<PacingSnapshot[]> {
  const sinceDays = options?.sinceDays ?? 60;
  const supabase = await createClient();
  const sinceIso = new Date(
    Date.now() - sinceDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Cast through `any` because the regenerated types haven't landed
  // on every checkout yet — same pattern as lib/db/ticketing.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data, error } = await sb
    .from("ticket_sales_snapshots")
    .select("snapshot_at, tickets_sold")
    .eq("event_id", eventId)
    .gte("snapshot_at", sinceIso)
    .order("snapshot_at", { ascending: true });

  if (error) {
    console.warn("[ticket-snapshots getSnapshotsForEvent]", error.message);
    return [];
  }
  return (
    ((data ?? []) as Pick<
      TicketSalesSnapshot,
      "snapshot_at" | "tickets_sold"
    >[]) ?? []
  );
}
