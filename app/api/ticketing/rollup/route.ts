import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  listRollupsForEvent,
  updateRollupNotes,
  type EventDailyRollup,
} from "@/lib/db/event-daily-rollups";

/**
 * GET  /api/ticketing/rollup?eventId=X
 *   Returns every rollup row for the event sorted date-desc, plus a
 *   computed "Presale" bucket (sum of all rows whose date is strictly
 *   before `events.general_sale_at::date`). Presale is computed
 *   server-side so the client doesn't need to know the cutoff
 *   semantics — it just renders the bucket when it's non-null.
 *
 * PATCH /api/ticketing/rollup?eventId=X&date=YYYY-MM-DD
 *   Updates the `notes` field on a single (event, date) row. Body:
 *   `{ notes: string | null }`. 404 when the row doesn't exist (run
 *   the sync first); 400 when body shape is wrong.
 */

export interface PresaleBucket {
  /** ISO date (general_sale_at) — the cutoff used to compute the bucket. */
  cutoffDate: string;
  ad_spend: number | null;
  link_clicks: number | null;
  tickets_sold: number | null;
  revenue: number | null;
  /** Number of rollup rows folded into the bucket. */
  daysCount: number;
  /** Earliest date covered by the bucket (for the "from" label). */
  earliestDate: string | null;
}

interface GetResponse {
  ok: true;
  rows: EventDailyRollup[];
  presale: PresaleBucket | null;
  generalSaleAt: string | null;
}

export async function GET(req: NextRequest) {
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

  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "eventId is required" },
      { status: 400 },
    );
  }

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, user_id, general_sale_at")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
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

  const rows = await listRollupsForEvent(supabase, eventId);
  const generalSaleAt = (event.general_sale_at as string | null) ?? null;
  const presale = computePresaleBucket(rows, generalSaleAt);

  const body: GetResponse = { ok: true, rows, presale, generalSaleAt };
  return NextResponse.json(body, { status: 200 });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(req: NextRequest) {
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

  const eventId = req.nextUrl.searchParams.get("eventId");
  const date = req.nextUrl.searchParams.get("date");
  if (!eventId || !date) {
    return NextResponse.json(
      { ok: false, error: "eventId and date query params are required" },
      { status: 400 },
    );
  }
  if (!DATE_RE.test(date)) {
    return NextResponse.json(
      { ok: false, error: "date must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be valid JSON" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Body must be an object" },
      { status: 400 },
    );
  }
  const notesRaw = (body as { notes?: unknown }).notes;
  if (notesRaw !== null && typeof notesRaw !== "string") {
    return NextResponse.json(
      { ok: false, error: "notes must be a string or null" },
      { status: 400 },
    );
  }
  // Trim + normalise empty -> null so the DB doesn't carry " " forever.
  const notes =
    notesRaw === null
      ? null
      : notesRaw.trim() === ""
        ? null
        : notesRaw.trim();

  // Ownership check — RLS would also block but we 404/403 explicitly
  // for nicer UX in the dev console.
  const { data: event } = await supabase
    .from("events")
    .select("id, user_id")
    .eq("id", eventId)
    .maybeSingle();
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

  try {
    const updated = await updateRollupNotes(supabase, {
      eventId,
      date,
      notes,
    });
    if (!updated) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No rollup row for that date yet — run a sync first, then add notes.",
        },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, row: updated });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * Roll up every row strictly before `general_sale_at::date` into a
 * single Presale bucket. Returns null when general_sale_at isn't set
 * (caller renders the table flat) or when no rows fall in the bucket.
 */
function computePresaleBucket(
  rows: EventDailyRollup[],
  generalSaleAt: string | null,
): PresaleBucket | null {
  if (!generalSaleAt) return null;
  // general_sale_at is a timestamptz; strip to date in the UTC form
  // Postgres gives us. Comparing date strings lexicographically is
  // safe for canonical YYYY-MM-DD.
  const cutoffDate = generalSaleAt.slice(0, 10);
  const presaleRows = rows.filter((r) => r.date < cutoffDate);
  if (presaleRows.length === 0) return null;

  let ad_spend: number | null = null;
  let link_clicks: number | null = null;
  let tickets_sold: number | null = null;
  let revenue: number | null = null;
  let earliestDate: string | null = null;

  for (const r of presaleRows) {
    if (r.ad_spend != null) ad_spend = (ad_spend ?? 0) + Number(r.ad_spend);
    if (r.link_clicks != null) link_clicks = (link_clicks ?? 0) + r.link_clicks;
    if (r.tickets_sold != null)
      tickets_sold = (tickets_sold ?? 0) + r.tickets_sold;
    if (r.revenue != null) revenue = (revenue ?? 0) + Number(r.revenue);
    if (!earliestDate || r.date < earliestDate) earliestDate = r.date;
  }

  return {
    cutoffDate,
    ad_spend: ad_spend != null ? round2(ad_spend) : null,
    link_clicks,
    tickets_sold,
    revenue: revenue != null ? round2(revenue) : null,
    daysCount: presaleRows.length,
    earliestDate,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
