import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  upsertRollupManualEntry,
  type EventDailyRollup,
} from "@/lib/db/event-daily-rollups";
import {
  computePresaleBucket,
  loadEventDailyTimeline,
  type PresaleBucket as TimelinePresaleBucket,
  type TimelineRow,
} from "@/lib/db/event-daily-timeline";

/**
 * GET  /api/ticketing/rollup?eventId=X
 *   Returns every rollup row for the event sorted date-desc, plus a
 *   computed "Presale" bucket (sum of all rows whose date is strictly
 *   before `events.general_sale_at::date`). Presale is computed
 *   server-side so the client doesn't need to know the cutoff
 *   semantics — it just renders the bucket when it's non-null.
 *
 * PATCH /api/ticketing/rollup?eventId=X&date=YYYY-MM-DD
 *   Operator-driven partial upsert of the manual-editable columns on
 *   a single (event, date) row. Body:
 *     `{ tickets_sold?: number | null, revenue?: number | null, notes?: string | null }`
 *   Each key is independent: omit to leave the column untouched,
 *   pass `null` to clear, pass a value to set. At least one key must
 *   be present.
 *
 *   Upserts via `event_daily_rollups (event_id, date)` so the
 *   operator can write a value for a date the sync hasn't reached
 *   (e.g. weekly W/C Mondays on Junction 2 / Bridge events whose
 *   ticketing data lands by email rather than via Eventbrite).
 *
 *   Never touches `ad_spend` / `link_clicks` / `source_meta_at` /
 *   `source_eventbrite_at` — those columns belong to the sync
 *   pipeline. 400 on bad body shape; 401 / 403 / 404 on auth /
 *   ownership / missing event.
 */

/**
 * Re-exported from the shared timeline helper so existing callers
 * (the dashboard's DailyTracker, the share page) all read from one
 * type definition. Keeps drift impossible.
 */
export type PresaleBucket = TimelinePresaleBucket;

interface GetResponse {
  ok: true;
  /**
   * Raw rollup rows (live, auto-synced). Kept on the response shape
   * for callers that need the rollup-only view — notably the presale
   * bucket math, which is rollup-only by design (operators don't type
   * presale entries).
   *
   * UI generally renders from `timeline` instead.
   */
  rows: EventDailyRollup[];
  /**
   * Unified per-day timeline: live rollups + manual `daily_tracking_entries`
   * merged with per-date precedence (manual wins) and tagged with a
   * `source` field the UI uses for the Manual / Live badge.
   */
  timeline: TimelineRow[];
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

  // Single round-trip pulls both legs (live rollups + manual entries)
  // and merges them into the unified timeline. `rollups` from the
  // result is reused for the presale bucket math so we don't query
  // event_daily_rollups twice.
  const { timeline, rollups } = await loadEventDailyTimeline(supabase, eventId);
  const generalSaleAt = (event.general_sale_at as string | null) ?? null;
  const presale = computePresaleBucket(rollups, generalSaleAt);

  const body: GetResponse = {
    ok: true,
    rows: rollups,
    timeline,
    presale,
    generalSaleAt,
  };
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

  // Build the partial-upsert args from whichever keys the body sets.
  // `hasOwnProperty` is the discriminator: `undefined` means "leave
  // the column alone", `null` means "clear it", a value means "set
  // it". Reads cleanly downstream because the helper inspects the
  // same predicate when deciding what to merge into the payload.
  const upsertArgs: {
    userId: string;
    eventId: string;
    date: string;
    tickets_sold?: number | null;
    revenue?: number | null;
    notes?: string | null;
  } = { userId: user.id, eventId, date };
  let touchedFields = 0;

  if (Object.prototype.hasOwnProperty.call(body, "tickets_sold")) {
    const raw = (body as { tickets_sold?: unknown }).tickets_sold;
    if (raw === null) {
      upsertArgs.tickets_sold = null;
    } else if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      // Tickets is a discrete count — round defensively so a stray
      // float from the client (e.g. an Excel paste) doesn't end up
      // in the integer-shaped column.
      upsertArgs.tickets_sold = Math.round(raw);
    } else {
      return NextResponse.json(
        {
          ok: false,
          error: "tickets_sold must be a non-negative number or null",
        },
        { status: 400 },
      );
    }
    touchedFields += 1;
  }

  if (Object.prototype.hasOwnProperty.call(body, "revenue")) {
    const raw = (body as { revenue?: unknown }).revenue;
    if (raw === null) {
      upsertArgs.revenue = null;
    } else if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      upsertArgs.revenue = raw;
    } else {
      return NextResponse.json(
        { ok: false, error: "revenue must be a non-negative number or null" },
        { status: 400 },
      );
    }
    touchedFields += 1;
  }

  if (Object.prototype.hasOwnProperty.call(body, "notes")) {
    const raw = (body as { notes?: unknown }).notes;
    if (raw === null) {
      upsertArgs.notes = null;
    } else if (typeof raw === "string") {
      // Trim + normalise empty string -> null so the DB doesn't
      // carry " " or "" forever. Matches the pre-existing notes-only
      // PATCH behaviour so the inline NotesCell legacy callers still
      // round-trip correctly.
      const trimmed = raw.trim();
      upsertArgs.notes = trimmed === "" ? null : trimmed;
    } else {
      return NextResponse.json(
        { ok: false, error: "notes must be a string or null" },
        { status: 400 },
      );
    }
    touchedFields += 1;
  }

  if (touchedFields === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Body must set at least one of tickets_sold, revenue, or notes.",
      },
      { status: 400 },
    );
  }

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
    const updated = await upsertRollupManualEntry(supabase, upsertArgs);
    return NextResponse.json({ ok: true, row: updated });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// `computePresaleBucket` lives in `lib/db/event-daily-timeline.ts`
// alongside the unified-timeline merge — both endpoints (this route +
// the public share page) import it from there so the math is defined
// in exactly one place.
