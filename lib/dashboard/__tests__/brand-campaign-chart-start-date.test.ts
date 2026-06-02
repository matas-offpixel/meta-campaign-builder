/**
 * Brand_campaign Daily Trend chart must start at the earliest Mailchimp
 * subscriber day, even when paid spend has not launched yet.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aggregateTrendChartPoints } from "../trend-chart-data.ts";
import { buildBrandCampaignTrendPoints } from "../brand-campaign-trend-points.ts";
import type { MailchimpSnapshotRow } from "../../mailchimp/compute-registrations.ts";

const IRONWORKS_SNAPSHOTS: MailchimpSnapshotRow[] = [
  { snapshot_at: "2026-05-22T12:00:00Z", email_subscribers: 3 },
  { snapshot_at: "2026-05-23T12:00:00Z", email_subscribers: 3 },
  { snapshot_at: "2026-05-24T12:00:00Z", email_subscribers: 3 },
  { snapshot_at: "2026-05-25T12:00:00Z", email_subscribers: 103 },
  { snapshot_at: "2026-06-02T12:00:00Z", email_subscribers: 3006 },
];

const IRONWORKS_ROLLUPS = [
  { date: "2026-05-25", ad_spend: 17, tiktok_spend: 20, google_ads_spend: 0, link_clicks: 50 },
  { date: "2026-05-27", ad_spend: 1000, tiktok_spend: 134, google_ads_spend: 0, link_clicks: 400 },
  { date: "2026-06-02", ad_spend: 36, tiktok_spend: 17, google_ads_spend: 0, link_clicks: 100 },
];

describe("brand_campaign chart start date — Ironworks fixture", () => {
  it("starts at 22 May (first Mailchimp day) with spend null and registrations 3", () => {
    const pts = buildBrandCampaignTrendPoints(IRONWORKS_ROLLUPS, IRONWORKS_SNAPSHOTS);
    const days = aggregateTrendChartPoints(pts, "daily", {
      leadingAnchor: "spend_or_registrations",
    });

    assert.ok(days.length > 0);
    assert.equal(days[0]!.date, "2026-05-22");
    assert.equal(days[0]!.tickets, 3);
    assert.ok(days[0]!.spend == null || days[0]!.spend === 0);
    assert.equal(days[0]!.cpt, null);
  });

  it("25 May shows paid spend with carried-forward registrations and lifetime CPR", () => {
    const pts = buildBrandCampaignTrendPoints(IRONWORKS_ROLLUPS, IRONWORKS_SNAPSHOTS);
    const days = aggregateTrendChartPoints(pts, "daily", {
      leadingAnchor: "spend_or_registrations",
    });

    const may25 = days.find((d) => d.date === "2026-05-25");
    assert.ok(may25, "Expected 25 May in chart");
    assert.equal(may25!.spend, 37, "Meta £17 + TikTok £20");
    assert.equal(may25!.tickets, 103);
    assert.ok(may25!.cpt != null);
    assert.ok(Math.abs(may25!.cpt! - 37 / 103) < 0.01);
  });

  it("venue-style charts still anchor on spend only by default", () => {
    const pts = buildBrandCampaignTrendPoints(IRONWORKS_ROLLUPS, IRONWORKS_SNAPSHOTS);
    const days = aggregateTrendChartPoints(pts, "daily");
    assert.equal(days[0]!.date, "2026-05-25", "default trim skips pre-spend Mailchimp days");
  });
});
