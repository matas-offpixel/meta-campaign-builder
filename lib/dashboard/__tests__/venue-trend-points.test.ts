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
import {
  buildEventCumulativeTicketTimeline,
  buildVenueCumulativeTicketTimeline,
  buildVenueTicketSnapshotPoints,
  ticketDeltasFromCumulativeTimeline,
} from "../venue-trend-points.ts";
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
  source: WeeklyTicketSnapshotRow["source"] = "fourthefans",
): WeeklyTicketSnapshotRow {
  return { event_id: eventId, snapshot_at: snapshotAt, tickets_sold: ticketsSold, source };
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

// ─── PR fix/venue-trend-tier-channel-snapshot regressions ──────────────────
//
// These guard the Manchester WC26 trend bug: source coverage transitions
// (xlsx_import Apr 28 = 878 all-channel → fourthefans Apr 29 = 284 4TF-only)
// produced a 590-ticket "drop" overnight that didn't actually happen. The
// envelope-based cumulative + tier_channel_sales today-anchor collapses
// the cliff to 0 growth and snaps the latest day to the cross-channel
// authoritative total.

describe("buildEventCumulativeTicketTimeline (envelope across sources)", () => {
  it("running max envelope: Apr 29 fourthefans 246 carries Apr 28 xlsx_import 274 forward", () => {
    const rows = [
      snapshot("croatia-id", "2026-04-28", 274, "xlsx_import"),
      snapshot("croatia-id", "2026-04-29", 246, "fourthefans"),
      snapshot("croatia-id", "2026-04-30", 250, "fourthefans"),
      snapshot("croatia-id", "2026-05-05", 482, "fourthefans"),
    ];
    const timeline = buildEventCumulativeTicketTimeline(rows, null, "2026-05-05");

    const byDate = new Map(timeline.map((s) => [s.date, s.cumulative]));
    assert.equal(byDate.get("2026-04-28"), 274);
    // Apr 29 fourthefans 246 < envelope 274 → carries forward.
    assert.equal(byDate.get("2026-04-29"), 274);
    assert.equal(byDate.get("2026-04-30"), 274);
    // May 5 fourthefans 482 > envelope 274 → envelope grows.
    assert.equal(byDate.get("2026-05-05"), 482);
  });

  it("monotonic non-decreasing across the entire timeline", () => {
    const rows = [
      snapshot("e", "2026-04-28", 878, "xlsx_import"),
      snapshot("e", "2026-04-29", 284, "fourthefans"),
      snapshot("e", "2026-04-30", 290, "fourthefans"),
      snapshot("e", "2026-05-01", 300, "fourthefans"),
      snapshot("e", "2026-05-02", 310, "fourthefans"),
    ];
    const timeline = buildEventCumulativeTicketTimeline(rows, null, "2026-05-02");
    let prev = 0;
    for (const step of timeline) {
      assert.ok(
        step.cumulative >= prev,
        `cumulative regressed on ${step.date}: ${prev} → ${step.cumulative}`,
      );
      prev = step.cumulative;
    }
  });

  it("tier_channel_sales anchor: today's cumulative jumps to the cross-channel SUM", () => {
    const rows = [
      snapshot("croatia-id", "2026-04-28", 274, "xlsx_import"),
      snapshot("croatia-id", "2026-05-05", 482, "fourthefans"),
    ];
    // tier_channel_sales SUM for Croatia today = 4TF 482 + Venue 120 = 602
    const timeline = buildEventCumulativeTicketTimeline(
      rows,
      { tickets: 602, revenue: null },
      "2026-05-09",
    );
    const last = timeline.at(-1);
    assert.equal(last?.date, "2026-05-09");
    assert.equal(last?.cumulative, 602);
  });

  it("anchor below envelope: keeps envelope, does not regress", () => {
    const rows = [
      snapshot("e", "2026-04-28", 878, "xlsx_import"),
      snapshot("e", "2026-05-05", 950, "fourthefans"),
    ];
    // tier_channel_sales says 700 — stale or partial. Envelope already
    // hit 950, so the today step must stay at 950, not regress to 700.
    const timeline = buildEventCumulativeTicketTimeline(
      rows,
      { tickets: 700, revenue: null },
      "2026-05-09",
    );
    const last = timeline.at(-1);
    assert.ok(last !== undefined);
    assert.ok(last.cumulative >= 950, `expected >=950, got ${last.cumulative}`);
  });

  it("event with no snapshots but a tier_channel_sales anchor: emits a single today step", () => {
    const timeline = buildEventCumulativeTicketTimeline(
      [],
      { tickets: 124, revenue: 850 },
      "2026-05-09",
    );
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0]?.date, "2026-05-09");
    assert.equal(timeline[0]?.cumulative, 124);
    assert.equal(timeline[0]?.cumulativeRevenue, 850);
  });
});

