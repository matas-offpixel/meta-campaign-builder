/**
 * lib/mailchimp/__tests__/trend-data.test.ts
 *
 * Unit tests for computeMailchimpTrendPoints — pure, no DB or server-only deps.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeMailchimpTrendPoints } from "../trend-data.ts";

const snap = (date: string, subs: number) => ({
  snapshot_at: `${date}T09:00:00Z`,
  email_subscribers: subs,
});

const row = (date: string, metaSpend: number, tiktokSpend: number = 0) => ({
  date,
  ad_spend: metaSpend,
  ad_spend_allocated: null,
  ad_spend_presale: null,
  tiktok_spend: tiktokSpend,
  google_ads_spend: null,
});

describe("computeMailchimpTrendPoints", () => {
  it("returns empty array when snapshots is empty", () => {
    const result = computeMailchimpTrendPoints([], [row("2026-06-01", 100)]);
    assert.deepEqual(result, []);
  });

  it("returns empty array when timeline is empty", () => {
    const result = computeMailchimpTrendPoints([snap("2026-06-01", 500)], []);
    assert.deepEqual(result, []);
  });

  it("carries forward the most recent snapshot between days", () => {
    const snapshots = [
      snap("2026-06-01", 500),
      snap("2026-06-03", 600), // +100 subscribers by day 3
    ];
    const timeline = [
      row("2026-06-01", 50),
      row("2026-06-02", 30), // no snapshot this day
      row("2026-06-03", 20),
    ];
    const result = computeMailchimpTrendPoints(snapshots, timeline);

    // Day 1: newRegs = 500 - 500 = 0; cumulative spend = 50; cpr = null (newRegs <= 0)
    assert.equal(result[0]!.date, "2026-06-01");
    assert.equal(result[0]!.newRegs, 0);
    assert.equal(result[0]!.cpr, null);

    // Day 2: carried forward 500 subs; newRegs = 500 - 500 = 0; cumulative spend = 80
    assert.equal(result[1]!.date, "2026-06-02");
    assert.equal(result[1]!.newRegs, 0);
    assert.equal(result[1]!.cpr, null);

    // Day 3: 600 subs; newRegs = 600 - 500 = 100; cumulative spend = 100; cpr = 100/100 = 1
    assert.equal(result[2]!.date, "2026-06-03");
    assert.equal(result[2]!.newRegs, 100);
    assert.ok(result[2]!.cpr !== null);
    assert.ok(Math.abs(result[2]!.cpr! - 1.0) < 0.001);
  });

  it("returns null for newRegs on days before first snapshot", () => {
    const snapshots = [snap("2026-06-03", 500)];
    const timeline = [
      row("2026-06-01", 50),
      row("2026-06-02", 30),
      row("2026-06-03", 20),
    ];
    const result = computeMailchimpTrendPoints(snapshots, timeline);

    assert.equal(result[0]!.newRegs, null);
    assert.equal(result[0]!.cpr, null);
    assert.equal(result[1]!.newRegs, null);
    // Day 3: snapshot arrives, newRegs = 0 (baseline = first snap = 500)
    assert.equal(result[2]!.newRegs, 0);
  });

  it("computes cumulative spend across platforms", () => {
    const snapshots = [
      snap("2026-06-01", 500),
      snap("2026-06-02", 600), // +100 regs
    ];
    const timeline = [
      row("2026-06-01", 100, 50), // meta 100 + tiktok 50 = 150
      row("2026-06-02", 200, 0),  // cumulative = 350
    ];
    const result = computeMailchimpTrendPoints(snapshots, timeline);

    // Day 2: newRegs = 100; cumulative spend = 350; cpr = 350/100 = 3.5
    assert.equal(result[1]!.newRegs, 100);
    assert.ok(Math.abs(result[1]!.cpr! - 3.5) < 0.001);
  });

  it("handles null email_subscribers gracefully", () => {
    const snapshots = [
      { snapshot_at: "2026-06-01T09:00:00Z", email_subscribers: null },
      { snapshot_at: "2026-06-02T09:00:00Z", email_subscribers: 600 },
    ];
    const timeline = [row("2026-06-01", 50), row("2026-06-02", 50)];
    const result = computeMailchimpTrendPoints(snapshots, timeline);
    // baseline is null → treated as 0; day 2 newRegs = 600 - 0 = 600
    assert.equal(result[1]!.newRegs, 600);
  });
});
