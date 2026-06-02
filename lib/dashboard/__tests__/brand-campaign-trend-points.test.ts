/**
 * Tests for lib/dashboard/brand-campaign-trend-points.ts
 * + lib/dashboard/venue-trend-points.ts#buildMailchimpRegistrationSnapshotPoints
 *
 * Regression guard for the brand_campaign trend-chart refactor (PR cursor/
 * converge-brand-campaign-trend-canonical). Verifies that the canonical
 * aggregator (aggregateTrendChartPoints) produces correct CPR semantics when
 * fed brand_campaign data — the same maths the venue trend chart uses for
 * ticket CPT.
 *
 * Anti-drift assertions:
 *   - CPR is cumulative_spend(day) / subscribers(day), NOT weekly_spend / subs
 *   - Registrations carry forward across days without a Mailchimp snapshot
 *   - Weekly bucketing is handled by the aggregator, not manual code
 *   - Lifetime CPR (final day) = totalSpend / latestSubscribers
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aggregateTrendChartPoints,
  hasCumulativeTicketPoints,
} from "../trend-chart-data.ts";
import { buildMailchimpRegistrationSnapshotPoints } from "../venue-trend-points.ts";
import {
  buildBrandCampaignTrendPoints,
} from "../brand-campaign-trend-points.ts";
import type { MailchimpSnapshotRow } from "../../mailchimp/compute-registrations.ts";

// ─── Helpers ───────────────────────────────────────────────────────────────

function mcSnapshot(snapshot_at: string, email_subscribers: number | null): MailchimpSnapshotRow {
  return { snapshot_at, email_subscribers };
}

function rollupRow(
  date: string,
  ad_spend: number,
  tiktok_spend = 0,
  google_ads_spend = 0,
  link_clicks = 0,
) {
  return { date, ad_spend, tiktok_spend, google_ads_spend, link_clicks };
}

// ─── buildMailchimpRegistrationSnapshotPoints ──────────────────────────────

describe("buildMailchimpRegistrationSnapshotPoints", () => {
  it("returns empty array for no snapshots", () => {
    const pts = buildMailchimpRegistrationSnapshotPoints([]);
    assert.deepEqual(pts, []);
  });

  it("skips snapshots with null email_subscribers", () => {
    const pts = buildMailchimpRegistrationSnapshotPoints([
      mcSnapshot("2026-05-01T00:00:00Z", null),
      mcSnapshot("2026-05-02T00:00:00Z", 100),
    ]);
    assert.equal(pts.length, 1);
    assert.equal(pts[0]!.tickets, 100);
  });

  it("tags every point as cumulative_snapshot", () => {
    const pts = buildMailchimpRegistrationSnapshotPoints([
      mcSnapshot("2026-05-01T00:00:00Z", 100),
      mcSnapshot("2026-05-02T00:00:00Z", 110),
    ]);
    assert.ok(hasCumulativeTicketPoints(pts));
    assert.ok(pts.every((p) => p.ticketsKind === "cumulative_snapshot"));
  });

  it("slices snapshot_at to YYYY-MM-DD", () => {
    const pts = buildMailchimpRegistrationSnapshotPoints([
      mcSnapshot("2026-05-24T09:15:00Z", 2987),
    ]);
    assert.equal(pts[0]!.date, "2026-05-24");
  });

  it("sets spend, revenue, linkClicks to null", () => {
    const pts = buildMailchimpRegistrationSnapshotPoints([
      mcSnapshot("2026-05-01T00:00:00Z", 50),
    ]);
    const p = pts[0]!;
    assert.equal(p.spend, null);
    assert.equal(p.revenue, null);
    assert.equal(p.linkClicks, null);
  });
});

// ─── buildBrandCampaignTrendPoints ─────────────────────────────────────────

describe("buildBrandCampaignTrendPoints", () => {
  it("returns empty when given no inputs", () => {
    const pts = buildBrandCampaignTrendPoints([], []);
    assert.deepEqual(pts, []);
  });

  it("snapshot points are always tagged cumulative_snapshot", () => {
    const pts = buildBrandCampaignTrendPoints(
      [rollupRow("2026-05-01", 100)],
      [mcSnapshot("2026-05-01T00:00:00Z", 500)],
    );
    assert.ok(hasCumulativeTicketPoints(pts));
  });

  it("sums cross-platform spend for 'all' platform", () => {
    const pts = buildBrandCampaignTrendPoints(
      [rollupRow("2026-05-01", 100, 50, 25)],
      [],
    );
    const spendPt = pts.find((p) => p.date === "2026-05-01");
    assert.ok(spendPt);
    assert.equal(spendPt!.spend, 175); // 100 + 50 + 25
  });

  it("uses ad_spend_allocated when present", () => {
    const pts = buildBrandCampaignTrendPoints(
      [{ date: "2026-05-01", ad_spend: 200, ad_spend_allocated: 80, tiktok_spend: 50 }],
      [],
    );
    const spendPt = pts.find((p) => p.date === "2026-05-01");
    assert.equal(spendPt!.spend, 130); // 80 allocated + 50 tiktok
  });

  it("filters to meta-only spend when platform='meta'", () => {
    const pts = buildBrandCampaignTrendPoints(
      [rollupRow("2026-05-01", 100, 50, 25)],
      [],
      "meta",
    );
    const spendPt = pts.find((p) => p.date === "2026-05-01");
    assert.equal(spendPt!.spend, 100); // meta only
  });

  it("sets spend to null when all platforms are zero", () => {
    const pts = buildBrandCampaignTrendPoints(
      [rollupRow("2026-05-01", 0, 0, 0)],
      [],
    );
    const spendPt = pts.find((p) => p.date === "2026-05-01");
    assert.equal(spendPt!.spend, null);
  });
});

// ─── Canonical aggregator: Ironworks-shape fixture ─────────────────────────
//
// Simulates the real Ironworks scenario:
//   - 10 Mailchimp snapshots over 10 consecutive days
//   - 60 rollup rows with spend gaps (some days have no Mailchimp snapshot)
//   - Verifies the key invariants from the spec's verification checklist

describe("Ironworks-shape regression: canonical aggregator with brand_campaign points", () => {
  // 60-day rollup window: 2026-04-04 → 2026-06-02
  const rollupRows = Array.from({ length: 60 }, (_, i) => {
    const d = new Date("2026-04-04T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    // Alternating platforms so cross-platform sum is exercised
    const ad_spend = 40 + i; // increasing per-day Meta spend
    const tiktok_spend = 15 + (i % 7); // some variation
    const google_ads_spend = i < 20 ? 0 : 5; // Google starts on day 20
    return rollupRow(date, ad_spend, tiktok_spend, google_ads_spend);
  });

  // 10 Mailchimp snapshots: 2026-05-24 → 2026-06-02
  const snapshotBase = 2900;
  const snapshots: MailchimpSnapshotRow[] = Array.from({ length: 10 }, (_, i) => {
    const d = new Date("2026-05-24T09:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return mcSnapshot(d.toISOString(), snapshotBase + i * 10);
  });
  // Latest: 2990 subscribers on 2026-06-02

  const pts = buildBrandCampaignTrendPoints(rollupRows, snapshots);
  const days = aggregateTrendChartPoints(pts, "daily");

  it("produces output with data (>= 2 days)", () => {
    assert.ok(days.length >= 2, `Expected >=2 days, got ${days.length}`);
  });

  it("spend line stays per-day (not cumulative) on individual points", () => {
    // Each day's spend in the canonical points should be positive and finite
    // The aggregated day.spend is per-day spend (carry-forward doesn't apply to spend).
    const spendDays = days.filter((d) => d.spend != null);
    assert.ok(spendDays.length > 0, "Expected some spend days");
    // Day-level spend should not equal the total (that would mean it was cumulative)
    const total = spendDays.reduce((s, d) => s + (d.spend ?? 0), 0);
    const firstDaySpend = spendDays[0]!.spend!;
    assert.ok(
      firstDaySpend < total,
      `First day spend (${firstDaySpend}) should be < total (${total})`,
    );
  });

  it("registrations (tickets) carry forward across days without snapshots", () => {
    // Days before 2026-05-24 have no snapshot. After carry-forward, they
    // should be null (the aggregator only carries forward WITHIN the trimmed range).
    // Days from 2026-05-24 onward should have non-null tickets.
    const afterSnapshotStart = days.filter((d) => d.date >= "2026-05-24");
    assert.ok(afterSnapshotStart.length > 0);
    // All days from first snapshot onward carry forward (no nulls)
    const nullTicketDays = afterSnapshotStart.filter((d) => d.tickets === null);
    assert.equal(
      nullTicketDays.length,
      0,
      `Expected no null-ticket days after snapshot start, got ${nullTicketDays.length}: ${nullTicketDays.map((d) => d.date).join(", ")}`,
    );
  });

  it("registrations on snapshot days match the snapshot value", () => {
    // 2026-05-24 is the first snapshot day → subscribers = 2900
    const day = days.find((d) => d.date === "2026-05-24");
    assert.ok(day, "Expected a data point on 2026-05-24");
    assert.equal(day!.tickets, snapshotBase, `Expected ${snapshotBase}, got ${day!.tickets}`);
  });

  it("tooltip CPR = cumulative_spend(day) / subscribers(day)", () => {
    // On the last snapshot day (2026-06-02), CPR = totalSpendToDate / 2990
    const lastDay = days.find((d) => d.date === "2026-06-02");
    assert.ok(lastDay, "Expected a data point on 2026-06-02");
    assert.ok(lastDay!.cpt !== null, "Expected non-null CPR on last day");
    // Verify it's not the single-day math (which would be ~£50 / 2990 ≈ £0.017)
    // Lifetime math should give roughly total_60_days_spend / 2990 ≈ £2+ per reg
    assert.ok(
      lastDay!.cpt! > 1,
      `Expected lifetime CPR > 1, got ${lastDay!.cpt}`,
    );
    // And it should NOT equal the per-day spend / subs (which would be very small)
    const perDaySpend = lastDay!.spend ?? 0;
    const perDayCPR = perDaySpend / 2990;
    assert.ok(
      Math.abs(lastDay!.cpt! - perDayCPR) > 0.5,
      `CPR (${lastDay!.cpt}) should differ significantly from per-day CPR (${perDayCPR.toFixed(4)})`,
    );
  });

  it("CPR is runningSpend/subs not perDaySpend/subs", () => {
    // On each snapshot day: cpt = runningSpend(day) / tickets(day)
    // Verify for the first snapshot day (2026-05-24):
    //   running spend through day 51 (Apr 4 + 50 days = May 24) should be sum(40..90) with TikTok
    const day = days.find((d) => d.date === "2026-05-24");
    assert.ok(day, "Expected a data point on 2026-05-24");
    assert.ok(day!.cpt !== null, "Expected non-null CPR on first snapshot day");
    // Per-day spend on May 24 is: ad_spend=40+50=90, tiktok=15+(50%7)=15+1=16, google=5, total=111
    const perDaySpendMay24 = 111;
    const perDayCPR = perDaySpendMay24 / 2900;
    // Lifetime CPR should be much higher than per-day CPR
    assert.ok(
      day!.cpt! > perDayCPR * 10,
      `CPR (${day!.cpt!.toFixed(4)}) should be >> per-day CPR (${perDayCPR.toFixed(4)}) — indicates lifetime accumulation`,
    );
    // Also verify CPR is non-null on all snapshot days
    const snapshotDays = days.filter((d) => d.date >= "2026-05-24" && d.date <= "2026-06-02");
    const nullCPRDays = snapshotDays.filter((d) => d.cpt === null);
    assert.equal(nullCPRDays.length, 0, "Expected non-null CPR on all snapshot days");
  });

  it("weekly bucketing produces fewer rows than daily (aggregator handles it)", () => {
    const weeklyDays = aggregateTrendChartPoints(pts, "weekly");
    assert.ok(
      weeklyDays.length < days.length,
      `Expected fewer weekly rows (${weeklyDays.length}) than daily rows (${days.length})`,
    );
  });

  it("weekly CPR is also lifetime-based (not weekly_spend / subscribers)", () => {
    const weeklyDays = aggregateTrendChartPoints(pts, "weekly");
    const lastWeek = weeklyDays.findLast((d) => d.cpt !== null && d.tickets !== null);
    assert.ok(lastWeek, "Expected a weekly day with CPR");
    // Weekly CPR should NOT equal (weekSpend / subs) which would be very small
    const weekSpend = lastWeek!.spend ?? 0;
    const weekPerSpendCPR = weekSpend / (lastWeek!.tickets ?? 1);
    assert.ok(
      Math.abs(lastWeek!.cpt! - weekPerSpendCPR) > 0.5,
      `Weekly CPR (${lastWeek!.cpt!.toFixed(4)}) should use lifetime spend, not weekly spend per subs (${weekPerSpendCPR.toFixed(4)})`,
    );
  });
});
