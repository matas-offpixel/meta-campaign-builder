import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  updateRollupNotes,
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
 *   Updates the `notes` field on a single (event, date) row. Body:
 *   `{ notes: string | null }`. 404 when the row doesn't exist (run
 *   the sync first); 400 when body shape is wrong.
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

// `computePresaleBucket` lives in `lib/db/event-daily-timeline.ts`
// alongside the unified-timeline merge — both endpoints (this route +
// the public share page) import it from there so the math is defined
// in exactly one place.
