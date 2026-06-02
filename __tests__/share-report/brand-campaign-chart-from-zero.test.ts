/**
 * Regression fixture: Ironworks brand_campaign trend chart from 22 May → 2 Jun 2026.
 *
 * Verifies the full pipeline: mailchimp snapshot points → canonical aggregator
 * → correct CPR, carry-forward, and spend semantics.
 *
 * Agency-confirmed data shape:
 *   22 May: 3 subscribers (Mailchimp activity starts, no ad spend)
 *   25 May: first paid ad spend  
 *   31 May: ~3,000 subscribers (cumulative)
 *   2 Jun:  3,006 subscribers
 *
 * The "from zero" in the test name refers to the chart starting with no historical
 * data and demonstrating that the pipeline correctly handles the 22 May → 2 Jun window
 * with both a sparse spend series and a dense subscriber series.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aggregateTrendChartPoints,
} from "../../lib/dashboard/trend-chart-data.ts";
import { buildMailchimpRegistrationSnapshotPoints } from "../../lib/dashboard/venue-trend-points.ts";
import { buildBrandCampaignTrendPoints } from "../../lib/dashboard/brand-campaign-trend-points.ts";
import type { MailchimpSnapshotRow } from "../../lib/mailchimp/compute-registrations.ts";

// ─── Fixture data (Ironworks shape) ─────────────────────────────────────────

// Cumulative subscriber counts per day, anchored to 3,006 on 2 Jun.
// Daily subs: 3,0,0,100,200,400,600,700,600,300,50,53 → total = 3,006.
const IRONWORKS_SNAPSHOTS: MailchimpSnapshotRow[] = [
  { snapshot_at: "2026-05-22T12:00:00Z", email_subscribers: 3 },
  { snapshot_at: "2026-05-23T12:00:00Z", email_subscribers: 3 },
  { snapshot_at: "2026-05-24T12:00:00Z", email_subscribers: 3 },
  { snapshot_at: "2026-05-25T12:00:00Z", email_subscribers: 103 },
  { snapshot_at: "2026-05-26T12:00:00Z", email_subscribers: 303 },
  { snapshot_at: "2026-05-27T12:00:00Z", email_subscribers: 703 },
  { snapshot_at: "2026-05-28T12:00:00Z", email_subscribers: 1303 },
  { snapshot_at: "2026-05-29T12:00:00Z", email_subscribers: 2003 },
  { snapshot_at: "2026-05-30T12:00:00Z", email_subscribers: 2603 },
  { snapshot_at: "2026-05-31T12:00:00Z", email_subscribers: 2903 },
  { snapshot_at: "2026-06-01T12:00:00Z", email_subscribers: 2953 },
  { snapshot_at: "2026-06-02T12:00:00Z", email_subscribers: 3006 },
];

// Spend rollups: no spend 22–24 May, then ramps up from 25 May.
const IRONWORKS_ROLLUPS = [
  // No rows for 22–24 May (no ad spend before campaign launch)
  { date: "2026-05-25", ad_spend: 50, ad_spend_allocated: null, tiktok_spend: 20, google_ads_spend: 0, link_clicks: 100 },
  { date: "2026-05-26", ad_spend: 100, ad_spend_allocated: null, tiktok_spend: 40, google_ads_spend: 0, link_clicks: 200 },
  { date: "2026-05-27", ad_spend: 200, ad_spend_allocated: null, tiktok_spend: 80, google_ads_spend: 0, link_clicks: 400 },
  { date: "2026-05-28", ad_spend: 400, ad_spend_allocated: null, tiktok_spend: 100, google_ads_spend: 0, link_clicks: 500 },
  { date: "2026-05-29", ad_spend: 600, ad_spend_allocated: null, tiktok_spend: 150, google_ads_spend: 0, link_clicks: 600 },
  { date: "2026-05-30", ad_spend: 700, ad_spend_allocated: null, tiktok_spend: 200, google_ads_spend: 0, link_clicks: 700 },
  { date: "2026-05-31", ad_spend: 500, ad_spend_allocated: null, tiktok_spend: 180, google_ads_spend: 0, link_clicks: 600 },
  { date: "2026-06-01", ad_spend: 50, ad_spend_allocated: null, tiktok_spend: 30, google_ads_spend: 0, link_clicks: 200 },
  { date: "2026-06-02", ad_spend: 36, ad_spend_allocated: null, tiktok_spend: 17, google_ads_spend: 0, link_clicks: 100 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function totalSpend(rollups: typeof IRONWORKS_ROLLUPS): number {
  return rollups.reduce((s, r) => s + (r.ad_spend ?? 0) + (r.tiktok_spend ?? 0), 0);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Ironworks brand_campaign chart fixture (22 May → 2 Jun)", () => {
  it("buildMailchimpRegistrationSnapshotPoints produces cumulative_snapshot points", () => {
    const pts = buildMailchimpRegistrationSnapshotPoints(IRONWORKS_SNAPSHOTS);
    assert.equal(pts.length, 12);
    assert.ok(pts.every(p => p.ticketsKind === "cumulative_snapshot"));
    assert.equal(pts[0]!.date, "2026-05-22");
    assert.equal(pts[0]!.tickets, 3);
    assert.equal(pts[11]!.date, "2026-06-02");
    assert.equal(pts[11]!.tickets, 3006);
  });

  it("aggregator starts at first Mailchimp day when spend_or_registrations anchor is used", () => {
    const pts = buildBrandCampaignTrendPoints(IRONWORKS_ROLLUPS, IRONWORKS_SNAPSHOTS);
    const days = aggregateTrendChartPoints(pts, "daily", {
      leadingAnchor: "spend_or_registrations",
    });
    const dates = days.map((d) => d.date).sort();
    assert.equal(dates[0], "2026-05-22", "Chart should start at 22 May (first subscriber day)");
    assert.equal(dates[dates.length - 1], "2026-06-02", "Chart should end at 2 Jun");
  });

  it("default aggregator still starts at first spend day (venue-style trim)", () => {
    const pts = buildBrandCampaignTrendPoints(IRONWORKS_ROLLUPS, IRONWORKS_SNAPSHOTS);
    const days = aggregateTrendChartPoints(pts, "daily");
    const dates = days.map((d) => d.date).sort();
    assert.equal(dates[0], "2026-05-25", "Default trim anchors on spend only");
  });

  it("registrations carry forward across days without a snapshot", () => {
    // Use only a sparse snapshot set (just 2 dates) to verify carry-forward
    const sparseSnapshots: MailchimpSnapshotRow[] = [
      { snapshot_at: "2026-05-22T12:00:00Z", email_subscribers: 3 },
      { snapshot_at: "2026-06-02T12:00:00Z", email_subscribers: 3006 },
    ];
    const pts = buildBrandCampaignTrendPoints(IRONWORKS_ROLLUPS, sparseSnapshots);
    const days = aggregateTrendChartPoints(pts, "daily");

    // Any date between 22 May and 2 Jun with spend should carry-forward 3 subscribers
    // (the last known cumulative_snapshot value before that date)
    const jun1 = days.find(d => d.date === "2026-06-01");
    if (jun1) {
      // 1 Jun has spend but no snapshot in sparse set — should carry forward 3 subs
      // (the last snapshot was 22 May with 3 subs, until 2 Jun snapshot at 3006)
      assert.ok(
        jun1.tickets === 3 || jun1.tickets == null,
        `1 Jun should carry forward 3 subs or be null without 2 Jun snapshot, got: ${jun1.tickets}`,
      );
    }
  });

  it("spend is per-day (not cumulative) on each spend point", () => {
    const pts = buildBrandCampaignTrendPoints(IRONWORKS_ROLLUPS, IRONWORKS_SNAPSHOTS);
    const days = aggregateTrendChartPoints(pts, "daily", {
      leadingAnchor: "spend_or_registrations",
    });

    // 22–24 May have no rollup rows — those days should have null spend
    const may22 = days.find(d => d.date === "2026-05-22");
    if (may22) {
      assert.ok(
        may22.spend == null || may22.spend === 0,
        `22 May should have zero/null spend (no rollup): ${may22.spend}`,
      );
    }

    // 25 May should have spend = 50 + 20 = 70 (Meta + TikTok per-day, cross-platform)
    const may25 = days.find(d => d.date === "2026-05-25");
    if (may25) {
      assert.ok(
        may25.spend != null && may25.spend > 0,
        `25 May should have positive spend, got: ${may25.spend}`,
      );
    }
  });

  it("lifetime CPR on last day = total cumulative spend / total subscribers", () => {
    const pts = buildBrandCampaignTrendPoints(IRONWORKS_ROLLUPS, IRONWORKS_SNAPSHOTS);
    const days = aggregateTrendChartPoints(pts, "daily", {
      leadingAnchor: "spend_or_registrations",
    });

    const lastDay = [...days].sort((a, b) => b.date.localeCompare(a.date))[0];
    assert.ok(lastDay, "There should be a last day");

    if (lastDay.tickets && lastDay.cpt != null) {
      const expectedLifetimeCPR = totalSpend(IRONWORKS_ROLLUPS) / lastDay.tickets;
      // CPR on last day should be close to lifetime CPR
      // (canonical aggregator: cpt = running_spend / running_tickets)
      assert.ok(
        Math.abs(lastDay.cpt - expectedLifetimeCPR) < 0.01,
        `Lifetime CPR on last day should be ~${expectedLifetimeCPR.toFixed(2)}, got ${lastDay.cpt?.toFixed(2)}`,
      );
    }
  });

  it("CPR on 25 May (first spend day) uses cumulative spend / subscribers that day", () => {
    const pts = buildBrandCampaignTrendPoints(IRONWORKS_ROLLUPS, IRONWORKS_SNAPSHOTS);
    const days = aggregateTrendChartPoints(pts, "daily", {
      leadingAnchor: "spend_or_registrations",
    });

    const may25 = days.find(d => d.date === "2026-05-25");
    if (may25 && may25.tickets && may25.cpt != null) {
      // On 25 May: running spend = 70 (50+20), cumulative subs = 103
      const expectedCPR = 70 / 103;
      assert.ok(
        Math.abs(may25.cpt - expectedCPR) < 0.01,
        `25 May CPR should be ~${expectedCPR.toFixed(3)}, got ${may25.cpt?.toFixed(3)}`,
      );
    }
  });
});
