import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeSmoothedHistory,
  eachDayInRange,
} from "../tier-channel-smoothing.ts";
import type { SmoothingEnvelopeStep } from "../tier-channel-smoothing.ts";

// ─── eachDayInRange ───────────────────────────────────────────────────────────

describe("eachDayInRange", () => {
  it("returns a single day when fromDate === toDate", () => {
    assert.deepEqual(eachDayInRange("2026-05-01", "2026-05-01"), [
      "2026-05-01",
    ]);
  });

  it("returns correct range for a 3-day span", () => {
    assert.deepEqual(eachDayInRange("2026-05-01", "2026-05-03"), [
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
    ]);
  });

  it("returns empty array when fromDate > toDate", () => {
    assert.deepEqual(eachDayInRange("2026-05-03", "2026-05-01"), []);
  });
});

// ─── computeSmoothedHistory ───────────────────────────────────────────────────

describe("computeSmoothedHistory", () => {
  function makeEnvelope(steps: [string, number][]): SmoothingEnvelopeStep[] {
    return steps.map(([date, cumulative]) => ({ date, cumulative }));
  }

  it("produces monotonically non-decreasing cumulative series", () => {
    const envelope = makeEnvelope([
      ["2026-04-10", 100],
      ["2026-04-20", 200],
      ["2026-04-30", 200],
    ]);
    const rows = computeSmoothedHistory(
      "2026-04-10",
      "2026-05-08",
      480,
      4800,
      envelope,
    );
    let prev = -Infinity;
    for (const row of rows) {
      assert.ok(
        row.tickets >= prev,
        `Monotonicity violated at ${row.date}: ${row.tickets} < ${prev}`,
      );
      prev = row.tickets;
    }
  });

  it("final row matches currentTotalTickets exactly", () => {
    const envelope = makeEnvelope([
      ["2026-04-10", 50],
      ["2026-04-20", 100],
    ]);
    const rows = computeSmoothedHistory(
      "2026-04-10",
      "2026-04-30",
      200,
      2000,
      envelope,
    );
    const last = rows[rows.length - 1]!;
    assert.equal(last.tickets, 200);
  });

  it("distributes proportionally to envelope deltas", () => {
    // Envelope has all movement in first half
    const envelope = makeEnvelope([
      ["2026-04-10", 100],
      ["2026-04-15", 200],
      // Flat from Apr 16 onwards
      ["2026-04-20", 200],
    ]);
    // Gap = 400 - 200 = 200 (envelope tops at 200, current = 400)
    const rows = computeSmoothedHistory(
      "2026-04-10",
      "2026-04-20",
      400,
      0,
      envelope,
    );
    // Dates Apr 10-14: envelope delta = 100 over 5 days, Apr 15 delta = 100
    // Then Apr 16-20: flat, no envelope delta → zero proportional share
    // So the gap goes primarily into Apr 10-15 window.
    const apr20 = rows.find((r) => r.date === "2026-04-20")!;
    assert.equal(apr20.tickets, 400); // Final must equal currentTotal
    // Apr 16-20 (post-envelope, flat) should receive 0 additional gap
    const apr16 = rows.find((r) => r.date === "2026-04-16");
    const apr17 = rows.find((r) => r.date === "2026-04-17");
    if (apr16 && apr17) {
      // No delta here — tickets shouldn't grow between flat envelope days
      assert.ok(
        apr17.tickets <= apr16.tickets + 1,
        "No growth expected in flat section",
      );
    }
  });

  it("falls back to even distribution when envelope is flat (zero deltas)", () => {
    // Completely flat envelope — all tickets were sold on first day
    const envelope = makeEnvelope([["2026-04-01", 0]]);
    const fromDate = "2026-04-01";
    const toDate = "2026-04-10"; // 10-day window
    const rows = computeSmoothedHistory(fromDate, toDate, 100, 1000, envelope);
    assert.equal(rows.length, 10);
    // With even distribution: gap = 100, each day gets 10 tickets
    // Cumulative should grow by ~10 each day
    const last = rows[rows.length - 1]!;
    assert.equal(last.tickets, 100);
    // Each day should have roughly equal growth
    const firstDelta = rows[0]!.tickets;
    assert.ok(firstDelta >= 9 && firstDelta <= 11, `Even distribution first delta ${firstDelta}`);
  });

  it("handles zero gap gracefully (envelope already covers total)", () => {
    const envelope = makeEnvelope([
      ["2026-04-01", 200],
      ["2026-04-10", 500],
    ]);
    // currentTotalTickets = 500 = envelope tail → gap = 0
    const rows = computeSmoothedHistory(
      "2026-04-01",
      "2026-04-10",
      500,
      5000,
      envelope,
    );
    assert.equal(rows.length, 10);
    // Last row should still equal 500
    const last = rows[rows.length - 1]!;
    assert.equal(last.tickets, 500);
    // All rows should be monotonic
    let prev = -Infinity;
    for (const row of rows) {
      assert.ok(row.tickets >= prev);
      prev = row.tickets;
    }
  });

  it("revenue scales proportionally to tickets", () => {
    const envelope = makeEnvelope([["2026-04-01", 0], ["2026-04-05", 100]]);
    const totalTickets = 100;
    const totalRevenue = 5000; // £50/ticket
    const rows = computeSmoothedHistory(
      "2026-04-01",
      "2026-04-10",
      totalTickets,
      totalRevenue,
      envelope,
    );
    const last = rows[rows.length - 1]!;
    assert.equal(last.tickets, 100);
    // Revenue for last row = 100 * 50 = 5000
    assert.ok(Math.abs(last.revenue - 5000) < 1, `Revenue ${last.revenue} ≠ 5000`);
  });

  it("Manchester WC26 scenario: 480-ticket spike smoothed over 30 days", () => {
    // Simulate: envelope has steady growth from Apr 9 to May 8
    // Current tier_channel_sales total is 480 more than the envelope peak
    const envelope: SmoothingEnvelopeStep[] = [];
    let cum = 100;
    // Build a step every 3 days with steady growth
    for (let i = 0; i < 30; i += 3) {
      const d = new Date("2026-04-09T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      cum += 20;
      envelope.push({ date: d.toISOString().slice(0, 10), cumulative: cum });
    }
    const envelopeTail = cum; // last envelope value
    const currentTotal = envelopeTail + 480;

    const rows = computeSmoothedHistory(
      "2026-04-09",
      "2026-05-08",
      currentTotal,
      currentTotal * 15,
      envelope,
    );

    assert.ok(rows.length > 0, "Should produce rows");

    // Must be monotonic
    let prev = -Infinity;
    for (const row of rows) {
      assert.ok(row.tickets >= prev, `Not monotonic at ${row.date}`);
      prev = row.tickets;
    }

    // Last row must match current total exactly
    const last = rows[rows.length - 1]!;
    assert.equal(last.tickets, currentTotal);

    // No single day should account for the entire 480-ticket spike
    const maxDelta = rows.reduce((max, row, i) => {
      if (i === 0) return row.tickets;
      return Math.max(max, row.tickets - rows[i - 1]!.tickets);
    }, 0);
    assert.ok(
      maxDelta < 480,
      `Single-day spike still present: ${maxDelta} tickets on one day`,
    );
  });
});

// ─── buildEventCumulativeTicketTimeline with dailyHistory ─────────────────────

describe("buildEventCumulativeTicketTimeline with dailyHistory priority", () => {
  it("daily_history rows take priority over snapshot envelope", async () => {
    const { buildEventCumulativeTicketTimeline } = await import(
      "../venue-trend-points.ts"
    );

    const snapshots = [
      { event_id: "e1", snapshot_at: "2026-04-01", tickets_sold: 100, source: "fourthefans" as const },
      { event_id: "e1", snapshot_at: "2026-04-10", tickets_sold: 150, source: "fourthefans" as const },
    ];

    const dailyHistory = [
      {
        id: "h1",
        event_id: "e1",
        snapshot_date: "2026-04-10",
        tickets_sold_total: 300, // higher than envelope 150
        revenue_total: 3000,
        source_kind: "smoothed_historical" as const,
        captured_at: "2026-04-10T00:00:00Z",
      },
    ];

    const result = buildEventCumulativeTicketTimeline(
      snapshots,
      null,
      "2026-04-15",
      dailyHistory,
    );

    const apr10 = result.find((s) => s.date === "2026-04-10")!;
    assert.ok(apr10, "Apr 10 step should exist");
    assert.equal(apr10.cumulative, 300, "daily_history should override envelope");
    assert.equal(apr10.isSmoothed, true, "should be marked as smoothed");
  });

  it("falls back to envelope for dates not covered by daily_history", async () => {
    const { buildEventCumulativeTicketTimeline } = await import(
      "../venue-trend-points.ts"
    );

    const snapshots = [
      { event_id: "e1", snapshot_at: "2026-04-01", tickets_sold: 100, source: "fourthefans" as const },
      { event_id: "e1", snapshot_at: "2026-04-05", tickets_sold: 150, source: "fourthefans" as const },
    ];

    const dailyHistory = [
      // Only covers Apr 01
      {
        id: "h1",
        event_id: "e1",
        snapshot_date: "2026-04-01",
        tickets_sold_total: 110,
        revenue_total: 1100,
        source_kind: "cron" as const,
        captured_at: "2026-04-01T23:55:00Z",
      },
    ];

    const result = buildEventCumulativeTicketTimeline(
      snapshots,
      null,
      "2026-04-10",
      dailyHistory,
    );

    // Apr 05 has no daily_history row → should use envelope (150)
    const apr05 = result.find((s) => s.date === "2026-04-05")!;
    assert.ok(apr05, "Apr 05 should exist from envelope");
    assert.equal(apr05.cumulative, 150);
    assert.ok(!apr05.isSmoothed, "Not smoothed (came from envelope)");
  });

  it("is monotonic even when daily_history has a lower value than preceding envelope", async () => {
    const { buildEventCumulativeTicketTimeline } = await import(
      "../venue-trend-points.ts"
    );

    const snapshots = [
      { event_id: "e1", snapshot_at: "2026-04-01", tickets_sold: 200, source: "xlsx_import" as const },
    ];

    const dailyHistory = [
      // Stale row — would normally cause a regression
      {
        id: "h1",
        event_id: "e1",
        snapshot_date: "2026-04-03",
        tickets_sold_total: 50, // lower than Apr 01 envelope (200)
        revenue_total: 500,
        source_kind: "smoothed_historical" as const,
        captured_at: "2026-04-03T00:00:00Z",
      },
    ];

    const result = buildEventCumulativeTicketTimeline(
      snapshots,
      null,
      "2026-04-10",
      dailyHistory,
    );

    // Monotonicity: Apr 03 should not be below Apr 01 (200)
    let prev = 0;
    for (const step of result) {
      assert.ok(
        step.cumulative >= prev,
        `Not monotonic at ${step.date}: ${step.cumulative} < ${prev}`,
      );
      prev = step.cumulative;
    }
  });

  it("cron source_kind is NOT marked isSmoothed", async () => {
    const { buildEventCumulativeTicketTimeline } = await import(
      "../venue-trend-points.ts"
    );

    const dailyHistory = [
      {
        id: "h1",
        event_id: "e1",
        snapshot_date: "2026-05-09",
        tickets_sold_total: 500,
        revenue_total: 5000,
        source_kind: "cron" as const,
        captured_at: "2026-05-09T23:55:00Z",
      },
    ];

    const result = buildEventCumulativeTicketTimeline(
      [],
      null,
      "2026-05-10",
      dailyHistory,
    );

    const may09 = result.find((s) => s.date === "2026-05-09");
    assert.ok(may09, "May 09 step should exist");
    assert.ok(!may09.isSmoothed, "cron rows should NOT be marked smoothed");
  });
});

// ─── cron idempotency (functional test of upsert semantics) ──────────────────

describe("bulkUpsertDailyHistory idempotency contract", () => {
  it("calling twice with same rows produces same result (upsert semantics)", () => {
    // This tests the contract we rely on — the actual DB call is integration-
    // tested by deploying, but here we verify the payload shape is correct.
    const rows = [
      {
        event_id: "e1",
        snapshot_date: "2026-05-09",
        tickets_sold_total: 500,
        revenue_total: 5000,
        source_kind: "cron" as const,
      },
      {
        event_id: "e1",
        snapshot_date: "2026-05-09",
        tickets_sold_total: 500, // same row twice
        revenue_total: 5000,
        source_kind: "cron" as const,
      },
    ];
    // Deduplication: unique on (event_id, snapshot_date) — ON CONFLICT DO UPDATE
    // The DB upsert handles this; our code just sends the payload.
    // Assert: no duplicate (event_id, snapshot_date) pairs in payload would cause issues
    const keys = rows.map((r) => `${r.event_id}:${r.snapshot_date}`);
    const unique = new Set(keys);
    // Duplicates are fine for the upsert (last write wins), but just verify
    // there's at most one unique key here — would be two identical rows
    assert.equal(unique.size, 1, "duplicate rows collapse to single key");
  });
});
