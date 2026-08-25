import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  reportedSalesFromSnapshots,
  type ClientSalesEventRow,
} from "@/lib/admin/client-ticket-sales";
import type { SnapshotForRollupTickets } from "@/lib/ticketing/rollup-tickets-from-snapshots";

export type { ClientSalesEventRow };

/**
 * Events a client can report sales against. Service-role after
 * requireClientContext — snapshots and rollups have no client-member
 * SELECT policy. Every query is pinned to the membership client_id.
 */

interface EventRow {
  id: string;
  name: string;
  event_code: string | null;
  event_date: string | null;
  client_id: string;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function listSnapshotsForEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  eventIds: string[],
): Promise<Map<string, SnapshotForRollupTickets[]>> {
  const byEvent = new Map<string, SnapshotForRollupTickets[]>();
  for (const id of eventIds) byEvent.set(id, []);
  if (eventIds.length === 0) return byEvent;

  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from("ticket_sales_snapshots")
      .select(
        "event_id, snapshot_at, tickets_sold, source, gross_revenue_cents, external_event_id, connection_id",
      )
      .in("event_id", eventIds)
      .order("snapshot_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      throw new Error(
        `[client-ticket-sales] snapshot load failed: ${error.message}`,
      );
    }
    const page = (data ?? []) as Array<
      SnapshotForRollupTickets & { event_id: string }
    >;
    for (const row of page) {
      byEvent.get(row.event_id)?.push(row);
    }
    if (page.length < pageSize) break;
  }
  return byEvent;
}

async function listSpendForEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  eventIds: string[],
): Promise<Map<string, number>> {
  const spend = new Map<string, number>();
  for (const id of eventIds) spend.set(id, 0);
  if (eventIds.length === 0) return spend;

  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from("event_daily_rollups")
      .select("event_id, ad_spend, tiktok_spend, google_ads_spend")
      .in("event_id", eventIds)
      .range(from, from + pageSize - 1);
    if (error) {
      throw new Error(
        `[client-ticket-sales] rollup spend load failed: ${error.message}`,
      );
    }
    const page = (data ?? []) as Array<{
      event_id: string;
      ad_spend: number | null;
      tiktok_spend: number | null;
      google_ads_spend: number | null;
    }>;
    for (const row of page) {
      const next =
        (spend.get(row.event_id) ?? 0) +
        num(row.ad_spend) +
        num(row.tiktok_spend) +
        num(row.google_ads_spend);
      spend.set(row.event_id, next);
    }
    if (page.length < pageSize) break;
  }
  return spend;
}

export async function listClientEventsForSales(
  clientId: string,
): Promise<ClientSalesEventRow[]> {
  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("events")
    .select("id, name, event_code, event_date, client_id")
    .eq("client_id", clientId)
    .order("event_date", { ascending: false, nullsFirst: false });
  if (error) {
    throw new Error(`[client-ticket-sales] events load failed: ${error.message}`);
  }
  const events = (data ?? []) as unknown as EventRow[];
  const eventIds = events.map((e) => e.id);
  const [snapshots, spend] = await Promise.all([
    listSnapshotsForEvents(sb, eventIds),
    listSpendForEvents(sb, eventIds),
  ]);

  return events.map((event) => {
    const snaps = snapshots.get(event.id) ?? [];
    const reported = reportedSalesFromSnapshots(snaps, spend.get(event.id) ?? 0);
    return {
      eventId: event.id,
      name: event.name,
      eventCode: event.event_code,
      eventDate: event.event_date,
      previousTotal: snaps.length > 0 ? reported.purchases : null,
      previousDate: reported.lastDate,
      purchases: reported.purchases,
      spend: spend.get(event.id) ?? 0,
      costPerTicket: reported.costPerTicket,
    };
  });
}
