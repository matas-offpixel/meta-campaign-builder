import { NextResponse, type NextRequest } from "next/server";

import { resolveShareByToken } from "@/lib/db/report-shares";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Public POST — capture a tickets-sold value for an event under the
 * client this share token resolves to.
 *
 * Authentication is the token itself: no Supabase session, no cookie.
 * Authorisation:
 *   - Token must be `scope='client'` OR `scope='venue'` and `enabled`
 *     (resolveShareByToken). Event-scope tokens are rejected — the
 *     per-event share surface is `/share/report/[token]`, not the
 *     portal.
 *   - Token must have `can_edit=true`.
 *   - Submitted event_id must belong to the same client as the token.
 *   - For `scope='venue'` tokens, the submitted event must ALSO
 *     carry the venue's pinned event_code — so a venue token minted
 *     for Brighton can't be used to overwrite Manchester snapshots.
 *
 * Storage: upserts into client_report_weekly_snapshots keyed on
 * (event_id, week_start) — one snapshot per event per Mon-Sun week.
 * Re-saving in the same week overwrites; saves in a new week create
 * a fresh row so the history view (last 5 entries) keeps growing.
 *
 * captured_by is hard-coded 'client' so analytics can distinguish
 * portal self-reports from internal team captures.
 */

interface PostBody {
  event_id?: unknown;
  tickets_sold?: unknown;
  /**
   * Optional gross revenue for the snapshot week. Persisted to
   * `client_report_weekly_snapshots.revenue`. Omitted / null leaves the
   * column at null (the portal renders "—" in that case).
   */
  revenue?: unknown;
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

/**
 * Monday of the current UTC week as a date-only string (YYYY-MM-DD).
 *
 * UTC anchoring is intentional: clients in different timezones must
 * land on the same week_start so the unique constraint doesn't double
 * up rows. The portal copy says "this week" without timezone
 * specifics, which matches the way the dashboard reads back.
 */
function mondayOfThisWeekUtc(): string {
  const now = new Date();
  const utc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // getUTCDay: 0 = Sun … 6 = Sat. Distance back to Mon is (day + 6) % 7.
  const dayOfWeek = utc.getUTCDay();
  const offset = (dayOfWeek + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - offset);
  return utc.toISOString().slice(0, 10);
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
  if (
    !resolved.ok ||
    (resolved.share.scope !== "client" && resolved.share.scope !== "venue")
  ) {
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
  const ticketsRaw = body.tickets_sold;
  if (
    typeof ticketsRaw !== "number" ||
    !Number.isFinite(ticketsRaw) ||
    ticketsRaw < 0 ||
    !Number.isInteger(ticketsRaw)
  ) {
    return NextResponse.json(
      { ok: false, error: "tickets_sold must be a non-negative integer" },
      { status: 400 },
    );
  }
  const eventId = body.event_id;
  const ticketsSold = ticketsRaw;

  // Revenue is optional. Accept null/undefined as "no change requested"
  // (we still write null so the snapshot row carries through). Reject
  // negatives and non-finite numbers; allow decimals (gross takings
  // aren't always whole pounds).
  const revenueRaw = body.revenue;
  let revenue: number | null = null;
  if (revenueRaw !== undefined && revenueRaw !== null) {
    if (
      typeof revenueRaw !== "number" ||
      !Number.isFinite(revenueRaw) ||
      revenueRaw < 0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "revenue must be a non-negative number when provided",
        },
        { status: 400 },
      );
    }
    revenue = revenueRaw;
  }

  // Cross-tenant guard: the submitted event must belong to the same
  // client this token authorises. Without this, a token holder could
  // POST any event_id they could guess.
  //
  // Venue-scope tokens tighten the guard further — the event must ALSO
  // carry the pinned event_code so a Brighton venue token can't reach
  // into Manchester snapshots. We select `event_code` unconditionally
  // since it's free on the row fetch.
  const { data: event, error: evErr } = await admin
    .from("events")
    .select("id, client_id, event_code")
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
  if (share.scope === "venue" && event.event_code !== share.event_code) {
    return NextResponse.json(
      { ok: false, error: "Event does not belong to this venue" },
      { status: 403 },
    );
  }

  const weekStart = mondayOfThisWeekUtc();
  const nowIso = new Date().toISOString();

  const { data: upserted, error: upsertErr } = await admin
    .from("client_report_weekly_snapshots")
    .upsert(
      {
        user_id: share.user_id,
        client_id: share.client_id,
        event_id: eventId,
        week_start: weekStart,
        tickets_sold: ticketsSold,
        revenue,
        captured_at: nowIso,
        captured_by: "client",
        updated_at: nowIso,
      },
      { onConflict: "event_id,week_start" },
    )
    .select("id, event_id, tickets_sold, revenue, captured_at, week_start")
    .maybeSingle();

  if (upsertErr || !upserted) {
    return NextResponse.json(
      {
        ok: false,
        error: upsertErr?.message ?? "Failed to upsert snapshot",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, snapshot: upserted });
}
