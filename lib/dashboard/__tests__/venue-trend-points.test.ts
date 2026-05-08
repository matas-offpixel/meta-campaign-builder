/**
 * Tests for lib/dashboard/venue-trend-points.ts + the aggregator's handling
 * of mixed snapshot + rollup point arrays.
 *
 * Regression guard for the Manchester WC26 flat-tickets-line bug:
 *
 *   Before fix: `buildVenueTrendPoints` gated snapshot points on
 *   `!hasRollupTickets`. Manchester has 259 cumulative snapshot rows (Feb–May)
 *   plus 1-2 days of rollup `tickets_sold` from meta_regs. The gate prevented
 *   all 259 snapshot rows from being added → trend chart showed a flat zero
 *   line except for the 1-2 rollup spikes.
 *
 *   After fix: snapshot points are ALWAYS added. Rollup tickets_sold is
 *   suppressed when snapshots exist (to prevent the aggregator's cumulative
 *   mode from replacing the ~699 cumulative total with meta_regs=4).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aggregateTrendChartPoints,
  hasCumulativeTicketPoints,
  summarizeTrendChartPoints,
  type TrendChartPoint,
} from "../trend-chart-data.ts";
import { buildVenueTicketSnapshotPoints } from "../venue-trend-points.ts";
import type { WeeklyTicketSnapshotRow } from "../../db/client-portal-server.ts";

// ─── Fixtures ──────────────────────────────────────────────────────────────

/** Manchester WC26 fixture UUIDs (real IDs used in the regression). */
const MANCHESTER_IDS = {
  croatia: "ba05a442-bc21-432f-bec9-0f5ae5f02c84",
  ghana: "29ae997b-4389-4f92-95f9-3e1bb92eb0dd",
  panama: "0cac6ef0-adfa-40d6-9ea5-02ef47210e28",
  last32: "a4fd2772-3e76-4142-b055-c9de5817cf47",
} as const;

const ALL_MANCHESTER = new Set(Object.values(MANCHESTER_IDS));

function snapshot(
  eventId: string,
  snapshotAt: string,
  ticketsSold: number,
): WeeklyTicketSnapshotRow {
  return { event_id: eventId, snapshot_at: snapshotAt, tickets_sold: ticketsSold, source: "fourthefans" };
}

function rollupPoint(date: string, spend: number, tickets: number | null): TrendChartPoint {
  return { date, spend, tickets, revenue: null, linkClicks: null };
}

// ─── buildVenueTicketSnapshotPoints ─────────────────────────────────────────

describe("buildVenueTicketSnapshotPoints", () => {
  it("returns empty array when no snapshots match venue event ids", () => {
    const snaps: WeeklyTicketSnapshotRow[] = [
      snapshot("other-event", "2026-03-01", 100),
    ];
    const result = buildVenueTicketSnapshotPoints(snaps, ALL_MANCHESTER);
    assert.deepEqual(result, []);
  });

  it("single event: returns one point per snapshot date with cumulative total", () => {
    const snaps = [
      snapshot(MANCHESTER_IDS.croatia, "2026-02-12", 50),
      snapshot(MANCHESTER_IDS.croatia, "2026-02-19", 120),
      snapshot(MANCHESTER_IDS.croatia, "2026-02-26", 200),
    ];
    const result = buildVenueTicketSnapshotPoints(snaps, ALL_MANCHESTER);

    assert.equal(result.length, 3);
    assert.equal(result[0]?.date, "2026-02-12");
    assert.equal(result[0]?.tickets, 50);
    assert.equal(result[1]?.tickets, 120);
    assert.equal(result[2]?.tickets, 200);
    // All points must be tagged cumulative_snapshot
    assert.ok(result.every((p) => p.ticketsKind === "cumulative_snapshot"));
  });

  it("four Manchester fixtures: sums cumulative totals across all events at each date", () => {
    // Each event has its own progression (different games going on sale at
    // different times). At the Feb 26 snapshot, only Croatia has sales.
    // By Mar 19 all four are selling.
    const snaps = [
      snapshot(MANCHESTER_IDS.croatia, "2026-02-12", 75),
      snapshot(MANCHESTER_IDS.croatia, "2026-02-19", 150),
      snapshot(MANCHESTER_IDS.ghana,   "2026-02-19", 80),
      snapshot(MANCHESTER_IDS.croatia, "2026-03-19", 310),
      snapshot(MANCHESTER_IDS.ghana,   "2026-03-19", 200),
      snapshot(MANCHESTER_IDS.panama,  "2026-03-19", 120),
      snapshot(MANCHESTER_IDS.last32,  "2026-03-19", 69),
    ];
    const result = buildVenueTicketSnapshotPoints(snaps, ALL_MANCHESTER);

    // Distinct dates: 2026-02-12, 2026-02-19, 2026-03-19
    assert.equal(result.length, 3);

    const byDate = new Map(result.map((p) => [p.date, p.tickets]));

    // Feb 12: only Croatia has a snapshot → 75
    assert.equal(byDate.get("2026-02-12"), 75);

    // Feb 19: Croatia (latest=150) + Ghana (latest=80). Panama and Last 32
    // have no snapshot on or before this date → carry = 0
    assert.equal(byDate.get("2026-02-19"), 230);

    // Mar 19: all four events have a snapshot → 310+200+120+69 = 699
    assert.equal(byDate.get("2026-03-19"), 699);
  });

  it("carries the last snapshot forward when an event has no entry on a later date", () => {
    // Croatia snaps on Feb 12 (100). Ghana snaps on Feb 19 (50).
    // On Feb 19 point, Croatia should still use its Feb 12 value.
    const snaps = [
      snapshot(MANCHESTER_IDS.croatia, "2026-02-12", 100),
      snapshot(MANCHESTER_IDS.ghana,   "2026-02-19", 50),
    ];
    const result = buildVenueTicketSnapshotPoints(snaps, ALL_MANCHESTER);
    assert.equal(result.length, 2);

    const byDate = new Map(result.map((p) => [p.date, p.tickets]));
    assert.equal(byDate.get("2026-02-12"), 100); // Croatia only
    assert.equal(byDate.get("2026-02-19"), 150); // Croatia (100 carried) + Ghana (50)
  });
});