describe("buildVenueTicketSnapshotPoints + tier_channel_sales anchors (Manchester WC26)", () => {
  /**
   * The Manchester WC26 four-fixture scenario from the bug report:
   *
   *   xlsx_import Apr 28: Croatia 274 + Panama 498 + Ghana 67 + Last 32 39 = 878
   *   fourthefans Apr 29: Croatia 246 + Last 32 39 + (Ghana, Panama no data) = 285
   *   tier_channel_sales today: 602 + 142 + 540 + 78 = 1,362
   *
   * The trend chart must:
   *   - Show 878 cumulative on Apr 28 (xlsx baseline)
   *   - Stay >= 878 on Apr 29 (no phantom drop)
   *   - End at 1,362 today (matches Event Breakdown)
   *   - Be monotonic non-decreasing the whole way
   */
  const snaps: WeeklyTicketSnapshotRow[] = [
    // Apr 28: xlsx_import all-channel cumulative
    snapshot(MANCHESTER_IDS.croatia, "2026-04-28", 274, "xlsx_import"),
    snapshot(MANCHESTER_IDS.panama,  "2026-04-28", 498, "xlsx_import"),
    snapshot(MANCHESTER_IDS.ghana,   "2026-04-28",  67, "xlsx_import"),
    snapshot(MANCHESTER_IDS.last32,  "2026-04-28",  39, "xlsx_import"),
    // Apr 29: fourthefans 4TF-only — Ghana / Panama not yet covered
    snapshot(MANCHESTER_IDS.croatia, "2026-04-29", 246, "fourthefans"),
    snapshot(MANCHESTER_IDS.last32,  "2026-04-29",  39, "fourthefans"),
    // May 5: fourthefans grows for Croatia, others catch up
    snapshot(MANCHESTER_IDS.croatia, "2026-05-05", 482, "fourthefans"),
    snapshot(MANCHESTER_IDS.ghana,   "2026-05-05", 139, "fourthefans"),
    snapshot(MANCHESTER_IDS.panama,  "2026-05-05", 336, "fourthefans"),
    snapshot(MANCHESTER_IDS.last32,  "2026-05-05",  78, "fourthefans"),
  ];

  const anchors = [
    { event_id: MANCHESTER_IDS.croatia, tickets: 602, revenue: 3612 },
    { event_id: MANCHESTER_IDS.ghana,   tickets: 142, revenue:  852 },
    { event_id: MANCHESTER_IDS.panama,  tickets: 540, revenue: 3240 },
    { event_id: MANCHESTER_IDS.last32,  tickets:  78, revenue:  468 },
  ];

  it("Apr 28 venue cumulative = 878 (xlsx_import all-channel)", () => {
    const points = buildVenueTicketSnapshotPoints(snaps, ALL_MANCHESTER, {
      tierChannelAnchors: anchors,
      todayIso: "2026-05-09",
    });
    const apr28 = points.find((p) => p.date === "2026-04-28");
    assert.equal(apr28?.tickets, 878);
  });

  it("Apr 29 venue cumulative >= 878 (no phantom drop)", () => {
    const points = buildVenueTicketSnapshotPoints(snaps, ALL_MANCHESTER, {
      tierChannelAnchors: anchors,
      todayIso: "2026-05-09",
    });
    const apr29 = points.find((p) => p.date === "2026-04-29");
    assert.ok(apr29?.tickets != null);
    assert.ok(
      apr29.tickets >= 878,
      `Apr 29 should not regress below Apr 28 (878), got ${apr29.tickets}`,
    );
  });

  it("today (May 9) venue cumulative = 1,362 = tier_channel_sales SUM (Event Breakdown match)", () => {
    const points = buildVenueTicketSnapshotPoints(snaps, ALL_MANCHESTER, {
      tierChannelAnchors: anchors,
      todayIso: "2026-05-09",
    });
    const today = points.find((p) => p.date === "2026-05-09");
    assert.equal(today?.tickets, 1362);
  });

  it("trend line is monotonically non-decreasing across the entire window", () => {
    const points = buildVenueTicketSnapshotPoints(snaps, ALL_MANCHESTER, {
      tierChannelAnchors: anchors,
      todayIso: "2026-05-09",
    });
    let prev = 0;
    for (const point of points) {
      assert.ok(
        point.tickets != null && point.tickets >= prev,
        `cumulative regressed on ${point.date}: ${prev} → ${point.tickets}`,
      );
      prev = point.tickets;
    }
  });

  it("CL Final / single-source venue with no anchor: trend unchanged (no regression)", () => {
    const clFinalSnaps = [
      snapshot("outernet-id", "2026-04-15", 100, "fourthefans"),
      snapshot("outernet-id", "2026-04-22", 250, "fourthefans"),
      snapshot("outernet-id", "2026-04-29", 350, "fourthefans"),
    ];
    const result = buildVenueTicketSnapshotPoints(
      clFinalSnaps,
      new Set(["outernet-id"]),
      // No tier_channel_sales anchor passed — falls through to snapshot-only.
      { todayIso: "2026-05-09" },
    );
    assert.equal(result.length, 3);
    assert.deepEqual(
      result.map((p) => p.tickets),
      [100, 250, 350],
    );
  });
});

