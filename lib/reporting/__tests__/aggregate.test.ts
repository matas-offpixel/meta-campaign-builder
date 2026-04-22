// ─────────────────────────────────────────────────────────────────────────────
// Aggregate calculator tests.
//
// Run with:  node --experimental-strip-types --test lib/reporting/__tests__
// (Node 22.6+ strips TS at runtime; matches the lib/pricing test harness.)
// ─────────────────────────────────────────────────────────────────────────────

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { aggregate } from "../aggregate.ts";

describe("aggregate", () => {
  it("returns null ratios for an empty list", () => {
    const r = aggregate([]);
    assert.equal(r.spend, 0);
    assert.equal(r.impressions, 0);
    assert.equal(r.clicks, 0);
    assert.equal(r.results, 0);
    assert.equal(r.ctr, null);
    assert.equal(r.cpr, null);
    assert.equal(r.cpm, null);
  });

  it("sums totals and computes weighted ratios", () => {
    const r = aggregate([
      { spend: 100, impressions: 10_000, clicks: 200, results: 5 },
      { spend: 200, impressions: 30_000, clicks: 400, results: 10 },
    ]);
    assert.equal(r.spend, 300);
    assert.equal(r.impressions, 40_000);
    assert.equal(r.clicks, 600);
    assert.equal(r.results, 15);
    // CTR = 600 / 40_000 = 0.015 → 1.5%
    assert.equal(r.ctr, 1.5);
    // CPM = 300 / 40_000 * 1000 = 7.5
    assert.equal(r.cpm, 7.5);
    // CPR = 300 / 15 = 20
    assert.equal(r.cpr, 20);
  });

  it("uses sum-then-divide (not mean-of-means)", () => {
    // Two campaigns: one tiny + great, one huge + bad.
    // mean-of-means CTR = (5% + 1%) / 2 = 3%
    // sum-then-divide CTR = (50 + 1000) / (1000 + 100_000) ≈ 1.04%
    const r = aggregate([
      { spend: 5, impressions: 1_000, clicks: 50, results: 1 },
      { spend: 500, impressions: 100_000, clicks: 1_000, results: 5 },
    ]);
    assert.ok(
      r.ctr !== null && r.ctr < 1.1 && r.ctr > 1.0,
      `expected ~1.04% weighted CTR, got ${r.ctr}`,
    );
  });

  it("ignores non-finite numbers without throwing", () => {
    const r = aggregate([
      { spend: Number.NaN, impressions: 1_000, clicks: 10, results: 1 },
      { spend: 100, impressions: Number.POSITIVE_INFINITY, clicks: 5, results: 0 },
    ]);
    assert.equal(r.spend, 100);
    assert.equal(r.impressions, 1_000);
    assert.equal(r.clicks, 15);
    assert.equal(r.results, 1);
    assert.equal(r.cpr, 100);
  });
});