// ─── Manchester scenario: snapshot + rollup combined ────────────────────────

describe("Manchester regression: snapshot points + rollup spend, no rollup tickets", () => {
  /**
   * Simulates what the corrected buildVenueTrendPoints produces for Manchester:
   *   - 4 events × weekly snapshots showing cumulative tickets (growing to 699)
   *   - Rollup points carry spend data but tickets=null (snapshots win)
   *   - Combined via aggregateTrendChartPoints → smooth cumulative line
   */
  it("aggregator carries cumulative snapshot forward through spend-only rollup days", () => {
    const snaps = [
      snapshot(MANCHESTER_IDS.croatia, "2026-02-12", 75),
      snapshot(MANCHESTER_IDS.ghana,   "2026-02-12", 25),
      snapshot(MANCHESTER_IDS.croatia, "2026-03-19", 310),
      snapshot(MANCHESTER_IDS.ghana,   "2026-03-19", 200),
      snapshot(MANCHESTER_IDS.panama,  "2026-03-19", 120),
      snapshot(MANCHESTER_IDS.last32,  "2026-03-19", 69),
    ];

    const snapshotPoints = buildVenueTicketSnapshotPoints(snaps, ALL_MANCHESTER);

    // Rollup points: spend present, tickets suppressed (hasSnapshotTickets=true)
    const rollupPoints: TrendChartPoint[] = [
      rollupPoint("2026-05-07", 85.5, null),
      rollupPoint("2026-05-08", 95.5, null), // today — meta_regs=4 suppressed
    ];

    const allPoints = [...rollupPoints, ...snapshotPoints];

    assert.ok(hasCumulativeTicketPoints(allPoints), "should be in cumulative mode");

    const daily = aggregateTrendChartPoints(allPoints, "daily");
    assert.ok(daily.length >= 2, "should have at least snapshot and spend days");

    // The last day (May 8) should carry the cumulative total from Mar 19 (699)
    // NOT meta_regs (which would have been 4 with the broken gate)
    assert.equal(daily.at(-1)?.tickets, 699, "last day should carry 699 cumulative total");

    // Spend should still be summed correctly on the rollup days
    const may8 = daily.find((d) => d.date === "2026-05-08");
    assert.ok(may8, "May 8 rollup day should be present");
    assert.equal(may8?.spend, 95.5);

    // Summary: cumulative max = 699 (not 4 as it would be with meta_regs)
    const weekly = aggregateTrendChartPoints(allPoints, "weekly");
    const summary = summarizeTrendChartPoints(weekly, true);
    assert.equal(summary.tickets, 699, "summary ticket count should be 699, not 4");
  });

  /**
   * Verify the pre-fix bug behaviour: when rollup tickets (meta_regs=4) land in
   * the same points array as cumulative snapshots (699), the aggregator WOULD
   * drop the cumulative total to 4 on the date of the rollup point. This
   * demonstrates WHY rollup tickets_sold must be suppressed.
   */
  it("(illustrates pre-fix bug) rollup tickets_sold=4 would corrupt the 699 cumulative total", () => {
    const snaps = [
      snapshot(MANCHESTER_IDS.croatia, "2026-03-19", 310),
      snapshot(MANCHESTER_IDS.ghana,   "2026-03-19", 200),
      snapshot(MANCHESTER_IDS.panama,  "2026-03-19", 120),
      snapshot(MANCHESTER_IDS.last32,  "2026-03-19", 69),
    ];
    const snapshotPoints = buildVenueTicketSnapshotPoints(snaps, ALL_MANCHESTER);

    // Simulate the BROKEN behaviour: meta_regs=4 emitted as a ticket point
    const brokenRollupPoints: TrendChartPoint[] = [
      rollupPoint("2026-05-08", 95.5, 4), // tickets NOT suppressed — pre-fix bug
    ];

    const buggedPoints = [...snapshotPoints, ...brokenRollupPoints];
    assert.ok(hasCumulativeTicketPoints(buggedPoints));

    const daily = aggregateTrendChartPoints(buggedPoints, "daily");
    // The aggregator in cumulative mode sets May 8 tickets = 4, then carry-
    // forward propagates that backward... actually carry-forward only goes
    // forward, so May 8 would be 4 not 699.
    const may8 = daily.find((d) => d.date === "2026-05-08");
    assert.equal(
      may8?.tickets,
      4,
      "pre-fix: meta_regs=4 overwrites 699 cumulative total — this is the bug",
    );
  });
});

