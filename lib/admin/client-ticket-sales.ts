/**
 * Client-dashboard manual ticket entry (roadmap v2 Phase A.3).
 *
 * Snapshots are CUMULATIVE. Manual outranks every automated feed in
 * collapse. Writes are scoped to the caller's client — never another
 * tenant's events. Rollup rebuild uses the #836 builder, not a second
 * math path.
 */

import type { SnapshotForRollupTickets } from "../ticketing/rollup-tickets-from-snapshots.ts";
import { buildRollupTicketDeltasFromSnapshots } from "../ticketing/rollup-tickets-from-snapshots.ts";
import { costPerUnit, type FunnelCostCell } from "../dashboard/event-funnel.ts";

/** Same function the cron and backfill call. Asserted by import in tests. */
export const computeClientSalesRollupDeltas =
  buildRollupTicketDeltasFromSnapshots;

export interface ReportedClientSales {
  purchases: number;
  lastDate: string | null;
  costPerTicket: FunnelCostCell;
}

/** Row the sales page renders — kept here so the client form can import it. */
export interface ClientSalesEventRow {
  eventId: string;
  name: string;
  eventCode: string | null;
  eventDate: string | null;
  previousTotal: number | null;
  previousDate: string | null;
  purchases: number;
  spend: number;
  costPerTicket: FunnelCostCell;
}

export function reportedSalesFromSnapshots(
  snapshots: SnapshotForRollupTickets[],
  spend = 0,
): ReportedClientSales {
  const rows = computeClientSalesRollupDeltas(snapshots);
  const purchases = rows.reduce((sum, r) => sum + r.tickets_sold, 0);
  return {
    purchases,
    lastDate: rows.at(-1)?.date ?? null,
    costPerTicket: costPerUnit(spend, purchases, "no_tickets_yet"),
  };
}

export type TicketSalesAuthDenial =
  | "unauthenticated"
  | "wrong_client"
  | "event_not_owned";

export type TicketSalesEntryDenial =
  | "invalid_total"
  | "decrease_needs_confirm";

export interface ClientTicketSalesMembership {
  userId: string;
  clientId: string;
}

export interface ClientTicketSalesEvent {
  id: string;
  clientId: string;
}

export function authorizeClientTicketSales(args: {
  userId: string | null;
  membership: ClientTicketSalesMembership | null;
  event: ClientTicketSalesEvent | null;
}): { ok: true } | { ok: false; reason: TicketSalesAuthDenial } {
  if (!args.userId) return { ok: false, reason: "unauthenticated" };
  if (!args.membership || args.membership.userId !== args.userId) {
    return { ok: false, reason: "unauthenticated" };
  }
  if (!args.event) return { ok: false, reason: "event_not_owned" };
  if (args.membership.clientId !== args.event.clientId) {
    return { ok: false, reason: "wrong_client" };
  }
  return { ok: true };
}

export function evaluateManualSalesEntry(args: {
  previousTotal: number | null;
  nextTotal: number;
  confirmDecrease: boolean;
}): { ok: true } | { ok: false; reason: TicketSalesEntryDenial } {
  if (!Number.isFinite(args.nextTotal) || args.nextTotal < 0) {
    return { ok: false, reason: "invalid_total" };
  }
  const previous = args.previousTotal;
  if (
    previous != null &&
    args.nextTotal < previous &&
    !args.confirmDecrease
  ) {
    return { ok: false, reason: "decrease_needs_confirm" };
  }
  return { ok: true };
}

export function clientManualSalesPayload(args: {
  enteredByUserId: string;
  enteredAt: string;
}): {
  source: "manual";
  entered_by: string;
  entered_via: "client_admin";
  entered_at: string;
} {
  return {
    source: "manual",
    entered_by: args.enteredByUserId,
    entered_via: "client_admin",
    entered_at: args.enteredAt,
  };
}

export function utcDateOnly(now: Date): string {
  return now.toISOString().slice(0, 10);
}
