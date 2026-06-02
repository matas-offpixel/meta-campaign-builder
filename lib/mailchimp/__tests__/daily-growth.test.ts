/**
 * lib/mailchimp/__tests__/daily-growth.test.ts
 *
 * Unit tests for computeDailyGrowth pure helper.
 * Node.js native test runner — no bundler needed.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computeDailyGrowth } from "../daily-growth.ts";

describe("computeDailyGrowth", () => {
  test("returns nulls for empty snapshot array", () => {
    const result = computeDailyGrowth([]);
    assert.equal(result.dailyNew, null);
    assert.equal(result.compareToDate, null);
  });

  test("returns nulls for single snapshot", () => {
    const result = computeDailyGrowth([
      { email_subscribers: 1000, snapshot_at: "2026-06-01T00:00:00Z" },
    ]);
    assert.equal(result.dailyNew, null);
    assert.equal(result.compareToDate, null);
  });

  test("computes growth between two snapshots", () => {
    const result = computeDailyGrowth([
      { email_subscribers: 2996, snapshot_at: "2026-06-01T00:00:00Z" },
      { email_subscribers: 3006, snapshot_at: "2026-06-02T00:00:00Z" },
    ]);
    assert.equal(result.dailyNew, 10);
    assert.equal(result.compareToDate, "2026-06-01");
  });

  test("uses two most-recent snapshots for multi-day history", () => {
    const result = computeDailyGrowth([
      { email_subscribers: 100, snapshot_at: "2026-05-28T00:00:00Z" },
      { email_subscribers: 200, snapshot_at: "2026-05-29T00:00:00Z" },
      { email_subscribers: 210, snapshot_at: "2026-05-30T00:00:00Z" },
      { email_subscribers: 230, snapshot_at: "2026-05-31T00:00:00Z" },
      { email_subscribers: 2996, snapshot_at: "2026-06-01T00:00:00Z" },
      { email_subscribers: 3006, snapshot_at: "2026-06-02T00:00:00Z" },
    ]);
    // Should compare latest (3006) vs second-to-latest (2996), not baseline
    assert.equal(result.dailyNew, 10);
    assert.equal(result.compareToDate, "2026-06-01");
  });

  test("handles negative growth (churn)", () => {
    const result = computeDailyGrowth([
      { email_subscribers: 3100, snapshot_at: "2026-06-01T00:00:00Z" },
      { email_subscribers: 3006, snapshot_at: "2026-06-02T00:00:00Z" },
    ]);
    assert.equal(result.dailyNew, -94);
    assert.equal(result.compareToDate, "2026-06-01");
  });

  test("returns null dailyNew when either value is null", () => {
    const result = computeDailyGrowth([
      { email_subscribers: null, snapshot_at: "2026-06-01T00:00:00Z" },
      { email_subscribers: 3006, snapshot_at: "2026-06-02T00:00:00Z" },
    ]);
    assert.equal(result.dailyNew, null);
    // compareToDate still reflects the prev snapshot date
    assert.equal(result.compareToDate, "2026-06-01");
  });

  test("extracts YYYY-MM-DD from ISO timestamp", () => {
    const result = computeDailyGrowth([
      { email_subscribers: 1000, snapshot_at: "2026-05-31T23:59:59.999Z" },
      { email_subscribers: 1050, snapshot_at: "2026-06-02T12:30:00.000Z" },
    ]);
    assert.equal(result.compareToDate, "2026-05-31");
  });
});
