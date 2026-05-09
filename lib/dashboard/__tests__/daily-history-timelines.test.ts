/**
 * lib/dashboard/__tests__/daily-history-timelines.test.ts
 *
 * Guards the `buildVenueDailyHistoryTimelines` function and the
 * `ticketDeltasFromCumulativeTimeline` derivation used to fix the
 * Daily Tracker per-day TICKETS and REVENUE columns (PR
 * fix/daily-tracker-derive-deltas-from-daily-history).
 *
 * Root bug: mergeVenueTimeline was computing ticket deltas only from
 * the snapshot envelope (cumulativeTicketTimeline), which has just a
 * few sparse snapshot dates (Apr 28, May 1, May 7 for Manchester WC26).
 * The daily_history table has 31 consecutive daily rows but was not
 * feeding the delta path. Revenue was not derived from daily_history at
 * all — it came only from event_daily_rollups (last ~3 days).
 *
 * Fix: buildVenueDailyHistoryTimelines computes venue-wide cumulative
 * timelines (tickets + revenue) directly from daily_history rows via
 * per-event carry-forward. mergeVenueTimeline uses these as the primary
 * delta source, falling back to the snapshot envelope only for dates not
 * covered by daily_history.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildVenueDailyHistoryTimelines,
  ticketDeltasFromCumulativeTimeline,
} from "../venue-trend-points.ts";
import type { TierChannelDailyHistoryRow } from "../../db/tier-channel-daily-history.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const EV1 = "event-uuid-1111-1111-1111-111111111111";
const EV2 = "event-uuid-2222-2222-2222-222222222222";
const EV3 = "event-uuid-3333-3333-3333-333333333333";
const EV4 = "event-uuid-4444-4444-4444-444444444444";

const VENUE_EVENTS = new Set([EV1, EV2, EV3, EV4]);

function makeRow(
  eventId: string,
  snapshotDate: string,
  ticketsSoldTotal: number,
  revenueTotal = 0,
  sourceKind: TierChannelDailyHistoryRow["source_kind"] = "smoothed_historical",
): TierChannelDailyHistoryRow {
  return {
    id: crypto.randomUUID(),
    event_id: eventId,
    snapshot_date: snapshotDate,
    tickets_sold_total: ticketsSoldTotal,
    revenue_total: revenueTotal,
    source_kind: sourceKind,
    captured_at: `${snapshotDate}T23:55:00.000Z`,
  };
}

/**
 * Build 31 consecutive daily_history rows for a single event.
 * Ticket cumulative grows linearly from `startTickets` to `endTickets`.
 * Revenue grows linearly from `startRevenue` to `endRevenue`.
 */
function buildLinearHistory(
  eventId: string,
  fromDate: string,
  toDate: string,
  startTickets: number,
  endTickets: number,
  startRevenue = 0,
  endRevenue = 0,
  sourceKind: TierChannelDailyHistoryRow["source_kind"] = "smoothed_historical",
): TierChannelDailyHistoryRow[] {
  const rows: TierChannelDailyHistoryRow[] = [];
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const days =
    Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    const date = d.toISOString().slice(0, 10);
    const t = days === 1 ? endTickets : startTickets + Math.round(((endTickets - startTickets) * i) / (days - 1));
    const r = days === 1 ? endRevenue : startRevenue + Math.round(((endRevenue - startRevenue) * i) / (days - 1));
    rows.push(makeRow(eventId, date, t, r, sourceKind));
  }
  return rows;
}

// ─── buildVenueDailyHistoryTimelines — basic ─────────────────────────────────