describe("ticketDeltasFromCumulativeTimeline", () => {
  it("emits positive deltas only — no negatives on phantom-drop days", () => {
    const cumulative = [
      { date: "2026-04-28", cumulative: 878 },
      // No Apr 29 entry — envelope stays at 878.
      { date: "2026-05-05", cumulative: 1132 },
      { date: "2026-05-09", cumulative: 1362 },
    ];
    const deltas = ticketDeltasFromCumulativeTimeline(cumulative);
    assert.equal(deltas.get("2026-04-28"), 878); // first-day delta
    assert.equal(deltas.has("2026-04-29"), false); // no growth → no entry
    assert.equal(deltas.get("2026-05-05"), 254);
    assert.equal(deltas.get("2026-05-09"), 230);
  });

  it("treats equal consecutive cumulatives as zero deltas (renders as — in tracker)", () => {
    const cumulative = [
      { date: "2026-04-28", cumulative: 100 },
      { date: "2026-04-29", cumulative: 100 },
      { date: "2026-04-30", cumulative: 100 },
    ];
    const deltas = ticketDeltasFromCumulativeTimeline(cumulative);
    assert.equal(deltas.size, 1); // only Apr 28's first-day delta of 100
    assert.equal(deltas.get("2026-04-28"), 100);
  });
});

describe("buildVenueCumulativeTicketTimeline", () => {
  it("returns a sorted, monotonic timeline including the tier_channel_sales today anchor", () => {
    const snaps = [
      snapshot(MANCHESTER_IDS.croatia, "2026-04-28", 274, "xlsx_import"),
      snapshot(MANCHESTER_IDS.croatia, "2026-04-29", 246, "fourthefans"),
    ];
    const timeline = buildVenueCumulativeTicketTimeline(
      snaps,
      new Set([MANCHESTER_IDS.croatia]),
      {
        tierChannelAnchors: [
          { event_id: MANCHESTER_IDS.croatia, tickets: 602, revenue: 3612 },
        ],
        todayIso: "2026-05-09",
      },
    );
    // Sorted asc + monotonic + ends at the today anchor.
    assert.deepEqual(
      timeline.map((s) => s.date),
      ["2026-04-28", "2026-04-29", "2026-05-09"],
    );
    assert.deepEqual(
      timeline.map((s) => s.cumulative),
      [274, 274, 602],
    );
  });
});
