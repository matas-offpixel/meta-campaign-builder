/**
 * lib/mailchimp/__tests__/trend-data.test.ts
 *
 * Unit tests for computeMailchimpTrendPoints — pure, no DB or server-only deps.
 *
 * Key semantics after PR #507 fix:
 *  - newRegs  = absolute total subscribers (not delta from baseline)
 *  - cpr      = FLAT lifetime line: lifetimeTotalSpend / latestTotalSubscribers
 *               Same value for every data point — matches the MAILCHIMP AUDIENCE
 *               card header and acts as a reference line on the trend chart.
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

    // lifetimeTotalSpend = 50 + 30 + 20 = 100; latestSubs = 600 (last snapshot)
    // lifetimeCPR = 100 / 600 ≈ 0.1667 — same for every data point
    const lifetimeCPR = 100 / 600;

    // Day 1: absolute subs = 500 (first snapshot); cpr = lifetime constant
    assert.equal(result[0]!.date, "2026-06-01");
    assert.equal(result[0]!.newRegs, 500);
    assert.ok(result[0]!.cpr !== null);
    assert.ok(Math.abs(result[0]!.cpr! - lifetimeCPR) < 0.001);

    // Day 2: carried forward 500 subs; cpr = same lifetime constant
    assert.equal(result[1]!.date, "2026-06-02");
    assert.equal(result[1]!.newRegs, 500);
    assert.ok(Math.abs(result[1]!.cpr! - lifetimeCPR) < 0.001);

    // Day 3: absolute subs = 600; cpr = same lifetime constant
    assert.equal(result[2]!.date, "2026-06-03");
    assert.equal(result[2]!.newRegs, 600);
    assert.ok(result[2]!.cpr !== null);
    assert.ok(Math.abs(result[2]!.cpr! - lifetimeCPR) < 0.001);

    // All three data points share the same CPR value
    assert.ok(Math.abs(result[0]!.cpr! - result[1]!.cpr!) < 0.0001, "CPR is flat");
    assert.ok(Math.abs(result[1]!.cpr! - result[2]!.cpr!) < 0.0001, "CPR is flat");
  });

  it("returns null for newRegs and cpr on days before first snapshot", () => {
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
    // Day 3: snapshot arrives — absolute = 500; lifetimeCPR = 100/500 = 0.2
    assert.equal(result[2]!.newRegs, 500);
    assert.ok(Math.abs(result[2]!.cpr! - 0.2) < 0.001);
  });

  it("computes lifetime spend across platforms (all days, all platforms)", () => {
    const snapshots = [
      snap("2026-06-01", 500),
      snap("2026-06-02", 600),
    ];
    const timeline = [
      row("2026-06-01", 100, 50), // meta 100 + tiktok 50 = 150
      row("2026-06-02", 200, 0),  // day 2 = 200; lifetime = 350
    ];
    const result = computeMailchimpTrendPoints(snapshots, timeline);

    // lifetimeCPR = (150 + 200) / 600 = 350/600 ≈ 0.5833 — same for both days
    const lifetimeCPR = 350 / 600;
    assert.equal(result[1]!.newRegs, 600);
    assert.ok(Math.abs(result[1]!.cpr! - lifetimeCPR) < 0.001);
    // Day 1 CPR is also the lifetime constant, not just day-1 spend / day-1 subs
    assert.ok(Math.abs(result[0]!.cpr! - lifetimeCPR) < 0.001);
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

  it("Ironworks fixture: CPR is flat at totalSpend / totalSubscribers", () => {
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

    // First data point must have the same CPR as the last (flat line)
    const first = result[0]!;
    assert.ok(first.cpr !== null);
    assert.ok(Math.abs(first.cpr! - last.cpr!) < 0.0001, "CPR is flat across all points");
  });
});