describe("buildVenueDailyHistoryTimelines", () => {
  it("returns empty arrays when dailyHistory is empty", () => {
    const result = buildVenueDailyHistoryTimelines([], VENUE_EVENTS);
    assert.deepEqual(result.tickets, []);
    assert.deepEqual(result.revenue, []);
  });

  it("returns empty arrays when all rows belong to a different venue", () => {
    const rows = [makeRow("other-event-uuid", "2026-04-09", 100, 500)];
    const result = buildVenueDailyHistoryTimelines(rows, VENUE_EVENTS);
    assert.deepEqual(result.tickets, []);
    assert.deepEqual(result.revenue, []);
  });

  it("single event, single day → cumulative equals that day's value", () => {
    const rows = [makeRow(EV1, "2026-05-09", 341, 12000)];
    const result = buildVenueDailyHistoryTimelines(rows, VENUE_EVENTS);
    assert.deepEqual(result.tickets, [{ date: "2026-05-09", cumulative: 341 }]);
    assert.deepEqual(result.revenue, [{ date: "2026-05-09", cumulative: 12000 }]);
  });

  it("sums four events on the same date", () => {
    const rows = [
      makeRow(EV1, "2026-04-09", 52, 1820),
      makeRow(EV2, "2026-04-09", 51, 1785),
      makeRow(EV3, "2026-04-09", 52, 1820),
      makeRow(EV4, "2026-04-09", 52, 1820),
    ];
    const result = buildVenueDailyHistoryTimelines(rows, VENUE_EVENTS);
    assert.equal(result.tickets.length, 1);
    assert.equal(result.tickets[0]!.cumulative, 207);
    assert.equal(result.revenue[0]!.cumulative, 7245);
  });

  it("carry-forward fills missing dates for events that start later", () => {
    // EV1 starts Apr 9, EV2 starts Apr 11.
    // On Apr 9 and Apr 10, EV2 should carry-forward 0 (no prior row).
    const rows = [
      makeRow(EV1, "2026-04-09", 52),
      makeRow(EV1, "2026-04-10", 55),
      makeRow(EV1, "2026-04-11", 58),
      makeRow(EV2, "2026-04-11", 30),
    ];
    const result = buildVenueDailyHistoryTimelines(
      rows,
      new Set([EV1, EV2]),
    );
    assert.equal(result.tickets.length, 3);
    // Apr 9: EV1=52, EV2 carry-forward=0 → 52
    assert.equal(result.tickets[0]!.date, "2026-04-09");
    assert.equal(result.tickets[0]!.cumulative, 52);
    // Apr 10: EV1=55, EV2 carry-forward=0 → 55
    assert.equal(result.tickets[1]!.date, "2026-04-10");
    assert.equal(result.tickets[1]!.cumulative, 55);
    // Apr 11: EV1=58, EV2=30 → 88
    assert.equal(result.tickets[2]!.date, "2026-04-11");
    assert.equal(result.tickets[2]!.cumulative, 88);
  });
});

// ─── Manchester WC26 scenario (31 days × 4 events) ───────────────────────────

