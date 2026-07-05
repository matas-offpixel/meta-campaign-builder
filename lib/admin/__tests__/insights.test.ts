import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCountryBreakdown,
  buildDailySeries,
  buildSocialSplit,
  computeMetrics,
  londonDay,
  type InsightSignupRow,
} from "../insights.ts";

const NOW = new Date("2026-07-05T02:30:00Z"); // 03:30 London (BST)

function row(overrides: Partial<InsightSignupRow> = {}): InsightSignupRow {
  return {
    createdAt: "2026-07-01T12:00:00Z",
    country: "GB",
    igHandle: null,
    ttHandle: null,
    waOptInAt: null,
    ...overrides,
  };
}

describe("londonDay", () => {
  it("buckets by London wall time, not UTC (BST)", () => {
    // 23:30 UTC on 4 Jul = 00:30 London on 5 Jul during BST.
    assert.equal(londonDay(new Date("2026-07-04T23:30:00Z")), "2026-07-05");
    assert.equal(londonDay(new Date("2026-07-04T22:30:00Z")), "2026-07-04");
  });

  it("matches UTC during GMT", () => {
    assert.equal(londonDay(new Date("2026-01-15T23:30:00Z")), "2026-01-15");
  });
});

describe("computeMetrics", () => {
  it("empty rows → zeros and null rate", () => {
    assert.deepEqual(computeMetrics([], NOW), {
      total: 0,
      today: 0,
      last7Days: 0,
      waOptInRatePct: null,
    });
  });

  it("counts today (London day), rolling week, and opt-in rate", () => {
    const rows = [
      // 23:30 UTC 4 Jul = London 5 Jul → today.
      row({ createdAt: "2026-07-04T23:30:00Z", waOptInAt: "2026-07-04T23:30:00Z" }),
      // 2 days ago → in week, not today.
      row({ createdAt: "2026-07-03T10:00:00Z" }),
      // 10 days ago → total only.
      row({ createdAt: "2026-06-25T10:00:00Z", waOptInAt: "2026-06-25T10:00:00Z" }),
      // Unparseable → counted in total, skipped elsewhere.
      row({ createdAt: "junk" }),
    ];
    assert.deepEqual(computeMetrics(rows, NOW), {
      total: 4,
      today: 1,
      last7Days: 2,
      waOptInRatePct: 50,
    });
  });
});

describe("buildDailySeries", () => {
  it("returns exactly N zero-filled London days ending today", () => {
    const series = buildDailySeries([], NOW, 30);
    assert.equal(series.length, 30);
    assert.equal(series[29].day, "2026-07-05");
    assert.equal(series[0].day, "2026-06-06");
    assert.ok(series.every((p) => p.count === 0));
  });

  it("counts rows into London day buckets", () => {
    const rows = [
      row({ createdAt: "2026-07-04T23:30:00Z" }), // London 5 Jul
      row({ createdAt: "2026-07-04T10:00:00Z" }), // London 4 Jul
      row({ createdAt: "2026-07-04T11:00:00Z" }), // London 4 Jul
      row({ createdAt: "2025-01-01T00:00:00Z" }), // outside window — ignored
    ];
    const series = buildDailySeries(rows, NOW, 30);
    const byDay = new Map(series.map((p) => [p.day, p.count]));
    assert.equal(byDay.get("2026-07-05"), 1);
    assert.equal(byDay.get("2026-07-04"), 2);
    assert.equal(series[29].label, "5 Jul");
  });
});

describe("buildCountryBreakdown", () => {
  it("empty → empty", () => {
    assert.deepEqual(buildCountryBreakdown([]), []);
  });

  it("sorts by count, buckets nulls as Unknown, adds Other beyond top N", () => {
    const rows = [
      ...Array.from({ length: 5 }, () => row({ country: "GB" })),
      ...Array.from({ length: 3 }, () => row({ country: "ES" })),
      row({ country: "PT" }),
      row({ country: null }),
    ];
    const slices = buildCountryBreakdown(rows, 2);
    assert.deepEqual(slices, [
      { country: "GB", count: 5, pct: 50 },
      { country: "ES", count: 3, pct: 30 },
      { country: "Other", count: 2, pct: 20 },
    ]);
  });

  it("ties break alphabetically for stable output", () => {
    const rows = [row({ country: "PT" }), row({ country: "ES" })];
    const slices = buildCountryBreakdown(rows, 10);
    assert.deepEqual(
      slices.map((s) => s.country),
      ["ES", "PT"],
    );
  });
});

describe("buildSocialSplit", () => {
  it("empty → null pct", () => {
    assert.deepEqual(buildSocialSplit([]), {
      ig: 0,
      tt: 0,
      total: 0,
      igPct: null,
    });
  });

  it("splits ig vs tt, ignoring rows with neither", () => {
    const rows = [
      row({ igHandle: "a" }),
      row({ igHandle: "b" }),
      row({ ttHandle: "c" }),
      row(),
    ];
    assert.deepEqual(buildSocialSplit(rows), {
      ig: 2,
      tt: 1,
      total: 3,
      igPct: 66.7,
    });
  });
});
