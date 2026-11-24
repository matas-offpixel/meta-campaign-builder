/**
 * Tickets leg for an event with no ticketing link.
 *
 * A linked event's tickets leg fetches its provider, writes snapshots, then
 * builds `event_daily_rollups.tickets_sold` from every snapshot the event has
 * (`buildRollupTicketDeltasFromSnapshots`). An event with no link used to stop
 * at "not_linked" before that last step, so snapshots that arrive without a
 * provider — Electric's Internal Counts PDFs (`internal_counts`), manual
 * entries, xlsx imports — never reached the rollup. `tickets_sold` read 0 for
 * every event from 3 Sep 2026, the last day 4theFans (the only linked client)
 * sold a ticket.
 *
 * This leg is that last step on its own, with the same builder, the same
 * collapse and the same upsert as the linked path:
 *   - each UTC day resolves through `collapseWeekly` (lib/db/event-history-collapse.ts):
 *     manual > internal_counts > xlsx_import > fourthefans/foursomething > eventbrite;
 *   - the day's value is its latest snapshot;
 *   - a row is written only for a day that has a snapshot, holding that day's
 *     rise in the cumulative total. A day with no snapshot gets no row, so the
 *     running total carries forward and no sale is shown. Nothing is zero-padded.
 *
 * Skips (never failures): no snapshots → `not_linked`, as before; the client
 * is archived → `archived_client`.
 */

import {
  buildRollupTicketDeltasFromSnapshots,
  type RollupTicketDeltaRow,
  type SnapshotForRollupTickets,
} from "../ticketing/rollup-tickets-from-snapshots.ts";

export const UNLINKED_NO_SNAPSHOTS_REASON = "not_linked";
export const ARCHIVED_CLIENT_REASON = "archived_client";

export interface UnlinkedTicketsDeps {
  /** Every snapshot for the event, paged past PostgREST's 1,000-row cap. */
  listSnapshots: (eventId: string) => Promise<SnapshotForRollupTickets[]>;
  isClientArchived: (clientId: string) => Promise<boolean>;
  upsertRollups: (args: {
    userId: string;
    eventId: string;
    rows: RollupTicketDeltaRow[];
  }) => Promise<{ upserted: number; skipped_noop: number }>;
}

export interface UnlinkedTicketsInput {
  userId: string;
  eventId: string;
  clientId: string | null;
}

export interface UnlinkedTicketsResult {
  ok: boolean;
  reason?: string;
  error?: string;
  rowsWritten?: number;
  skipped_noop?: number;
  snapshotRows: number;
  rowsAttempted: number;
}

/** The rows the leg would write. Pure: the dry run and the tests call it. */
export function planUnlinkedTicketRows(
  snapshots: SnapshotForRollupTickets[],
): RollupTicketDeltaRow[] {
  return buildRollupTicketDeltasFromSnapshots(snapshots);
}

export async function runUnlinkedTicketsRollupLeg(
  input: UnlinkedTicketsInput,
  deps: UnlinkedTicketsDeps,
): Promise<UnlinkedTicketsResult> {
  if (input.clientId && (await deps.isClientArchived(input.clientId))) {
    return {
      ok: false,
      reason: ARCHIVED_CLIENT_REASON,
      error: "The client is archived.",
      snapshotRows: 0,
      rowsAttempted: 0,
    };
  }

  const snapshots = await deps.listSnapshots(input.eventId);
  if (snapshots.length === 0) {
    return {
      ok: false,
      reason: UNLINKED_NO_SNAPSHOTS_REASON,
      error: "No ticketing link — pick the Eventbrite event in the panel above first.",
      snapshotRows: 0,
      rowsAttempted: 0,
    };
  }

  const rows = planUnlinkedTicketRows(snapshots);
  if (rows.length === 0) {
    return { ok: true, rowsWritten: 0, skipped_noop: 0, snapshotRows: snapshots.length, rowsAttempted: 0 };
  }
  const { upserted, skipped_noop } = await deps.upsertRollups({
    userId: input.userId,
    eventId: input.eventId,
    rows,
  });
  return {
    ok: true,
    rowsWritten: upserted,
    skipped_noop,
    snapshotRows: snapshots.length,
    rowsAttempted: rows.length,
  };
}
