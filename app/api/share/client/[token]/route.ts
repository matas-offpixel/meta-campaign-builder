import { NextResponse, type NextRequest } from "next/server";

import {
  bumpShareView,
  resolveShareByToken,
} from "@/lib/db/report-shares";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Public GET — resolve a client-scoped share token, return the client
 * row + every event under that client + each event's most recent
 * weekly snapshot (tickets_sold).
 *
 * Used by the public portal at `/share/client/[token]`. No
 * authenticated session: the route validates the token via the
 * service-role client (bypassing RLS), then runs all reads through
 * that same admin client. Token MUST be `scope='client'` and
 * enabled — `scope='event'` tokens are rejected as "not found"
 * to keep the failure surface uniform.
 *
 * Cache: never. The portal is read after every save back from the
 * sibling tickets POST so stale snapshots would be confusing.
 */

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length > 64) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    );
  }

  const admin = createServiceRoleClient();
  const resolved = await resolveShareByToken(token, admin);
  if (!resolved.ok || resolved.share.scope !== "client") {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    );
  }
  const share = resolved.share;
  if (!share.client_id) {
    // scope='client' invariant from migration 014's check constraint —
    // defensive null guard keeps TS happy and the failure mode loud
    // if a row somehow lands without the FK.
    return NextResponse.json(
      { ok: false, error: "Share missing client_id" },
      { status: 500 },
    );
  }

  // Fire and forget — counter increment must not block the page render.
  void bumpShareView(token, admin);

  const { data: client, error: clientErr } = await admin
    .from("clients")
    .select("id, name, slug, primary_type")
    .eq("id", share.client_id)
    .maybeSingle();
  if (clientErr || !client) {
    return NextResponse.json(
      { ok: false, error: "Client not found" },
      { status: 404 },
    );
  }

  const { data: events, error: eventsErr } = await admin
    .from("events")
    .select(
      "id, name, slug, event_code, venue_name, venue_city, venue_country, capacity, event_date, budget_marketing, tickets_sold",
    )
    .eq("client_id", share.client_id)
    .order("event_date", { ascending: true, nullsFirst: false });

  if (eventsErr) {
    return NextResponse.json(
      { ok: false, error: eventsErr.message },
      { status: 500 },
    );
  }

  const eventRows = events ?? [];
  const eventIds = eventRows.map((e) => e.id);

  // Pull every snapshot for these events ordered DESC, then reduce to
  // the most-recent per event. One round-trip beats N+1 reads.
  let snapshotsByEvent = new Map<
    string,
    {
      tickets_sold: number | null;
      captured_at: string;
      week_start: string;
    }
  >();
  if (eventIds.length > 0) {
    const { data: snapshots, error: snapErr } = await admin
      .from("client_report_weekly_snapshots")
      .select("event_id, tickets_sold, captured_at, week_start")
      .in("event_id", eventIds)
      .order("captured_at", { ascending: false });
    if (snapErr) {
      return NextResponse.json(
        { ok: false, error: snapErr.message },
        { status: 500 },
      );
    }
    for (const row of snapshots ?? []) {
      const eventId = row.event_id as string;
      if (snapshotsByEvent.has(eventId)) continue;
      snapshotsByEvent.set(eventId, {
        tickets_sold: row.tickets_sold,
        captured_at: row.captured_at,
        week_start: row.week_start,
      });
    }
  }

  // Per-event recent history (last 5 entries) for the collapsible
  // history panel in the portal. Same single round-trip strategy.
  const historyByEvent = new Map<
    string,
    Array<{
      tickets_sold: number | null;
      captured_at: string;
      week_start: string;
    }>
  >();
  if (eventIds.length > 0) {
    const { data: history } = await admin
      .from("client_report_weekly_snapshots")
      .select("event_id, tickets_sold, captured_at, week_start")
      .in("event_id", eventIds)
      .order("captured_at", { ascending: false });
    for (const row of history ?? []) {
      const eventId = row.event_id as string;
      const list = historyByEvent.get(eventId) ?? [];
      if (list.length >= 5) continue;
      list.push({
        tickets_sold: row.tickets_sold,
        captured_at: row.captured_at,
        week_start: row.week_start,
      });
      historyByEvent.set(eventId, list);
    }
  }

  return NextResponse.json({
    ok: true,
    client,
    events: eventRows.map((e) => ({
      ...e,
      latest_snapshot: snapshotsByEvent.get(e.id) ?? null,
      history: historyByEvent.get(e.id) ?? [],
    })),
  });
}