// ─── Rollup-only scenario ───────────────────────────────────────────────────

describe("rollup-only: no snapshots — additive tickets_sold still works", () => {
  it("when no snapshot data exists, rollup tickets_sold is used additively", () => {
    // No snapshots → buildVenueTicketSnapshotPoints returns []
    const emptySnapshots = buildVenueTicketSnapshotPoints([], ALL_MANCHESTER);
    assert.equal(emptySnapshots.length, 0);

    // Rollup points WITH tickets (hasSnapshotTickets=false → hasRollupTickets=true)
    const rollupPoints: TrendChartPoint[] = [
      rollupPoint("2026-05-06", 80, 3),
      rollupPoint("2026-05-07", 85, 2),
      rollupPoint("2026-05-08", 95.5, 4),
    ];

    const allPoints = [...rollupPoints, ...emptySnapshots];
    assert.ok(!hasCumulativeTicketPoints(allPoints), "no snapshots → additive mode");

    const daily = aggregateTrendChartPoints(allPoints, "daily");
    assert.equal(daily.length, 3);

    const summary = summarizeTrendChartPoints(daily, false);
    assert.equal(summary.tickets, 9); // 3+2+4 = 9 additive total
    assert.ok(
      Math.abs((summary.spend ?? 0) - 260.5) < 0.01,
      `spend sum should be 260.5, got ${summary.spend}`,
    );
  });
});

// ─── Mixed: some events have snapshots, others only rollup ─────────────────

describe("mixed: snapshots for some events, no snapshots for others", () => {
  it("snapshot events dominate; rollup tickets_sold is suppressed globally", () => {
    // Only Croatia and Ghana have snapshot history; Panama and Last 32 do not.
    const snaps = [
      snapshot(MANCHESTER_IDS.croatia, "2026-03-19", 310),
      snapshot(MANCHESTER_IDS.ghana,   "2026-03-19", 200),
    ];
    const snapshotPoints = buildVenueTicketSnapshotPoints(snaps, ALL_MANCHESTER);
    assert.equal(snapshotPoints.length, 1); // one distinct date
    assert.equal(snapshotPoints[0]?.tickets, 510); // 310+200

    // hasSnapshotTickets=true → all rollup points have tickets=null
    const rollupPoints: TrendChartPoint[] = [
      rollupPoint("2026-05-08", 95.5, null), // tickets suppressed
    ];

    const allPoints = [...rollupPoints, ...snapshotPoints];
    assert.ok(hasCumulativeTicketPoints(allPoints));

    const daily = aggregateTrendChartPoints(allPoints, "daily");
    const may8 = daily.find((d) => d.date === "2026-05-08");
    // Carry-forward from Mar 19 (510) to May 8
    assert.equal(may8?.tickets, 510);
  });
});
