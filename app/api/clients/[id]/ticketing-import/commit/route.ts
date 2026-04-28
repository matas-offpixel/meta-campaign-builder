/**
 * POST /api/clients/[id]/ticketing-import/commit
 *
 * Stage 2 of the weekly-ticket-tracker xlsx importer. Takes the
 * operator-confirmed list of `(eventId, snapshotAt, ticketsSold)`
 * rows from the preview and upserts them into
 * `ticket_sales_snapshots` with `source='xlsx_import'` and
 * `connection_id=NULL`.
 *
 * Idempotency: the unique index on (event_id, snapshot_at, source)
 * (migration 049) makes re-running the same commit a no-op — the
 * upsert hits `ON CONFLICT DO UPDATE` and overwrites `tickets_sold`
 * with the same value. Re-running with a CORRECTED spreadsheet
 * (e.g. a late revision from the client) rewrites the numbers
 * in place rather than stacking duplicates.
 *
 * Safety posture:
 *   - Every row must carry an `eventId` the caller actually owns.
 *     We load the client's events list, build a permitted-id set,
 *     and reject the whole request if any submitted id is outside
 *     that set (400 with the offending id so the UI can highlight).
 *   - `snapshotAt` must match the date format the preview emitted
 *     (YYYY-MM-DD). No server-side recomputation — the preview is
 *     the source of truth.
 *
 * Runtime: nodejs so Buffer-based JSON parsing of big payloads
 * works. The route itself accepts plain JSON; the xlsx parse is
 * already done in Stage 1.
 */

export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

interface CommitRow {
  eventId: string;
  snapshotAt: string;
  ticketsSold: number;
}

interface CommitRequest {
  rows?: CommitRow[];
}

export interface CommitResponse {
  ok: true;
  rowsAttempted: number;
  rowsWritten: number;
  rowsSkipped: number;
  skipped: Array<{ row: CommitRow; reason: string }>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) {
    return NextResponse.json(
      { ok: false, error: clientErr.message },
      { status: 500 },
    );
  }
  if (!client) {
    return NextResponse.json({ ok: false, error: "Client not found" }, { status: 404 });
  }
  if (client.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Body ─────────────────────────────────────────────────────────────
  let body: CommitRequest;
  try {
    body = (await req.json()) as CommitRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No rows submitted" },
      { status: 400 },
    );
  }

  // ── Permitted event set ──────────────────────────────────────────────
  const { data: eventsData, error: eventsErr } = await supabase
    .from("events")
    .select("id, user_id")
    .eq("client_id", clientId);
  if (eventsErr) {
    return NextResponse.json(
      { ok: false, error: eventsErr.message },
      { status: 500 },
    );
  }
  const permitted = new Map<string, string>();
  for (const e of eventsData ?? []) {
    permitted.set(e.id, e.user_id);
  }

  // ── Validate + shape payload ─────────────────────────────────────────
  const skipped: CommitResponse["skipped"] = [];
  type InsertRow = {
    user_id: string;
    event_id: string;
    snapshot_at: string;
    tickets_sold: number;
    source: "xlsx_import";
    connection_id: null;
  };
  const toWrite: InsertRow[] = [];

  for (const r of rows) {
    if (!r || typeof r !== "object") {
      skipped.push({ row: r, reason: "malformed row" });
      continue;
    }
    if (!UUID_RE.test(String(r.eventId ?? ""))) {
      skipped.push({ row: r, reason: "invalid eventId" });
      continue;
    }
    const ownerUserId = permitted.get(r.eventId);
    if (!ownerUserId) {
      skipped.push({
        row: r,
        reason: "event not owned by this client",
      });
      continue;
    }
    if (!ISO_DATE_RE.test(String(r.snapshotAt ?? ""))) {
      skipped.push({ row: r, reason: "invalid snapshotAt (expect YYYY-MM-DD)" });
      continue;
    }
    const n = Number(r.ticketsSold);
    if (!Number.isFinite(n) || n < 0) {
      skipped.push({ row: r, reason: "non-negative number required for ticketsSold" });
      continue;
    }
    // snapshot_at is stored as timestamptz. Persist the week at 00:00:00
    // UTC so downstream readers (event-history-resolver) collapse
    // deterministically regardless of server timezone.
    toWrite.push({
      user_id: ownerUserId,
      event_id: r.eventId,
      snapshot_at: `${r.snapshotAt}T00:00:00.000Z`,
      tickets_sold: Math.trunc(n),
      source: "xlsx_import",
      connection_id: null,
    });
  }

  if (toWrite.length === 0) {
    const response: CommitResponse = {
      ok: true,
      rowsAttempted: rows.length,
      rowsWritten: 0,
      rowsSkipped: skipped.length,
      skipped,
    };
    return NextResponse.json(response);
  }

  // ── Upsert ───────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = supabase as any;
  const { error: upsertErr } = await admin
    .from("ticket_sales_snapshots")
    .upsert(toWrite, { onConflict: "event_id,snapshot_at,source" });
  if (upsertErr) {
    console.warn("[ticketing-import commit] upsert failed", upsertErr.message);
    return NextResponse.json(
      { ok: false, error: upsertErr.message, rowsSkipped: skipped.length, skipped },
      { status: 500 },
    );
  }

  const response: CommitResponse = {
    ok: true,
    rowsAttempted: rows.length,
    rowsWritten: toWrite.length,
    rowsSkipped: skipped.length,
    skipped,
  };
  console.log(
    `[ticketing-import commit] client=${clientId} written=${toWrite.length} skipped=${skipped.length}`,
  );
  return NextResponse.json(response);
}
