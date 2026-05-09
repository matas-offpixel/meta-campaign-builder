import { NextResponse, type NextRequest } from "next/server";

import { upsertDailyHistory } from "@/lib/db/tier-channel-daily-history";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/cron/snapshot-tier-channel-sales-daily
 *
 * Nightly cron (23:55 UTC ≈ midnight London). For every event that has
 * had a `tier_channel_sales` row updated in the last 48 h, captures the
 * current SUM(tickets_sold) and SUM(revenue_amount) as a daily snapshot
 * in `tier_channel_sales_daily_history` for today (Europe/London date).
 *
 * This creates the forward-going history that resolves the "all tickets
 * land on today" spike that occurred before migration 089.
 *
 * Idempotent: ON CONFLICT(event_id, snapshot_date) DO UPDATE so running
 * twice on the same day just refreshes the totals.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (same as every other cron).
 */

export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

function todayInLondon(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const snapshotDate = todayInLondon();
  const supabase = await createServiceRoleClient();

  // Find events with tier_channel_sales rows updated in the last 48 h.
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: recentSales, error: salesErr } = await supabase
    .from("tier_channel_sales")
    .select("event_id, tickets_sold, revenue_amount")
    .gte("updated_at", since);

  if (salesErr) {
    return NextResponse.json(
      { ok: false, error: salesErr.message, startedAt },
      { status: 500 },
    );
  }

  // Aggregate SUM per event across all rows (tiers × channels).
  const byEvent = new Map<string, { tickets: number; revenue: number }>();
  for (const row of recentSales ?? []) {
    const eid = String(row.event_id);
    const cur = byEvent.get(eid) ?? { tickets: 0, revenue: 0 };
    cur.tickets += Number(row.tickets_sold ?? 0);
    cur.revenue += Number(row.revenue_amount ?? 0);
    byEvent.set(eid, cur);
  }

  if (byEvent.size === 0) {
    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      snapshotDate,
      eventsConsidered: 0,
      snapshotsWritten: 0,
    });
  }

  // For each distinct event, we need the FULL SUM (not just recently-
  // updated rows) to get the cumulative total. Fetch all rows for these
  // events to build the accurate SUM.
  const eventIds = [...byEvent.keys()];
  const { data: allSales, error: allErr } = await supabase
    .from("tier_channel_sales")
    .select("event_id, tickets_sold, revenue_amount")
    .in("event_id", eventIds);

  if (allErr) {
    return NextResponse.json(
      { ok: false, error: allErr.message, startedAt },
      { status: 500 },
    );
  }

  // Recompute accurate cumulative totals from the full set.
  const fullTotals = new Map<string, { tickets: number; revenue: number }>();
  for (const row of allSales ?? []) {
    const eid = String(row.event_id);
    const cur = fullTotals.get(eid) ?? { tickets: 0, revenue: 0 };
    cur.tickets += Number(row.tickets_sold ?? 0);
    cur.revenue += Number(row.revenue_amount ?? 0);
    fullTotals.set(eid, cur);
  }

  let written = 0;
  const errors: { eventId: string; message: string }[] = [];

  for (const [eventId, totals] of fullTotals) {
    try {
      await upsertDailyHistory(supabase, {
        event_id: eventId,
        snapshot_date: snapshotDate,
        tickets_sold_total: totals.tickets,
        revenue_total: totals.revenue,
        source_kind: "cron",
      });
      written++;
    } catch (err) {
      errors.push({
        eventId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    startedAt,
    finishedAt: new Date().toISOString(),
    snapshotDate,
    eventsConsidered: fullTotals.size,
    snapshotsWritten: written,
    errors: errors.length > 0 ? errors : undefined,
  });
}
