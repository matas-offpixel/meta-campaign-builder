/**
 * Share-report Daily Tracker — Mailchimp registrations column (weekly cadence).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildBrandCampaignTrendDays } from "../../lib/dashboard/brand-campaign-trend-points.ts";
import {
  netNewMailchimpRegistrationsForWeek,
} from "../../lib/mailchimp/tracker-registrations.ts";
import type { MailchimpSnapshotRow } from "../../lib/mailchimp/compute-registrations.ts";

const SNAPSHOTS: MailchimpSnapshotRow[] = [
  { snapshot_at: "2026-05-22T12:00:00Z", email_subscribers: 3 },
  { snapshot_at: "2026-05-24T12:00:00Z", email_subscribers: 3 },
  { snapshot_at: "2026-05-25T12:00:00Z", email_subscribers: 10 },
  { snapshot_at: "2026-05-31T12:00:00Z", email_subscribers: 166 },
  { snapshot_at: "2026-06-02T12:00:00Z", email_subscribers: 171 },
];

const ROLLUPS = [
  { date: "2026-05-25", ad_spend: 17, tiktok_spend: 20, google_ads_spend: 0, link_clicks: 50 },
  { date: "2026-06-02", ad_spend: 36, tiktok_spend: 17, google_ads_spend: 0, link_clicks: 100 },
];

describe("share report brand_campaign chart + tracker fixtures", () => {
  it("Daily Trend starts at 22 May via buildBrandCampaignTrendDays", () => {
    const days = buildBrandCampaignTrendDays(ROLLUPS, SNAPSHOTS, "daily");
    assert.equal(days[0]!.date, "2026-05-22");
    assert.equal(days[0]!.tickets, 3);
    assert.ok(days[0]!.spend == null || days[0]!.spend === 0);
    assert.equal(days[0]!.cpt, null);
  });

  it("weekly tracker registrations match Mailchimp net-new deltas", () => {
    assert.equal(
      netNewMailchimpRegistrationsForWeek(SNAPSHOTS, "2026-05-25"),
      163,
    );
    assert.equal(
      netNewMailchimpRegistrationsForWeek(SNAPSHOTS, "2026-06-01"),
      5,
    );
  });
});
