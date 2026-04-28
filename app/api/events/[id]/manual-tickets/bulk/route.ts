/**
 * POST /api/events/[id]/manual-tickets/bulk
 *
 * Bulk-writes operator-entered cumulative ticket counts for an event
 * into `ticket_sales_snapshots` with `source='manual'`. Powers the
 * `/events/[id]/manual-tickets` grid (PR 3 of the overnight bundle):
 * the operator pastes or types in the last 30 days of cumulative
 * counts and hits Save; this route upserts them in one shot.
 *
 * Idempotency: the unique index on (event_id, snapshot_at, source)
 * added in migration 049 makes re-saves a no-op — the operator can
 * edit a cell and re-submit without stacking duplicate rows.
 *
 * Connection discovery: the route looks up the event's manual
 * connection (provider='manual' on `client_ticketing_connections`).
 * If none exists yet, we create one implicitly so the operator
 * doesn't have to click "Add manual connection" first. The event's
 * client_id owns the connection.
 *
 * Auth: cookie-bound session + ownership check on the event row.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

interface BulkRow {
  snapshotAt: string;
  ticketsSold: number;
}

interface BulkRequest {
  rows?: BulkRow[];
}

export interface BulkResponse {
  ok: true;
  rowsAttempted: number;
  rowsWritten: number;
  connectionId: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("id, user_id, client_id")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr) {
    return NextResponse.json(
      { ok: false, error: evErr.message },
      { status: 500 },
    );
  }
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }
  if (event.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  let body: BulkRequest;
  try {
    body = (await req.json()) as BulkRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const rawRows = Array.isArray(body.rows) ? body.rows : null;
  if (!rawRows) {
    return NextResponse.json(
      { ok: false, error: "rows must be an array" },
      { status: 400 },
    );
  }

  // Validate + normalise every row before any DB write so a single
  // bad cell rejects the whole submission — the UI can highlight the
  // offending row rather than the operator learning about it only
  // after half the grid has been persisted.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const cleaned: BulkRow[] = [];
  for (const r of rawRows) {
    if (!r || typeof r !== "object") {
      return NextResponse.json(
        { ok: false, error: "Each row must be an object" },
        { status: 400 },
      );
    }
    if (typeof r.snapshotAt !== "string" || !DATE_RE.test(r.snapshotAt)) {
      return NextResponse.json(
        { ok: false, error: `snapshotAt must be YYYY-MM-DD (got ${r.snapshotAt})` },
        { status: 400 },
      );
    }
    if (typeof r.ticketsSold !== "number" || !Number.isFinite(r.ticketsSold) || r.ticketsSold < 0) {
      return NextResponse.json(
        { ok: false, error: `ticketsSold must be a non-negative number (row ${r.snapshotAt})` },
        { status: 400 },
      );
    }
    cleaned.push({
      snapshotAt: r.snapshotAt,
      ticketsSold: Math.trunc(r.ticketsSold),
    });
  }

  // Get-or-create the manual connection for this client. Creating it
  // on-demand means the operator doesn't need a separate "set up
  // manual provider" step before bulk-entry works — the first
  // /manual-tickets save is the moment the connection lives.
  //
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any;
  const { data: existing } = await sbAny
    .from("client_ticketing_connections")
    .select("id")
    .eq("client_id", event.client_id)
    .eq("provider", "manual")
    .eq("user_id", user.id)
    .maybeSingle();

  let connectionId: string;
  if (existing && existing.id) {
    connectionId = existing.id as string;
  } else {
    const { data: created, error: createErr } = await sbAny
      .from("client_ticketing_connections")
      .insert({
        user_id: user.id,
        client_id: event.client_id,
        provider: "manual",
        credentials: {},
        external_account_id: null,
        status: "active",
      })
      .select("id")
      .maybeSingle();
    if (createErr || !created) {
      return NextResponse.json(
        {
          ok: false,
          error: createErr?.message ?? "Failed to create manual connection",
        },
        { status: 500 },
      );
    }
    connectionId = created.id as string;
  }

  if (cleaned.length === 0) {
    const response: BulkResponse = {
      ok: true,
      rowsAttempted: 0,
      rowsWritten: 0,
      connectionId,
    };
    return NextResponse.json(response);
  }

  // Upsert on (event_id, snapshot_at, source) — the unique index from
  // migration 049. Manual rows carry `source='manual'` and the
  // connection_id of the manual connection (for attribution /
  // cleanup; the snapshot itself doesn't need it to be rendered).
  const rows = cleaned.map((r) => ({
    user_id: user.id,
    event_id: eventId,
    connection_id: connectionId,
    snapshot_at: r.snapshotAt,
    tickets_sold: r.ticketsSold,
    tickets_available: null,
    gross_revenue_cents: null,
    currency: null,
    raw_payload: { source: "manual", entered_by: user.id },
    source: "manual",
  }));

  const { error: upsertErr, count } = await sbAny
    .from("ticket_sales_snapshots")
    .upsert(rows, {
      onConflict: "event_id,snapshot_at,source",
      count: "exact",
    });
  if (upsertErr) {
    return NextResponse.json(
      { ok: false, error: upsertErr.message },
      { status: 500 },
    );
  }

  const response: BulkResponse = {
    ok: true,
    rowsAttempted: cleaned.length,
    rowsWritten: typeof count === "number" ? count : cleaned.length,
    connectionId,
  };
  return NextResponse.json(response);
}