describe("Manchester WC26 scenario — 31 days × 4 events", () => {
  // Each of the 4 Manchester events grows from ~52 to ~341 tickets over
  // Apr 9–May 9 (31 days). Revenue grows from ~500 to ~11,700 per event.
  const aprilNine = "2026-04-09";
  const mayNine = "2026-05-09";

  const ev1Rows = buildLinearHistory(EV1, aprilNine, mayNine, 52, 341, 500, 11_935);
  const ev2Rows = buildLinearHistory(EV2, aprilNine, mayNine, 51, 340, 490, 11_900);
  const ev3Rows = buildLinearHistory(EV3, aprilNine, mayNine, 52, 341, 500, 11_935);
  const ev4Rows = buildLinearHistory(EV4, aprilNine, mayNine, 52, 340, 490, 11_900);

  const allRows = [...ev1Rows, ...ev2Rows, ...ev3Rows, ...ev4Rows];

  it("produces 31 cumulative steps (one per day Apr 9–May 9)", () => {
    const result = buildVenueDailyHistoryTimelines(allRows, VENUE_EVENTS);
    assert.equal(result.tickets.length, 31);
    assert.equal(result.tickets[0]!.date, "2026-04-09");
    assert.equal(result.tickets[30]!.date, "2026-05-09");
  });

  it("venue cumulative at Apr 9 sums four events correctly (≈207)", () => {
    const result = buildVenueDailyHistoryTimelines(allRows, VENUE_EVENTS);
    const apr9 = result.tickets.find((s) => s.date === "2026-04-09")!;
    assert.ok(apr9, "Apr 9 step should exist");
    // 52+51+52+52 = 207
    assert.equal(apr9.cumulative, 207);
  });

  it("venue cumulative at May 9 sums four events correctly (≈1362)", () => {
    const result = buildVenueDailyHistoryTimelines(allRows, VENUE_EVENTS);
    const may9 = result.tickets.find((s) => s.date === "2026-05-09")!;
    assert.ok(may9, "May 9 step should exist");
    // 341+340+341+340 = 1362
    assert.equal(may9.cumulative, 1362);
  });

  it("cumulative timeline is monotonically non-decreasing (no drops)", () => {
    const result = buildVenueDailyHistoryTimelines(allRows, VENUE_EVENTS);
    for (let i = 1; i < result.tickets.length; i++) {
      assert.ok(
        result.tickets[i]!.cumulative >= result.tickets[i - 1]!.cumulative,
        `tickets dropped on ${result.tickets[i]!.date}: ${result.tickets[i - 1]!.cumulative} → ${result.tickets[i]!.cumulative}`,
      );
    }
    for (let i = 1; i < result.revenue.length; i++) {
      assert.ok(
        result.revenue[i]!.cumulative >= result.revenue[i - 1]!.cumulative,
        `revenue dropped on ${result.revenue[i]!.date}`,
      );
    }
  });

  it("ticketDeltasFromCumulativeTimeline produces 30 positive deltas (Apr 10–May 9)", () => {
    const result = buildVenueDailyHistoryTimelines(allRows, VENUE_EVENTS);
    const ticketDeltas = ticketDeltasFromCumulativeTimeline(result.tickets);
    // 31 cumulative steps → 30 consecutive day-over-day deltas
    // Day 1 (Apr 9) emits its full cumulative 207 as the initial delta.
    // All 31 days should have a positive delta given linear growth.
    assert.ok(
      ticketDeltas.size >= 30,
      `Expected ≥30 ticket deltas, got ${ticketDeltas.size}`,
    );
    assert.ok(ticketDeltas.has("2026-04-09"), "Apr 9 (first day) should have initial delta");
    assert.equal(ticketDeltas.get("2026-04-09"), 207, "Apr 9 initial delta = 207");
    assert.ok(ticketDeltas.has("2026-05-09"), "May 9 (last day) should have a delta");
  });

  it("revenue ticketDeltasFromCumulativeTimeline produces ≥30 entries", () => {
    const result = buildVenueDailyHistoryTimelines(allRows, VENUE_EVENTS);
    const revenueDeltas = ticketDeltasFromCumulativeTimeline(result.revenue);
    assert.ok(
      revenueDeltas.size >= 30,
      `Expected ≥30 revenue deltas, got ${revenueDeltas.size}`,
    );
    // Revenue at Apr 9 = 500+490+500+490 = 1980 (initial delta)
    assert.equal(revenueDeltas.get("2026-04-09"), 1980);
  });

  it("sum of all ticket deltas equals final cumulative (no double-counting)", () => {
    const result = buildVenueDailyHistoryTimelines(allRows, VENUE_EVENTS);
    const ticketDeltas = ticketDeltasFromCumulativeTimeline(result.tickets);
    const sumOfDeltas = [...ticketDeltas.values()].reduce((a, b) => a + b, 0);
    const finalCumulative = result.tickets[result.tickets.length - 1]!.cumulative;
    assert.equal(
      sumOfDeltas,
      finalCumulative,
      "Sum of all daily deltas must equal the final cumulative (no double-counting)",
    );
  });
});

// ─── Edge: single-day daily_history ──────────────────────────────────────────

