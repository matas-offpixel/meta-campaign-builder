/**
 * lib/mailchimp/__tests__/trend-data.test.ts
 *
 * Unit tests for computeMailchimpTrendPoints — pure, no DB or server-only deps.
 *
 * Key semantics after PR #504 fix:
 *  - newRegs  = absolute total subscribers (not delta from baseline)
 *  - cpr      = cumulativeSpend / totalSubscribers  (matches MAILCHIMP AUDIENCE card)
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

    // Day 1: absolute subs = 500; cumulative spend = 50; cpr = 50/500 = 0.1
    assert.equal(result[0]!.date, "2026-06-01");
    assert.equal(result[0]!.newRegs, 500);
    assert.ok(result[0]!.cpr !== null);
    assert.ok(Math.abs(result[0]!.cpr! - 0.1) < 0.001);

    // Day 2: carried forward 500 subs; cumulative spend = 80; cpr = 80/500 = 0.16
    assert.equal(result[1]!.date, "2026-06-02");
    assert.equal(result[1]!.newRegs, 500);
    assert.ok(Math.abs(result[1]!.cpr! - 0.16) < 0.001);

    // Day 3: absolute subs = 600; cumulative spend = 100; cpr = 100/600 ≈ 0.1667
    assert.equal(result[2]!.date, "2026-06-03");
    assert.equal(result[2]!.newRegs, 600);
    assert.ok(result[2]!.cpr !== null);
    assert.ok(Math.abs(result[2]!.cpr! - 100 / 600) < 0.001);
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
    // Day 3: snapshot arrives — absolute = 500; cumulative spend = 100; cpr = 100/500 = 0.2
    assert.equal(result[2]!.newRegs, 500);
    assert.ok(Math.abs(result[2]!.cpr! - 0.2) < 0.001);
  });

  it("computes cumulative spend across platforms", () => {
    const snapshots = [
      snap("2026-06-01", 500),
      snap("2026-06-02", 600),
    ];
    const timeline = [
      row("2026-06-01", 100, 50), // meta 100 + tiktok 50 = 150
      row("2026-06-02", 200, 0),  // cumulative = 350
    ];
    const result = computeMailchimpTrendPoints(snapshots, timeline);

    // Day 2: absolute subs = 600; cumulative spend = 350; cpr = 350/600 ≈ 0.5833
    assert.equal(result[1]!.newRegs, 600);
    assert.ok(Math.abs(result[1]!.cpr! - 350 / 600) < 0.001);
  });

  it("handles null email_subscribers gracefully", () => {
    const snapshots = [
      { snapshot_at: "2026-06-01T09:00:00Z", email_subscribers: null },
      { snapshot_at: "2026-06-02T09:00:00Z", email_subscribers: 600 },
    ];
    const timeline = [row("2026-06-01", 50), row("2026-06-02", 50)];
    const result = computeMailchimpTrendPoints(snapshots, timeline);
    // Day 2: snapshot with 600 subs — absolute = 600
    assert.equal(result[1]!.newRegs, 600);
  });

  it("Ironworks fixture: CPR = totalSpend / totalSubscribers", () => {
    // Simplified version of the Ironworks scenario:
    // 3,006 total subscribers, £3,573.61 cross-platform spend → CPR ≈ £1.19
    const totalSpend = 3573.61;
    const totalSubs = 3006;
    const snapshots = [snap("2026-05-01", 2996), snap("2026-06-02", totalSubs)];
    const timeline = [
      row("2026-05-01", 2000),
      row("2026-06-02", 1573.61),
    ];
    const result = computeMailchimpTrendPoints(snapshots, timeline);
    const last = result[result.length - 1]!;
    assert.equal(last.newRegs, totalSubs);
    // CPR should be ~1.188, NOT 357.36 (the old delta-based bug value)
    assert.ok(last.cpr !== null);
    assert.ok(Math.abs(last.cpr! - totalSpend / totalSubs) < 0.01);
    assert.ok(last.cpr! < 2, "CPR should be ~£1.19, not hundreds");
  });
});
