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
});
