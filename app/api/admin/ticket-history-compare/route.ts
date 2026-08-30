/**
 * GET /api/admin/ticket-history-compare
 *
 * One-off validation route: compares the cumulative-diff approach
 * (ticket_sales_snapshots) against the true per-day approach
 * (event_daily_ticket_history) for a given event and date range.
 *
 * Query params:
 *   event_id  string  — required, internal event UUID
 *   from      string  — YYYY-MM-DD (default: 30 days ago)
 *   to        string  — YYYY-MM-DD (default: today)
 *
 * Response shape:
 * {
 *   "from_snapshots_cumulative_diff": [{date, tickets}],
 *   "from_event_daily_ticket_history": [{date, tickets, source}],
 *   "delta_per_day": [{date, snapshot_diff, true_history, drift}]
 * }
 *
 * "drift" is the signed difference (true_history − snapshot_diff).
 * Positive means snapshots under-counted; negative means over-counted.
 * null in either column means data was only present in the other source.
 *
 * Auth: must be signed in; event must be owned by the user.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  getDailyTicketHistoryForEvent,
  bestDailyTicketsForEvent,
} from "@/lib/db/ticket-history";

export const dynamic = "force-dynamic";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function nDaysAgoYmd(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

interface SnapshotRow {
  snapshot_at: string;
  tickets_sold: number;
}

function buildSnapshotCumulativeDiff(
  snapshots: SnapshotRow[],
  from: string,
  to: string,
): Array<{ date: string; tickets: number }> {
  if (snapshots.length === 0) return [];

  // Take the latest snapshot per calendar day (UTC slice).
  const latestPerDay = new Map<string, number>();
  for (const s of snapshots) {
    const day = s.snapshot_at.slice(0, 10);
    const existing = latestPerDay.get(day) ?? -Infinity;
    if (s.tickets_sold > existing) {
      latestPerDay.set(day, s.tickets_sold);
    }
  }

  // Sorted days within the window.
  const days = [...latestPerDay.keys()]
    .filter((d) => d >= from && d <= to)
    .sort();

  if (days.length === 0) return [];

  // Cumulative diff: Δtickets = tickets_today − tickets_yesterday.
  const result: Array<{ date: string; tickets: number }> = [];
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    const cumToday = latestPerDay.get(day) ?? 0;
    const cumYesterday = i > 0 ? (latestPerDay.get(days[i - 1]!) ?? 0) : 0;
    result.push({ date: day, tickets: Math.max(0, cumToday - cumYesterday) });
  }
  return result;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const eventId = searchParams.get("event_id")?.trim() ?? "";
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "event_id is required" },
      { status: 400 },
    );
  }

  const fromParam = searchParams.get("from")?.trim();
  const toParam = searchParams.get("to")?.trim();
  const from =
    fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)
      ? fromParam
      : nDaysAgoYmd(30);
  const to =
    toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam)
      ? toParam
      : todayYmd();

  // Auth check.
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  // Ownership check via user-scoped RLS.
  const { data: ev } = await userClient
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) {
    return NextResponse.json(
      { ok: false, error: "Event not found or not owned by you" },
      { status: 404 },
    );
  }

  const serviceSupabase = createServiceRoleClient();

  // ── 1. Snapshots side ──────────────────────────────────────────────────────
  // Pull all snapshots in the window, ordered by snapshot_at ASC.
  const { data: rawSnapshots, error: snapErr } = await serviceSupabase
    .from("ticket_sales_snapshots")
    .select("snapshot_at, tickets_sold")
    .eq("event_id", eventId)
    .gte("snapshot_at", `${from}T00:00:00Z`)
    .lte("snapshot_at", `${to}T23:59:59Z`)
    .order("snapshot_at", { ascending: true });

  if (snapErr) {
    return NextResponse.json({ ok: false, error: snapErr.message }, { status: 500 });
  }

  const snapshotRows = (rawSnapshots ?? []) as SnapshotRow[];
  const fromSnapshotsCumulativeDiff = buildSnapshotCumulativeDiff(
    snapshotRows,
    from,
    to,
  );

  // ── 2. True history side ───────────────────────────────────────────────────
  const allHistoryRows = await getDailyTicketHistoryForEvent(
    serviceSupabase,
    eventId,
    from,
    to,
  );
  const bestHistory = await bestDailyTicketsForEvent(
    serviceSupabase,
    eventId,
    from,
    to,
  );

  const fromEventDailyTicketHistory = allHistoryRows.map((r) => ({
    date: r.date,
    tickets: r.tickets_sold,
    source: r.source,
  }));

  // ── 3. Delta per day ──────────────────────────────────────────────────────
  const snapshotByDay = new Map(fromSnapshotsCumulativeDiff.map((r) => [r.date, r.tickets]));
  const historyByDay = new Map(bestHistory.map((r) => [r.date, r.tickets_sold]));

  // Union of all dates from both sources.
  const allDates = new Set([
    ...snapshotByDay.keys(),
    ...historyByDay.keys(),
  ]);

  const deltaPerDay = [...allDates]
    .sort()
    .map((date) => {
      const snapshotDiff = snapshotByDay.has(date) ? snapshotByDay.get(date)! : null;
      const trueHistory = historyByDay.has(date) ? historyByDay.get(date)! : null;
      const drift =
        trueHistory !== null && snapshotDiff !== null
          ? trueHistory - snapshotDiff
          : null;
      return { date, snapshot_diff: snapshotDiff, true_history: trueHistory, drift };
    });

  return NextResponse.json({
    ok: true,
    event_id: eventId,
    window: { from, to },
    from_snapshots_cumulative_diff: fromSnapshotsCumulativeDiff,
    from_event_daily_ticket_history: fromEventDailyTicketHistory,
    delta_per_day: deltaPerDay,
  });
}
