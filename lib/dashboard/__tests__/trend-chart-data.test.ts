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
});
