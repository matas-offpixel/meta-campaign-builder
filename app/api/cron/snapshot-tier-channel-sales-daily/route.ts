import { NextResponse, type NextRequest } from "next/server";

import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";

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

async function handleGET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const snapshotDate = todayInLondon();
  const supabase = await createServiceRoleClient();

  // EVERY event that has tier_channel_sales, not just those changed in the
  // last 48 h.
  //
  // The old filter was `updated_at >= now() - 48h`. When nothing changed —
  // a dead upstream feed, or simply a quiet two days on a static sale —
  // `byEvent.size === 0` returned `{ ok: true, snapshotsWritten: 0 }`. A
  // cron that writes nothing and reports success is indistinguishable from
  // one with nothing to do, which is how a dead leg stays dead unnoticed.
  // Daily history wants a row per event per day regardless: a flat day is
  // a fact about the sale, not an absence of data.
  //
  // Paginated: a plain `.select()` is capped at 1000 rows by PostgREST and
  // truncates silently. `tier_channel_sales` is one row per event × tier ×
  // channel, so Internal Counts (13 events × tiers × 8 outlets) takes it
  // past that cap on its own.
  const allSalesRows: { event_id: unknown; tickets_sold: unknown; revenue_amount: unknown }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("tier_channel_sales")
      .select("event_id, tickets_sold, revenue_amount")
      .range(from, from + 999);
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, startedAt },
        { status: 500 },
      );
    }
    const page = data ?? [];
    allSalesRows.push(...page);
    if (page.length < 1000) break;
  }

  // Stop at a week past the show. Without this the cron writes a daily row
  // for every archived event for ever — ~50 finished 4theFans fixtures
  // alone — and the history table grows with rows nobody reads. A week of
  // grace covers late settlement and post-show corrections.
  const staleBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const candidateIds = [...new Set(allSalesRows.map((r) => String(r.event_id)))];
  const liveEventIds = new Set<string>();
  for (let from = 0; from < candidateIds.length; from += 500) {
    const { data, error } = await supabase
      .from("events")
      .select("id, event_date")
      .in("id", candidateIds.slice(from, from + 500));
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, startedAt },
        { status: 500 },
      );
    }
    for (const row of (data ?? []) as { id: string; event_date: string | null }[]) {
      // A null event_date has no show to be past, so it stays in.
      if (!row.event_date || row.event_date >= staleBefore) liveEventIds.add(row.id);
    }
  }

  // Cumulative total per event across all tiers and channels.
  const fullTotals = new Map<string, { tickets: number; revenue: number }>();
  for (const row of allSalesRows) {
    const eid = String(row.event_id);
    if (!liveEventIds.has(eid)) continue;
    const cur = fullTotals.get(eid) ?? { tickets: 0, revenue: 0 };
    cur.tickets += Number(row.tickets_sold ?? 0);
    cur.revenue += Number(row.revenue_amount ?? 0);
    fullTotals.set(eid, cur);
  }

  if (fullTotals.size === 0) {
    // Genuinely no tier_channel_sales anywhere. Still not a silent ok:
    // say so, so "0 written" can be read as "0 to write".
    console.warn(
      `[snapshot-tier-channel-sales-daily] no tier_channel_sales rows exist at all (date=${snapshotDate})`,
    );
    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      snapshotDate,
      eventsConsidered: 0,
      snapshotsWritten: 0,
      rowsScanned: 0,
      reason: "no_tier_channel_sales_rows",
    });
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
    rowsScanned: allSalesRows.length,
    eventsSkippedStale: candidateIds.length - liveEventIds.size,
    errors: errors.length > 0 ? errors : undefined,
  });
}

export const GET = withCronRunLog(
  {
    cronName: "snapshot-tier-channel-sales-daily",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (b) => Number(b.snapshotsWritten ?? 0),
    considered: (b) => Number(b.eventsConsidered ?? 0),
  },
  handleGET,
);
