/**
 * Unit tests for the TikTok snapshot helper logic used in event-report-view.tsx.
 *
 * These tests cover:
 *  - Dimension value formatting (age brackets, gender, interest IDs)
 *  - Creative row filtering + sorting behaviour
 *  - Breakdown row filtering per dimension type
 *
 * Pure-function focus: no React / jsdom required. Consistent with the project's
 * existing test patterns (node --test, no RTL).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  TikTokSnapshotBreakdown,
  TikTokSnapshotCreative,
} from "../event-report-view";

// ─── Inline copies of the private helpers under test ──────────────────────
// These mirror the exact logic in event-report-view.tsx. When the component
// logic changes, update these in tandem.

function fmtDimensionValue(dimension: string, value: string): string {
  if (dimension === "age") {
    const match = /^AGE_(\d+)_(\d+)$/.exec(value);
    if (match) {
      const [, lo, hi] = match;
      return Number(hi) >= 100 ? `${lo}+` : `${lo}–${hi}`;
    }
    return value;
  }
  if (dimension === "gender") {
    if (value === "MALE") return "Male";
    if (value === "FEMALE") return "Female";
    return value;
  }
  if (dimension === "interest_category") {
    return `Segment #${value}`;
  }
  return value;
}

function sortCreativesBySpend(
  creatives: TikTokSnapshotCreative[],
): TikTokSnapshotCreative[] {
  return [...creatives]
    .filter((c) => (c.spend ?? 0) > 0 || (c.impressions ?? 0) > 0)
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
}

function filterBreakdownsByDimension(
  rows: TikTokSnapshotBreakdown[],
  dimension: string,
): TikTokSnapshotBreakdown[] {
  if (dimension === "age") {
    return rows.filter(
      (r) => r.dimension === "age" && r.dimension_value !== "NONE",
    );
  }
  if (dimension === "gender") {
    return rows.filter(
      (r) => r.dimension === "gender" && r.dimension_value !== "NONE",
    );
  }
  if (dimension === "geo") {
    return rows.filter(
      (r) => r.dimension === "country" || r.dimension === "region",
    );
  }
  return rows.filter((r) => r.dimension === dimension);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("fmtDimensionValue — age brackets", () => {
  it("formats standard age range", () => {
    assert.equal(fmtDimensionValue("age", "AGE_25_34"), "25–34");
  });

  it("formats youngest bracket", () => {
    assert.equal(fmtDimensionValue("age", "AGE_18_24"), "18–24");
  });

  it("formats 55+ (upper bound ≥100 → plus suffix)", () => {
    assert.equal(fmtDimensionValue("age", "AGE_55_100"), "55+");
  });

  it("returns raw value for unrecognised age string", () => {
    assert.equal(fmtDimensionValue("age", "NONE"), "NONE");
  });
});

describe("fmtDimensionValue — gender", () => {
  it("capitalises MALE", () => {
    assert.equal(fmtDimensionValue("gender", "MALE"), "Male");
  });

  it("capitalises FEMALE", () => {
    assert.equal(fmtDimensionValue("gender", "FEMALE"), "Female");
  });

  it("returns raw value for NONE", () => {
    assert.equal(fmtDimensionValue("gender", "NONE"), "NONE");
  });
});

describe("fmtDimensionValue — interest_category", () => {
  it("prefixes with Segment #", () => {
    assert.equal(fmtDimensionValue("interest_category", "114"), "Segment #114");
  });

  it("passes through country codes unchanged", () => {
    assert.equal(fmtDimensionValue("country", "GB"), "GB");
  });
});

describe("sortCreativesBySpend", () => {
  const makeCreative = (
    ad_id: string,
    spend: number | null,
    impressions: number | null = null,
  ): TikTokSnapshotCreative => ({
    ad_id,
    ad_name: ad_id,
    campaign_id: null,
    campaign_name: null,
    spend,
    impressions,
    reach: null,
    clicks: null,
    ctr: null,
    video_views_2s: null,
    video_views_6s: null,
    video_views_100p: null,
    thumbnail_url: null,
    deeplink_url: null,
  });

  it("sorts by spend descending", () => {
    const input = [
      makeCreative("a", 50),
      makeCreative("b", 120),
      makeCreative("c", 80),
    ];
    const result = sortCreativesBySpend(input).map((c) => c.ad_id);
    assert.deepEqual(result, ["b", "c", "a"]);
  });

  it("filters out rows with zero spend AND zero impressions", () => {
    const input = [
      makeCreative("zero", 0, 0),
      makeCreative("live", 25),
      makeCreative("null_both", null, null),
    ];
    const result = sortCreativesBySpend(input).map((c) => c.ad_id);
    assert.deepEqual(result, ["live"]);
  });

  it("keeps rows with null spend but non-zero impressions", () => {
    const input = [makeCreative("no_spend", null, 1000)];
    assert.equal(sortCreativesBySpend(input).length, 1);
  });

  it("returns empty array when all rows have zero signal", () => {
    const input = [makeCreative("z", 0, 0)];
    assert.equal(sortCreativesBySpend(input).length, 0);
  });
});

describe("filterBreakdownsByDimension", () => {
  const makeRow = (
    dimension: string,
    dimension_value: string,
  ): TikTokSnapshotBreakdown => ({
    dimension,
    dimension_value,
    spend: 100,
    impressions: 500,
    reach: null,
    clicks: 10,
    ctr: 2.0,
  });

  it("filters age rows and excludes NONE", () => {
    const rows = [
      makeRow("age", "AGE_25_34"),
      makeRow("age", "NONE"),
      makeRow("gender", "MALE"),
    ];
    const result = filterBreakdownsByDimension(rows, "age");
    assert.equal(result.length, 1);
    assert.equal(result[0].dimension_value, "AGE_25_34");
  });

  it("filters gender rows and excludes NONE", () => {
    const rows = [
      makeRow("gender", "MALE"),
      makeRow("gender", "NONE"),
      makeRow("age", "AGE_18_24"),
    ];
    const result = filterBreakdownsByDimension(rows, "gender");
    assert.equal(result.length, 1);
    assert.equal(result[0].dimension_value, "MALE");
  });

  it("filters geo rows (country + region)", () => {
    const rows = [
      makeRow("country", "GB"),
      makeRow("region", "England"),
      makeRow("age", "AGE_25_34"),
    ];
    const result = filterBreakdownsByDimension(rows, "geo");
    assert.equal(result.length, 2);
    assert.ok(result.every((r) => r.dimension === "country" || r.dimension === "region"));
  });

  it("returns empty array when no rows match", () => {
    const rows = [makeRow("age", "AGE_25_34")];
    assert.equal(filterBreakdownsByDimension(rows, "interest_category").length, 0);
  });
});
