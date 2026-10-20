/**
 * POST /api/admin/ticket-history-backfill
 *
 * Backfills `event_daily_ticket_history` using the TRUE per-day attendee
 * helpers:
 *   - Eventbrite: fetchDailyOrdersForEvent (order expand=attendees, grouped
 *     by order.created date in the event timezone)
 *   - 4TheFans: fetchFourthefansHistory (daily deltas from /events/{id}/sales)
 *
 * Request body (JSON):
 *   event_id?   string  — single internal event UUID to backfill
 *   client_id?  string  — backfill all events linked to this client
 *   from?       string  — inclusive YYYY-MM-DD (default: 90 days ago)
 *   to?         string  — inclusive YYYY-MM-DD (default: today)
 *
 * At least one of event_id / client_id is required.
 *
 * Auth: must be signed in (cookie session). The user must own the targeted
 * event(s). Service-role client is used for writes so upserts bypass RLS.
 *
 * Anti-drift: does NOT modify ticket_sales_snapshots, event_daily_rollups,
 * or any existing cumulative data source.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  getConnectionWithDecryptedCredentials,
  listLinksForEvent,
} from "@/lib/db/ticketing";
import {
  upsertDailyTicketHistoryBatch,
  type UpsertDailyTicketHistoryInput,
} from "@/lib/db/ticket-history";
import { fetchDailyOrdersForEvent } from "@/lib/ticketing/eventbrite/orders";
import {
  fetchFourthefansHistory,
  type FourthefansHistoryDay,
} from "@/lib/ticketing/fourthefans/history";
import { DEFAULT_API_BASE } from "@/lib/ticketing/fourthefans/client";
import type { EventTicketingLink, TicketingConnection } from "@/lib/ticketing/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RequestBody {
  event_id?: unknown;
  client_id?: unknown;
  from?: unknown;
  to?: unknown;
}

interface LinkResult {
  linkId: string;
  externalEventId: string;
  provider: string;
  rowsUpserted: number;
  error?: string;
}

interface EventResult {
  eventId: string;
  linksProcessed: LinkResult[];
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function nDaysAgoYmd(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function resolveApiBaseForLink(link: EventTicketingLink): string {
  const trimmed = link.external_api_base?.trim();
  if (trimmed) return trimmed.replace(/\/+$/, "");
  const env = process.env.FOURTHEFANS_API_BASE?.trim();
  if (env) return env.replace(/\/+$/, "");
  return DEFAULT_API_BASE.replace(/\/+$/, "");
}

function externalIdToNumber(externalEventId: string): number {
  const n = Number.parseInt(externalEventId, 10);
  if (!Number.isFinite(n)) {
    throw new Error(
      `4TheFans history API expects a numeric external_event_id; got "${externalEventId}"`,
    );
  }
  return n;
}

async function processLink(
  serviceSupabase: ReturnType<typeof createServiceRoleClient>,
  link: EventTicketingLink,
  connection: TicketingConnection,
  eventId: string,
  userId: string,
  eventTimezone: string | null,
  from: string,
  to: string,
): Promise<LinkResult> {
  const base: LinkResult = {
    linkId: link.id,
    externalEventId: link.external_event_id,
    provider: connection.provider,
    rowsUpserted: 0,
  };

  try {
    const rows: UpsertDailyTicketHistoryInput[] = [];

    if (connection.provider === "eventbrite") {
      const result = await fetchDailyOrdersForEvent({
        connection,
        externalEventId: link.external_event_id,
        eventTimezone,
      });
      // Filter to the requested window (the helper pulls all orders; we
      // only upsert rows that fall inside from..to).
      const filtered = result.rows.filter(
        (r) => r.date >= from && r.date <= to,
      );
      for (const r of filtered) {
        rows.push({
          userId,
          eventId,
          date: r.date,
          source: "eventbrite_orders",
          ticketsSold: r.ticketsSold,
          revenueMajor: r.revenue,
          currency: result.currency,
        });
      }
    } else if (connection.provider === "fourthefans") {
      const baseUrl = resolveApiBaseForLink(link);
      const token =
        typeof connection.credentials?.["access_token"] === "string"
          ? connection.credentials["access_token"]
          : "";
      if (!token) {
        return { ...base, error: "Missing access_token in connection credentials" };
      }
      const deltas: FourthefansHistoryDay[] = await fetchFourthefansHistory({
        eventId: externalIdToNumber(link.external_event_id),
        from,
        to,
        baseUrl,
        token,
      });
      for (const d of deltas) {
        rows.push({
          userId,
          eventId,
          date: d.date,
          source: "fourthefans_history",
          ticketsSold: d.tickets_sold,
          revenueMajor: d.revenue,
          currency: null,
        });
      }
    } else {
      return { ...base, error: `Provider ${connection.provider} has no history helper` };
    }

    if (rows.length > 0) {
      await upsertDailyTicketHistoryBatch(serviceSupabase, rows);
    }
    return { ...base, rowsUpserted: rows.length };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function POST(req: NextRequest) {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const eventIdInput =
    typeof body.event_id === "string" && body.event_id.trim()
      ? body.event_id.trim()
      : null;
  const clientIdInput =
    typeof body.client_id === "string" && body.client_id.trim()
      ? body.client_id.trim()
      : null;

  if (!eventIdInput && !clientIdInput) {
    return NextResponse.json(
      { ok: false, error: "Provide event_id or client_id" },
      { status: 400 },
    );
  }

  const from =
    typeof body.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.from.trim())
      ? body.from.trim()
      : nDaysAgoYmd(90);
  const to =
    typeof body.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.to.trim())
      ? body.to.trim()
      : todayYmd();

  // Auth: must be signed-in user.
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const serviceSupabase = createServiceRoleClient();

  // Resolve target event IDs.
  let targetEventIds: string[] = [];

  if (eventIdInput) {
    // Ownership check via user-scoped client (RLS).
    const { data: ev } = await userClient
      .from("events")
      .select("id")
      .eq("id", eventIdInput)
      .maybeSingle();
    if (!ev) {
      return NextResponse.json(
        { ok: false, error: "Event not found or not owned by you" },
        { status: 404 },
      );
    }
    targetEventIds = [eventIdInput];
  } else {
    // client_id path: load all events for the client owned by the user.
    const { data: evRows, error: evErr } = await userClient
      .from("events")
      .select("id")
      .eq("client_id", clientIdInput!);
    if (evErr) {
      return NextResponse.json({ ok: false, error: evErr.message }, { status: 500 });
    }
    targetEventIds = (evRows ?? []).map((r: { id: string }) => r.id);
    if (targetEventIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No events found for that client" },
        { status: 404 },
      );
    }
  }

  const results: EventResult[] = [];

  for (const eventId of targetEventIds) {
    // Fetch event timezone.
    const { data: eventRow } = await serviceSupabase
      .from("events")
      .select("event_timezone, user_id")
      .eq("id", eventId)
      .maybeSingle();

    const eventTimezone =
      typeof (eventRow as { event_timezone?: string | null } | null)
        ?.event_timezone === "string"
        ? (eventRow as { event_timezone: string }).event_timezone
        : null;

    const ownerUserId =
      typeof (eventRow as { user_id?: string } | null)?.user_id === "string"
        ? (eventRow as { user_id: string }).user_id
        : user.id;

    const links = await listLinksForEvent(serviceSupabase, eventId);
    const linkResults: LinkResult[] = [];

    for (const link of links) {
      const connection = await getConnectionWithDecryptedCredentials(
        serviceSupabase,
        link.connection_id,
      );
      if (!connection) {
        linkResults.push({
          linkId: link.id,
          externalEventId: link.external_event_id,
          provider: "unknown",
          rowsUpserted: 0,
          error: "Connection not found",
        });
        continue;
      }

      const result = await processLink(
        serviceSupabase,
        link,
        connection,
        eventId,
        ownerUserId,
        eventTimezone,
        from,
        to,
      );
      linkResults.push(result);
    }

    results.push({ eventId, linksProcessed: linkResults });
  }

  const totalRows = results
    .flatMap((e) => e.linksProcessed)
    .reduce((s, l) => s + l.rowsUpserted, 0);
  const errors = results
    .flatMap((e) => e.linksProcessed)
    .filter((l) => l.error);

  return NextResponse.json({
    ok: errors.length === 0,
    window: { from, to },
    eventsProcessed: results.length,
    totalRowsUpserted: totalRows,
    ...(errors.length > 0 && { errors: errors.map((l) => `${l.linkId}: ${l.error}`) }),
    results,
  });
}