describe("edge case: single-day daily_history (first day of cron)", () => {
  it("emits the full cumulative as the delta for that one day", () => {
    // First time cron runs: only today's snapshot exists.
    const rows = [
      makeRow(EV1, "2026-05-09", 341, 11_935, "cron"),
      makeRow(EV2, "2026-05-09", 340, 11_900, "cron"),
    ];
    const result = buildVenueDailyHistoryTimelines(rows, new Set([EV1, EV2]));
    const deltas = ticketDeltasFromCumulativeTimeline(result.tickets);
    assert.equal(deltas.size, 1);
    assert.equal(deltas.get("2026-05-09"), 681, "Single day shows full cumulative as delta");
  });
});

// ─── Edge: gaps in daily_history (fallback for missing dates) ────────────────

describe("edge case: gaps in daily_history (some dates missing)", () => {
  it("carry-forward fills the gap, producing a delta only when cumulative changes", () => {
    // Only Apr 9 and Apr 15 rows exist — 5 missing days in between.
    // Carry-forward: Apr 9 cumulative is held through Apr 10–14.
    // At Apr 15 the cumulative jumps, producing a delta only on Apr 15.
    const rows = [
      makeRow(EV1, "2026-04-09", 52, 1820),
      makeRow(EV1, "2026-04-15", 80, 2800),
    ];
    const result = buildVenueDailyHistoryTimelines(rows, new Set([EV1]));
    // Only 2 dates are in daily_history (no rows for Apr 10–14).
    assert.equal(result.tickets.length, 2);
    const deltas = ticketDeltasFromCumulativeTimeline(result.tickets);
    // Apr 9: initial delta = 52
    // Apr 15: delta = 80 - 52 = 28
    assert.equal(deltas.get("2026-04-09"), 52);
    assert.equal(deltas.get("2026-04-15"), 28);
    // Apr 10–14 are NOT in the cumulative timeline (no rows in daily_history).
    // These dates have no delta from the daily_history path; the snapshot
    // envelope fallback in mergeVenueTimeline covers them.
    assert.ok(!deltas.has("2026-04-10"), "Apr 10 not in daily_history gap → no delta here");
  });

  it("sum of deltas equals final cumulative even with gaps", () => {
    const rows = [
      makeRow(EV1, "2026-04-09", 52),
      makeRow(EV1, "2026-04-15", 80),
      makeRow(EV1, "2026-04-20", 120),
    ];
    const result = buildVenueDailyHistoryTimelines(rows, new Set([EV1]));
    const deltas = ticketDeltasFromCumulativeTimeline(result.tickets);
    const sumOfDeltas = [...deltas.values()].reduce((a, b) => a + b, 0);
    assert.equal(sumOfDeltas, 120);
  });
});

// ─── Revenue: zero-revenue events don't contaminate total ────────────────────

describe("revenue: zero-revenue rows are summed correctly", () => {
  it("events with no revenue_total (0) contribute 0 to venue revenue", () => {
    const rows = [
      makeRow(EV1, "2026-04-09", 52, 1820),
      makeRow(EV2, "2026-04-09", 50, 0), // no revenue tracked for this event
    ];
    const result = buildVenueDailyHistoryTimelines(rows, new Set([EV1, EV2]));
    assert.equal(result.revenue[0]!.cumulative, 1820);
  });
});

// ─── Fallback: no daily_history → empty arrays → caller uses snapshot path ───

describe("fallback: venue without daily_history", () => {
  it("returns empty arrays so caller falls back to snapshot envelope", () => {
    // CL Final venue that was never backfilled.
    const result = buildVenueDailyHistoryTimelines([], new Set([EV1]));
    assert.deepEqual(result.tickets, []);
    assert.deepEqual(result.revenue, []);
    // Callers check `.tickets.length > 0` before using daily_history path.
    const deltas = ticketDeltasFromCumulativeTimeline(result.tickets);
    assert.equal(deltas.size, 0, "No deltas from empty daily_history");
  });
});
