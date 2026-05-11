import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aggregateTrendChartPoints,
  hasCumulativeTicketPoints,
  summarizeTrendChartPoints,
  type TrendChartPoint,
} from "../trend-chart-data.ts";

describe("trend chart aggregation", () => {
  it("uses latest cumulative ticket snapshot for weekly buckets", () => {
    const points: TrendChartPoint[] = [
      {
        date: "2026-04-20",
        spend: null,
        tickets: 188,
        revenue: null,
        linkClicks: null,
        ticketsKind: "cumulative_snapshot",
      },
      ...Array.from({ length: 7 }, (_, i): TrendChartPoint => ({
        date: `2026-04-${String(20 + i).padStart(2, "0")}`,
        spend: 10,
        tickets: null,
        revenue: null,
        linkClicks: 100,
      })),
    ];

    const weekly = aggregateTrendChartPoints(points, "weekly");

    assert.equal(weekly.length, 1);
    assert.equal(weekly[0]?.spend, 70);
    assert.equal(weekly[0]?.tickets, 188);
    assert.equal(weekly[0]?.linkClicks, 700);
  });

  it("carries cumulative tickets into later daily/weekly buckets", () => {
    const points: TrendChartPoint[] = [
      {
        date: "2026-04-20",
        spend: null,
        tickets: 517,
        revenue: null,
        linkClicks: null,
        ticketsKind: "cumulative_snapshot",
      },
      { date: "2026-04-27", spend: 20, tickets: null, revenue: null, linkClicks: 10 },
      { date: "2026-04-28", spend: 23.88, tickets: null, revenue: null, linkClicks: 12 },
    ];

    const daily = aggregateTrendChartPoints(points, "daily");
    const weekly = aggregateTrendChartPoints(points, "weekly");

    assert.equal(daily.at(-1)?.tickets, 517);
    assert.equal(weekly.at(-1)?.tickets, 517);
    assert.equal(Number(weekly.at(-1)?.spend?.toFixed(2)), 43.88);
  });

  it("summarizes Bristol-style pills as lifetime totals and averages", () => {
    const points: TrendChartPoint[] = [
      {
        date: "2026-04-20",
        spend: null,
        tickets: 517,
        revenue: null,
        linkClicks: null,
        ticketsKind: "cumulative_snapshot",
      },
      { date: "2026-04-21", spend: 2031.06, tickets: null, revenue: null, linkClicks: 900 },
      { date: "2026-04-22", spend: 441.17, tickets: null, revenue: null, linkClicks: 1028 },
    ];

    const weekly = aggregateTrendChartPoints(points, "weekly");
    const summary = summarizeTrendChartPoints(
      weekly,
      hasCumulativeTicketPoints(points),
    );

    assert.equal(summary.spend, 2472.23);
    assert.equal(summary.tickets, 517);
    assert.equal(summary.linkClicks, 1928);
    assert.equal(Number(summary.cpt?.toFixed(2)), 4.78);
    assert.equal(Number(summary.cpc?.toFixed(2)), 1.28);
  });

  it("trims leading and trailing all-null dates without removing middle gaps", () => {
    const points: TrendChartPoint[] = [
      { date: "2026-02-28", spend: null, tickets: null, revenue: null, linkClicks: null },
      { date: "2026-03-01", spend: null, tickets: null, revenue: null, linkClicks: null },
      { date: "2026-04-02", spend: 53.53, tickets: null, revenue: null, linkClicks: 515 },
      { date: "2026-04-03", spend: null, tickets: null, revenue: null, linkClicks: null },
      { date: "2026-04-04", spend: 54, tickets: null, revenue: null, linkClicks: 520 },
      { date: "2026-04-05", spend: null, tickets: null, revenue: null, linkClicks: null },
    ];

    const daily = aggregateTrendChartPoints(points, "daily");

    assert.deepEqual(
      daily.map((day) => day.date),
      ["2026-04-02", "2026-04-03", "2026-04-04"],
    );
    assert.equal(daily[1]?.spend, null);
  });

  it("does not let synthetic cumulative ticket snapshots anchor the trimmed range", () => {
    const points: TrendChartPoint[] = [
      {
        date: "2026-01-12",
        spend: null,
        tickets: 517,
        revenue: null,
        linkClicks: null,
        ticketsKind: "cumulative_snapshot",
      },
      { date: "2026-02-28", spend: null, tickets: null, revenue: null, linkClicks: null },
      { date: "2026-04-02", spend: 53.53, tickets: null, revenue: null, linkClicks: 515 },
      { date: "2026-04-03", spend: null, tickets: null, revenue: null, linkClicks: null },
    ];

    const daily = aggregateTrendChartPoints(points, "daily");

    assert.deepEqual(
      daily.map((day) => day.date),
      ["2026-04-02"],
    );
    assert.equal(daily[0]?.tickets, 517);
  });

  it("trims leading zero-value days (backfill rows), keeps real spend days", () => {
    // Canonical case: Dublin event backfilled ~80 days of {spend:0, revenue:0,
    // tickets:0, linkClicks:0} numeric zeros starting 7 Feb. First real spend
    // day is 2 May. Chart must start on 2 May, not 7 Feb.
    const leadingZeros: TrendChartPoint[] = Array.from(
      { length: 80 },
      (_, i): TrendChartPoint => {
        const d = new Date("2026-02-07T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + i);
        return {
          date: d.toISOString().slice(0, 10),
          spend: 0,
          tickets: 0,
          revenue: 0,
          linkClicks: 0,
        };
      },
    );
    const realDays: TrendChartPoint[] = [
      { date: "2026-05-02", spend: 45.5, tickets: 3, revenue: 150, linkClicks: 210 },
      { date: "2026-05-03", spend: 31.2, tickets: 2, revenue: 80, linkClicks: 140 },
      { date: "2026-05-04", spend: 0, tickets: 0, revenue: 0, linkClicks: 0 },
      { date: "2026-05-05", spend: 28.7, tickets: 1, revenue: 40, linkClicks: 95 },
      { date: "2026-05-06", spend: 0, tickets: 0, revenue: 0, linkClicks: 0 },
    ];
    const points = [...leadingZeros, ...realDays];

    const daily = aggregateTrendChartPoints(points, "daily");

    // Must start at first real spend day, not at the first backfill row
    assert.equal(daily[0]?.date, "2026-05-02");
    // Trailing zero (2026-05-06) is also trimmed; middle zero (2026-05-04)
    // between real-spend days is kept → 4 rows: 02, 03, 04, 05
    assert.equal(daily.length, 4);
    assert.equal(daily.at(-1)?.date, "2026-05-05");
    // Sanity: first day has the right spend
    assert.equal(daily[0]?.spend, 45.5);
  });

  it("returns no days when only cumulative ticket snapshots exist", () => {
    const points: TrendChartPoint[] = [
      {
        date: "2026-01-12",
        spend: null,
        tickets: 517,
        revenue: null,
        linkClicks: null,
        ticketsKind: "cumulative_snapshot",
      },
    ];

    assert.deepEqual(aggregateTrendChartPoints(points, "daily"), []);
  });

  // ─── PR fix/venue-trend-tier-channel-snapshot ─────────────────────────────
  //
  // Manchester WC26 tooltip bug: in cumulative mode the per-day CPT was
  // computed as (today's spend / cumulative tickets carried forward),
  // mixing daily and lifetime denominators. Tooltip on Mon 4 May read
  // "Spend £92.86, Tickets 843, CPT £0.11" — meaningless. The fix uses
  // lifetime spend through that date / cumulative tickets through that
  // date so the tooltip is always interpretable as "running CPT".

  describe("lifetime/lifetime CPT in cumulative mode", () => {
    it("uses running spend ÷ cumulative tickets for per-day CPT", () => {
      const points: TrendChartPoint[] = [
        {
          date: "2026-04-20",
          spend: 100,
          tickets: 200,
          revenue: null,
          linkClicks: null,
          ticketsKind: "cumulative_snapshot",
        },
        // Carry-forward day: no fresh ticket snapshot but daily spend.
        { date: "2026-04-21", spend: 200, tickets: null, revenue: null, linkClicks: null },
        {
          date: "2026-04-22",
          spend: null,
          tickets: 400,
          revenue: null,
          linkClicks: null,
          ticketsKind: "cumulative_snapshot",
        },
      ];

      const daily = aggregateTrendChartPoints(points, "daily");
      assert.equal(daily.length, 3);

      // Day 0: spend=100, tickets=200 → CPT = 100 / 200 = 0.5
      assert.equal(daily[0]?.cpt, 0.5);

      // Day 1: lifetime spend = 100 + 200 = 300, cumulative tickets carries
      // 200 forward → CPT = 300 / 200 = 1.5 (NOT 200 / 200 = 1 — that
      // would be the broken per-day-spend-over-cumulative-tickets calc)
      assert.equal(daily[1]?.cpt, 1.5);

      // Day 2: lifetime spend still 300 (no spend), cumulative tickets
      // jumps to 400 → CPT = 300 / 400 = 0.75
      assert.equal(daily[2]?.cpt, 0.75);
    });

    it("Manchester scenario: Mon 4 May tooltip CPT == lifetime spend / cumulative tickets through Mon 4 May", () => {
      // Each prior day adds a small amount of spend; tickets snapshot
      // every few days. The tooltip we used to render said
      // "£92.86 / 843 = £0.11" — wrong. The correct value is the running
      // spend / cumulative tickets carry-forward through that date.
      const points: TrendChartPoint[] = [
        {
          date: "2026-04-28",
          spend: 50,
          tickets: 600,
          revenue: null,
          linkClicks: null,
          ticketsKind: "cumulative_snapshot",
        },
        { date: "2026-04-29", spend: 60, tickets: null, revenue: null, linkClicks: null },
        { date: "2026-04-30", spend: 70, tickets: null, revenue: null, linkClicks: null },
        {
          date: "2026-05-01",
          spend: 80,
          tickets: 720,
          revenue: null,
          linkClicks: null,
          ticketsKind: "cumulative_snapshot",
        },
        { date: "2026-05-02", spend: 85, tickets: null, revenue: null, linkClicks: null },
        { date: "2026-05-03", spend: 90, tickets: null, revenue: null, linkClicks: null },
        {
          date: "2026-05-04",
          spend: 92.86,
          tickets: 843,
          revenue: null,
          linkClicks: null,
          ticketsKind: "cumulative_snapshot",
        },
      ];

      const daily = aggregateTrendChartPoints(points, "daily");
      const may4 = daily.find((d) => d.date === "2026-05-04");
      assert.ok(may4, "Mon 4 May should be in the daily array");
      // Running spend through May 4 = 50 + 60 + 70 + 80 + 85 + 90 + 92.86 = 527.86
      // Cumulative tickets May 4 = 843
      // CPT = 527.86 / 843 ≈ 0.626
      const expected = 527.86 / 843;
      assert.ok(
        may4.cpt != null && Math.abs(may4.cpt - expected) < 0.001,
        `CPT should be ${expected.toFixed(3)}, got ${may4.cpt}`,
      );

      // Demonstrate the OLD broken value: per-day spend (£92.86) /
      // cumulative tickets (843) ≈ £0.11. The new value must NOT equal
      // that.
      const brokenValue = 92.86 / 843;
      assert.ok(
        Math.abs((may4.cpt ?? 0) - brokenValue) > 0.01,
        `CPT must not match the broken per-day/cumulative formula (≈${brokenValue.toFixed(3)})`,
      );
    });

    it("weekly CPT also uses lifetime spend / cumulative tickets at week-end", () => {
      // Two weeks: week 1 spend 100 + tickets cumulative 200,
      // week 2 spend 200 + tickets cumulative 400. Weekly CPT for week
      // 2 must be (100+200)/400 = 0.75, not 200/400 = 0.5.
      const points: TrendChartPoint[] = [
        {
          date: "2026-04-20",
          spend: 50,
          tickets: 100,
          revenue: null,
          linkClicks: null,
          ticketsKind: "cumulative_snapshot",
        },
        { date: "2026-04-21", spend: 50, tickets: null, revenue: null, linkClicks: null },
        {
          date: "2026-04-26",
          spend: null,
          tickets: 200,
          revenue: null,
          linkClicks: null,
          ticketsKind: "cumulative_snapshot",
        },
        { date: "2026-04-27", spend: 100, tickets: null, revenue: null, linkClicks: null },
        { date: "2026-04-28", spend: 100, tickets: null, revenue: null, linkClicks: null },
        {
          date: "2026-05-03",
          spend: null,
          tickets: 400,
          revenue: null,
          linkClicks: null,
          ticketsKind: "cumulative_snapshot",
        },
      ];

      const weekly = aggregateTrendChartPoints(points, "weekly");
      assert.equal(weekly.length, 2);

      // Week 1 (w/c Apr 20): spend = 100, tickets = 200 → CPT = 0.5
      assert.equal(weekly[0]?.cpt, 0.5);

      // Week 2 (w/c Apr 27): running spend = 100 + 200 = 300,
      // cumulative tickets at week-end = 400 → CPT = 0.75
      assert.equal(weekly[1]?.cpt, 0.75);
    });
  });
});

// ─── BUG-4: trimEmptyRange — cumulative-snapshot leading-zero trim ──────────

describe("trimEmptyRange (BUG-4): cumulative-snapshot mode leading-zero handling", () => {
  // Simulates the CL Final pattern: ticket_sales_snapshots rows with
  // tickets_sold=0 stretching back from Dec 25 (when 4TF started tracking)
  // plus some early link_click awareness activity, before actual spend +
  // tickets arrive in April.

  it("trims leading days with linkClicks-only awareness activity (no spend) — CL Final pattern", () => {
    // CL Final: ticket_sales_snapshots from Dec 25 (tickets=0), some early
    // linkClicks from awareness Meta campaigns, spend only starts Apr 19.
    // Before BUG-4 fix: linkClicks > 0 anchored Dec 25 → X-axis showed Dec 25.
    // After fix: only spend > 0 anchors cumulative mode → X-axis starts Apr 19.
    const points: TrendChartPoint[] = [
      // Dec 25 – Apr 18: snapshot rows with 0 tickets, no spend, some link clicks
      ...Array.from({ length: 115 }, (_, i): TrendChartPoint => {
        const d = new Date("2025-12-25T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + i);
        return {
          date: d.toISOString().slice(0, 10),
          spend: null,
          tickets: 0,
          revenue: null,
          linkClicks: i < 30 ? 50 : null, // early awareness link clicks (Jan)
          ticketsKind: "cumulative_snapshot",
        };
      }),
      // Apr 19: first spend day (campaign launches)
      {
        date: "2026-04-19",
        spend: 100,
        tickets: 0,
        revenue: null,
        linkClicks: null,
        ticketsKind: "cumulative_snapshot",
      },
      // May 10: first actual ticket sales
      {
        date: "2026-05-10",
        spend: 80,
        tickets: 411,
        revenue: null,
        linkClicks: null,
        ticketsKind: "cumulative_snapshot",
      },
    ];

    const daily = aggregateTrendChartPoints(points, "daily");

    // X-axis must start from first spend day (Apr 19), NOT Dec 25
    assert.ok(daily.length > 0, "should return non-empty");
    assert.equal(
      daily[0]?.date,
      "2026-04-19",
      `X-axis should start at 2026-04-19 (first spend day), got ${daily[0]?.date}`,
    );

    // linkClicks on Dec 25 – Jan 23 must NOT cause the range to extend back
    const dec25 = daily.find((d) => d.date === "2025-12-25");
    assert.equal(dec25, undefined, "Dec 25 (linkClicks-only, tickets=0) should be trimmed");

    const jan15 = daily.find((d) => d.date === "2026-01-15");
    assert.equal(jan15, undefined, "Jan 15 (linkClicks-only day) should also be trimmed");
  });

  it("cumulative-snapshot tickets-only days (no spend) do not anchor the start — existing guard preserved", () => {
    // Ticket tracking (4TF cron) may predate the Meta campaign by months.
    // tickets=517 from Jan should NOT pull the chart start to Jan.
    const points: TrendChartPoint[] = [
      {
        date: "2026-01-12",
        spend: null,
        tickets: 517,
        revenue: null,
        linkClicks: null,
        ticketsKind: "cumulative_snapshot",
      },
      // First real spend day is Apr 2
      { date: "2026-04-02", spend: 53.53, tickets: null, revenue: null, linkClicks: 515 },
      { date: "2026-04-03", spend: null, tickets: null, revenue: null, linkClicks: null },
    ];
    const daily = aggregateTrendChartPoints(points, "daily");
    // Preserving existing PR #339 guard: cumulative ticket snapshot alone
    // does NOT anchor the start in cumulative mode.
    assert.equal(
      daily[0]?.date,
      "2026-04-02",
      "cumulative tickets-only day should not anchor; start must be first spend day",
    );
    // The Jan 12 snapshot's tickets DO carry forward into the trimmed range
    assert.equal(daily[0]?.tickets, 517, "cumulative ticket value carries forward into range");
  });

  it("additive mode still uses linkClicks as anchor (no regression)", () => {
    const points: TrendChartPoint[] = [
      // additive (no ticketsKind tag)
      { date: "2026-01-01", spend: null, tickets: null, revenue: null, linkClicks: 200 },
      { date: "2026-01-05", spend: 100, tickets: 20, revenue: null, linkClicks: null },
    ];

    const daily = aggregateTrendChartPoints(points, "daily");

    // In additive mode, linkClicks>0 is a valid anchor
    assert.equal(
      daily[0]?.date,
      "2026-01-01",
      "additive mode: linkClicks>0 should anchor start (no regression)",
    );
  });
});
