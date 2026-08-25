"use server";

import { revalidatePath } from "next/cache";

import { requireClientContext } from "@/lib/auth/get-client-context";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  authorizeClientTicketSales,
  clientManualSalesPayload,
  computeClientSalesRollupDeltas,
  evaluateManualSalesEntry,
  reportedSalesFromSnapshots,
  utcDateOnly,
} from "@/lib/admin/client-ticket-sales";
import { upsertEventbriteRollups } from "@/lib/db/event-daily-rollups";
import {
  listAllSnapshotsForEvent,
  mirrorEventTicketsSold,
} from "@/lib/db/ticketing";
import { funnelCostLabel } from "@/lib/dashboard/event-funnel";
import type { SnapshotForRollupTickets } from "@/lib/ticketing/rollup-tickets-from-snapshots";

/**
 * Client-dashboard write for cumulative ticket totals (roadmap v2 A.3).
 *
 * requireClientContext first; service-role write pinned to that
 * client_id. Reuses ticket_sales_snapshots source='manual' and the
 * #836 builder so cron / backfill / this action share one collapse.
 */

export interface ReportTicketSalesState {
  status: "idle" | "saved" | "error";
  eventId: string | null;
  reason: string | null;
  message: string | null;
  purchases: number | null;
  costPerTicketLabel: string | null;
}

export const INITIAL_REPORT_TICKET_SALES_STATE: ReportTicketSalesState = {
  status: "idle",
  eventId: null,
  reason: null,
  message: null,
  purchases: null,
  costPerTicketLabel: null,
};

function errorState(
  eventId: string | null,
  reason: string,
  message: string,
): ReportTicketSalesState {
  return {
    status: "error",
    eventId,
    reason,
    message,
    purchases: null,
    costPerTicketLabel: null,
  };
}

async function getOrCreateManualConnection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  args: { clientId: string; ownerUserId: string },
): Promise<string> {
  const { data: existing } = await sb
    .from("client_ticketing_connections")
    .select("id")
    .eq("client_id", args.clientId)
    .eq("provider", "manual")
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await sb
    .from("client_ticketing_connections")
    .insert({
      user_id: args.ownerUserId,
      client_id: args.clientId,
      provider: "manual",
      credentials: {},
      external_account_id: null,
      status: "active",
    })
    .select("id")
    .maybeSingle();
  if (created?.id) return created.id as string;
  if (error) {
    const { data: raced } = await sb
      .from("client_ticketing_connections")
      .select("id")
      .eq("client_id", args.clientId)
      .eq("provider", "manual")
      .eq("user_id", args.ownerUserId)
      .maybeSingle();
    if (raced?.id) return raced.id as string;
    throw new Error(
      `[client-ticket-sales] manual connection failed: ${error.message}`,
    );
  }
  throw new Error("[client-ticket-sales] manual connection returned no id");
}

