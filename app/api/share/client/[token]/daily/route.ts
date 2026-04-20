import { NextResponse, type NextRequest } from "next/server";

import { resolveShareByToken } from "@/lib/db/report-shares";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Public daily-tracker endpoint for the client portal.
 *
 * GET  — list every daily_tracking_entries row belonging to events
 *        under the share's client_id, ordered (event_id, date ASC).
 *        Read-only: no can_edit gate.
 * POST — upsert a single entry on (event_id, date). Body shape:
 *          { event_id, date, day_spend?, tickets?, revenue?,
 *            link_clicks?, notes? }
 *        Gated by share.can_edit and the cross-tenant guard (the
 *        submitted event must belong to share.client_id). All numeric
 *        fields are optional and accept null to clear.
 *
 * Auth model identical to /tickets: the token IS the credential, no
 * Supabase session, all DB I/O via the service-role client. Token
 * validation rejects scope='event' so an event-only share can't read
 * across the client.
 */

export const revalidate = 0;
export const dynamic = "force-dynamic";

interface PostBody {
  event_id?: unknown;
  date?: unknown;
  day_spend?: unknown;
  tickets?: unknown;
  revenue?: unknown;
  link_clicks?: unknown;
  notes?: unknown;
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

/**
 * Strict YYYY-MM-DD validation. Postgres' date type would coerce
 * other ISO shapes too, but pinning the API to one format keeps the
 * unique (event_id, date) index honest — `2026-04-14` and
 * `2026-04-14T00:00:00Z` would otherwise both round-trip and could
 * confuse a future client.
 */
function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

/**
 * Parse a number-or-null body field. Returns:
 *   - { ok: true, value: number | null } when valid (or omitted)
 *   - { ok: false, error } with a 400-ready message when invalid
 *
 * `nonNegative` (default true) rejects negatives because none of the
 * tracker columns (spend / tickets / revenue / link_clicks) can be
 * negative in this domain. `integer` enforces whole numbers for
 * tickets / link_clicks.
 */
function parseNumberField(
  raw: unknown,
  opts: { integer?: boolean; nonNegative?: boolean } = {},
): { ok: true; value: number | null } | { ok: false; error: string } {
  const { integer = false, nonNegative = true } = opts;
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { ok: false, error: "must be a finite number" };
  }
  if (nonNegative && raw < 0) {
    return { ok: false, error: "must be ≥ 0" };
  }
  if (integer && !Number.isInteger(raw)) {
    return { ok: false, error: "must be an integer" };
  }
  return { ok: true, value: raw };
}

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
    return NextResponse.json(
      { ok: false, error: "Share missing client_id" },
      { status: 500 },
    );
  }

  const { data, error } = await admin
    .from("daily_tracking_entries")
    .select("id, event_id, date, day_spend, tickets, revenue, link_clicks, notes")
    .eq("client_id", share.client_id)
    .order("event_id", { ascending: true })
    .order("date", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, entries: data ?? [] });
}

export async function POST(
  req: NextRequest,
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
  if (!share.can_edit) {
    return NextResponse.json(
      { ok: false, error: "Read-only share" },
      { status: 403 },
    );
  }
  if (!share.client_id) {
    return NextResponse.json(
      { ok: false, error: "Share missing client_id" },
      { status: 500 },
    );
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  if (!isUuid(body.event_id)) {
    return NextResponse.json(
      { ok: false, error: "event_id must be a uuid" },
      { status: 400 },
    );
  }
  if (!isIsoDate(body.date)) {
    return NextResponse.json(
      { ok: false, error: "date must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const daySpend = parseNumberField(body.day_spend);
  if (!daySpend.ok) {
    return NextResponse.json(
      { ok: false, error: `day_spend ${daySpend.error}` },
      { status: 400 },
    );
  }
  const tickets = parseNumberField(body.tickets, { integer: true });
  if (!tickets.ok) {
    return NextResponse.json(
      { ok: false, error: `tickets ${tickets.error}` },
      { status: 400 },
    );
  }
  const revenue = parseNumberField(body.revenue);
  if (!revenue.ok) {
    return NextResponse.json(
      { ok: false, error: `revenue ${revenue.error}` },
      { status: 400 },
    );
  }
  const linkClicks = parseNumberField(body.link_clicks, { integer: true });
  if (!linkClicks.ok) {
    return NextResponse.json(
      { ok: false, error: `link_clicks ${linkClicks.error}` },
      { status: 400 },
    );
  }

  // Notes: optional free-text. Cap length defensively so a runaway
  // paste doesn't blow the row size (Postgres text is unbounded but
  // we render this in a table cell — anything beyond a few hundred
  // chars is almost certainly accidental).
  let notes: string | null = null;
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== "string") {
      return NextResponse.json(
        { ok: false, error: "notes must be a string" },
        { status: 400 },
      );
    }
    const trimmed = body.notes.trim();
    if (trimmed.length > 1000) {
      return NextResponse.json(
        { ok: false, error: "notes must be ≤ 1000 chars" },
        { status: 400 },
      );
    }
    notes = trimmed === "" ? null : trimmed;
  }

  const eventId = body.event_id;
  const date = body.date;

  // Cross-tenant guard: the submitted event must belong to the same
  // client this token authorises.
  const { data: event, error: evErr } = await admin
    .from("events")
    .select("id, client_id")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr || !event) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }
  if (event.client_id !== share.client_id) {
    return NextResponse.json(
      { ok: false, error: "Event does not belong to this client" },
      { status: 403 },
    );
  }

  const nowIso = new Date().toISOString();

  const { data: upserted, error: upsertErr } = await admin
    .from("daily_tracking_entries")
    .upsert(
      {
        user_id: share.user_id,
        client_id: share.client_id,
        event_id: eventId,
        date,
        day_spend: daySpend.value,
        tickets: tickets.value,
        revenue: revenue.value,
        link_clicks: linkClicks.value,
        notes,
        updated_at: nowIso,
      },
      { onConflict: "event_id,date" },
    )
    .select("id, event_id, date, day_spend, tickets, revenue, link_clicks, notes")
    .maybeSingle();

  if (upsertErr || !upserted) {
    return NextResponse.json(
      {
        ok: false,
        error: upsertErr?.message ?? "Failed to upsert tracking entry",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, entry: upserted });
}
