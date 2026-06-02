/**
 * __tests__/share-report/cpr-chart-total-based.test.ts
 *
 * Verifies that the Daily Trend chart CPR series uses the total-subscriber
 * basis (running_total_spend / total_subscribers) rather than the daily
 * growth delta basis (spend / daily_new_registrations).
 *
 * Regression test for the Ironworks bug where CPR showed £357.36
 * (spend ÷ 10 daily new) instead of £1.19 (spend ÷ 3,006 total).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeMailchimpTrendPoints } from "../../lib/mailchimp/trend-data.ts";

const snap = (date: string, subs: number) => ({
  snapshot_at: `${date}T09:00:00Z`,
  email_subscribers: subs,
});

const row = (date: string, metaSpend: number, tiktokSpend = 0) => ({
  date,
  ad_spend: metaSpend,
  ad_spend_allocated: null as null,
  ad_spend_presale: null as null,
  tiktok_spend: tiktokSpend,
  google_ads_spend: null as null,
});

describe("CPR chart series — total-subscriber basis", () => {
  it("Ironworks fixture: last-point CPR ≈ £1.19, not £357.36", () => {
    // Simplified Ironworks data: ~£3,573.61 total spend, 3,006 total subscribers
    // Yesterday: 2,996 subs.  Today: 3,006 subs.  Daily growth = 10.
    // Bug: CPR = 3573.61 / 10 = £357.36   ← WRONG
    // Fix: CPR = 3573.61 / 3006 = £1.188  ← CORRECT
    const snapshots = [
      snap("2026-06-01", 2996), // yesterday
      snap("2026-06-02", 3006), // today
    ];
    const timeline = [
      row("2026-06-01", 2640.61, 933), // meta + tiktok ≈ £3,573.61 total
      row("2026-06-02", 0, 0),
    ];

    const points = computeMailchimpTrendPoints(snapshots, timeline);
    const last = points[points.length - 1]!;

    // newRegs must be absolute total subscribers, not daily delta
    assert.equal(last.newRegs, 3006, "newRegs must be absolute total (3,006), not delta (10)");

    // CPR must use total subscribers: ~3573.61 / 3006 ≈ 1.188
    assert.ok(last.cpr !== null, "CPR should not be null");
    assert.ok(last.cpr! < 2, `CPR should be ~£1.19, got £${last.cpr!.toFixed(2)}`);
    assert.ok(
      Math.abs(last.cpr! - 3573.61 / 3006) < 0.01,
      `expected ~${(3573.61 / 3006).toFixed(4)}, got ${last.cpr!.toFixed(4)}`,
    );
  });

  it("CPR trends downward as subscribers grow faster than spend", () => {
    // When subscribers grow quickly and spend levels off, CPR should fall.
    const snapshots = [
      snap("2026-05-01", 100),
      snap("2026-05-02", 500),  // +400 subs
      snap("2026-05-03", 2000), // +1500 subs
    ];
    const timeline = [
      row("2026-05-01", 500),
      row("2026-05-02", 100), // total spend = 600
      row("2026-05-03", 50),  // total spend = 650
    ];
    const points = computeMailchimpTrendPoints(snapshots, timeline);

    const [p1, p2, p3] = points;
    // Each CPR = cumulativeSpend / absoluteSubscribers
    assert.ok(p1!.cpr !== null);
    assert.ok(p2!.cpr !== null);
    assert.ok(p3!.cpr !== null);
    // CPR should be falling: 500/100=5, 600/500=1.2, 650/2000=0.325
    assert.ok(p1!.cpr! > p2!.cpr!, "CPR should fall from day 1 to day 2");
    assert.ok(p2!.cpr! > p3!.cpr!, "CPR should fall from day 2 to day 3");
  });

  it("cpr is null when no subscribers have been captured yet", () => {
    const snapshots = [snap("2026-06-03", 500)]; // only one snapshot, late
    const timeline = [row("2026-06-01", 100), row("2026-06-02", 100)];
    const points = computeMailchimpTrendPoints(snapshots, timeline);
    // Days before the first snapshot → newRegs = null, cpr = null
    assert.equal(points[0]!.cpr, null);
    assert.equal(points[1]!.cpr, null);
  });
});