export async function reportClientTicketSales(
  _prev: ReportTicketSalesState,
  formData: FormData,
): Promise<ReportTicketSalesState> {
  const clientSlug = String(formData.get("client_slug") ?? "").trim();
  const eventId = String(formData.get("event_id") ?? "").trim();
  const rawTotal = String(formData.get("tickets_sold") ?? "").trim();
  const confirmDecrease = formData.get("confirm_decrease") === "on";

  const membership = await requireClientContext(clientSlug || undefined);

  if (!eventId) {
    return errorState(null, "event_not_owned", "Choose an event.");
  }

  const nextTotal = Number(rawTotal);
  if (!Number.isFinite(nextTotal)) {
    return errorState(
      eventId,
      "invalid_total",
      "Enter the total tickets sold to date — a whole number, not a day's extra sales.",
    );
  }
  const ticketsSold = Math.trunc(nextTotal);

  const sb = createServiceRoleClient();
  const { data: event, error: eventError } = await sb
    .from("events")
    .select("id, client_id, user_id")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) {
    return errorState(
      eventId,
      "event_not_owned",
      `Could not load the event: ${eventError.message}`,
    );
  }

  const auth = authorizeClientTicketSales({
    userId: membership.userId,
    membership: {
      userId: membership.userId,
      clientId: membership.clientId,
    },
    event: event
      ? { id: event.id as string, clientId: event.client_id as string }
      : null,
  });
  if (!auth.ok) {
    const message =
      auth.reason === "wrong_client"
        ? "That event belongs to another account."
        : auth.reason === "unauthenticated"
          ? "Sign in to report sales."
          : "Event not found.";
    return errorState(eventId, auth.reason, message);
  }

  const snapshots = await listAllSnapshotsForEvent(sb, eventId);
  const previous = reportedSalesFromSnapshots(snapshots);
  const previousTotal = snapshots.length > 0 ? previous.purchases : null;

  const evaluated = evaluateManualSalesEntry({
    previousTotal,
    nextTotal: ticketsSold,
    confirmDecrease,
  });
  if (!evaluated.ok) {
    const message =
      evaluated.reason === "decrease_needs_confirm"
        ? "This total is lower than the last reported figure. Confirm it is a correction — totals are cumulative, not a day's extra sales."
        : "Enter a non-negative whole number of tickets sold to date.";
    return errorState(eventId, evaluated.reason, message);
  }

  const ownerUserId = event!.user_id as string;
  const connectionId = await getOrCreateManualConnection(sb, {
    clientId: membership.clientId,
    ownerUserId,
  });
  const now = new Date();
  const snapshotAt = utcDateOnly(now);
  const payload = clientManualSalesPayload({
    enteredByUserId: membership.userId,
    enteredAt: now.toISOString(),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { error: upsertError } = await sbAny
    .from("ticket_sales_snapshots")
    .upsert(
      {
        user_id: ownerUserId,
        event_id: eventId,
        connection_id: connectionId,
        snapshot_at: snapshotAt,
        tickets_sold: ticketsSold,
        tickets_available: null,
        gross_revenue_cents: null,
        currency: null,
        source: "manual",
        raw_payload: payload,
      },
      { onConflict: "event_id,snapshot_at,source" },
    );
  if (upsertError) {
    return errorState(
      eventId,
      "save_failed",
      `Save failed: ${upsertError.message}`,
    );
  }

  const after = await listAllSnapshotsForEvent(sb, eventId);
  const deltas = computeClientSalesRollupDeltas(
    after as SnapshotForRollupTickets[],
  );
  if (deltas.length > 0) {
    await upsertEventbriteRollups(sb, {
      userId: ownerUserId,
      eventId,
      rows: deltas,
    });
  }
  await mirrorEventTicketsSold(sb, {
    eventId,
    userId: ownerUserId,
    ticketsSold,
  });

  const spendRows = await sbAny
    .from("event_daily_rollups")
    .select("ad_spend, tiktok_spend, google_ads_spend")
    .eq("event_id", eventId);
  const spend = ((spendRows.data ?? []) as Array<{
    ad_spend: number | null;
    tiktok_spend: number | null;
    google_ads_spend: number | null;
  }>).reduce(
    (sum, row) =>
      sum +
      Number(row.ad_spend ?? 0) +
      Number(row.tiktok_spend ?? 0) +
      Number(row.google_ads_spend ?? 0),
    0,
  );
  const reported = reportedSalesFromSnapshots(after, spend);

  revalidatePath(`/admin/${membership.clientSlug}/sales`);

  return {
    status: "saved",
    eventId,
    reason: null,
    message: `Saved. Purchases are now ${reported.purchases.toLocaleString("en-GB")}. Your figure is the reported total.`,
    purchases: reported.purchases,
    costPerTicketLabel: formatClientCostPerTicket(reported.costPerTicket),
  };
}

function formatClientCostPerTicket(
  cell: ReturnType<typeof reportedSalesFromSnapshots>["costPerTicket"],
): string {
  if (cell.kind === "amount") {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 2,
    }).format(cell.value);
  }
  return funnelCostLabel(cell);
}
