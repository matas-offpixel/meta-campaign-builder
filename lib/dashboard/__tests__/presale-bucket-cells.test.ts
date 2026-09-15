import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MailchimpSnapshotRow } from "../../mailchimp/compute-registrations.ts";

import { costPerResult } from "../cost-per-result.ts";
import {
  bucketClicks,
  bucketImpressions,
  bucketMilestones,
  bucketRegs,
  bucketSpend,
  bucketVideoViews,
} from "../presale-bucket-cells.ts";
import {
  aggregatePresaleBucket,
  type PresaleBucketTotals,
} from "../presale-bucket.ts";
import { trackerMilestoneDays } from "../tracker-phase.ts";

function bucketOf(
  rows: Array<Record<string, unknown> & { date: string }>,
  cutoff = "2026-09-09",
): PresaleBucketTotals {
  const bucket = aggregatePresaleBucket(rows, cutoff);
  assert.ok(bucket, "expected a bucket");
  return bucket;
}

describe("bucketRegs + the CPR it feeds", () => {
  it("shows the summed registrations and a cost per registration", () => {
    const bucket = bucketOf([
      { date: "2026-08-26", ad_spend: 224, meta_regs: 64 },
      { date: "2026-08-27", ad_spend: 224, meta_regs: 160 },
    ]);
    const regs = bucketRegs({
      presale: bucket,
      mailchimpSnapshots: null,
      isBrandCampaign: false,
    });
    assert.equal(regs, 224);
    assert.equal(costPerResult(bucket.ad_spend, regs), 2);
  });

  it("shows nothing when every day in the bucket has a null regs column", () => {
    const bucket = bucketOf([
      { date: "2026-08-26", ad_spend: 100 },
      { date: "2026-08-27", ad_spend: 150 },
    ]);
    const regs = bucketRegs({
      presale: bucket,
      mailchimpSnapshots: null,
      isBrandCampaign: false,
    });
    assert.equal(regs, null);
    assert.equal(costPerResult(bucket.ad_spend, regs), null);
  });

  it("does not divide by a zero registration count", () => {
    assert.equal(costPerResult(250, 0), null);
  });

  it("reads Mailchimp deltas when the REGS column is tag-scoped", () => {
    const snapshots: MailchimpSnapshotRow[] = [
      { snapshot_at: "2026-08-25T12:00:00Z", email_subscribers: 100 },
      { snapshot_at: "2026-09-08T12:00:00Z", email_subscribers: 1786 },
      { snapshot_at: "2026-09-12T12:00:00Z", email_subscribers: 1900 },
    ] as MailchimpSnapshotRow[];
    const bucket = bucketOf([
      { date: "2026-08-26", ad_spend: 100, meta_regs: 64 },
      { date: "2026-09-08", ad_spend: 100, meta_regs: 160 },
    ]);
    // 26 Aug – 8 Sept inclusive: 1786 now, 100 the day before the range.
    assert.equal(
      bucketRegs({
        presale: bucket,
        mailchimpSnapshots: snapshots,
        isBrandCampaign: false,
      }),
      1686,
    );
  });

  it("keeps the Meta count for brand campaigns even with snapshots", () => {
    const snapshots = [
      { snapshot_at: "2026-09-08T12:00:00Z", email_subscribers: 1786 },
    ] as MailchimpSnapshotRow[];
    const bucket = bucketOf([{ date: "2026-08-26", meta_regs: 64 }]);
    assert.equal(
      bucketRegs({
        presale: bucket,
        mailchimpSnapshots: snapshots,
        isBrandCampaign: true,
      }),
      64,
    );
  });
});

describe("bucket money + count cells", () => {
  it("sums spend and clicks across platforms", () => {
    const bucket = bucketOf([
      { date: "2026-08-26", ad_spend: 100, link_clicks: 10, tiktok_spend: 5 },
      { date: "2026-08-27", ad_spend: 50.5, link_clicks: 20, tiktok_clicks: 3 },
    ]);
    assert.equal(bucketSpend(bucket, false, "all"), 155.5);
    assert.equal(bucketClicks(bucket, false, "all"), 33);
  });

  it("shows nothing rather than a zero when no day carried spend", () => {
    const bucket = bucketOf([
      { date: "2026-08-26", meta_regs: 64 },
      { date: "2026-08-27", meta_regs: 160 },
    ]);
    assert.equal(bucketSpend(bucket, false, "all"), null);
    assert.equal(bucketClicks(bucket, false, "all"), null);
    assert.equal(bucketImpressions(bucket, "all"), null);
    assert.equal(bucketVideoViews(bucket, "all"), null);
  });

  it("keeps a real zero as a zero", () => {
    const bucket = bucketOf([{ date: "2026-08-26", ad_spend: 0 }]);
    assert.equal(bucketSpend(bucket, false, "all"), 0);
  });

  it("honours the brand-campaign platform filter", () => {
    const bucket = bucketOf([
      {
        date: "2026-08-26",
        ad_spend: 100,
        tiktok_spend: 5,
        google_ads_spend: 1,
        meta_impressions: 900,
        tiktok_impressions: 100,
      },
    ]);
    assert.equal(bucketSpend(bucket, true, "meta"), 100);
    assert.equal(bucketSpend(bucket, true, "tiktok"), 5);
    assert.equal(bucketSpend(bucket, true, "google"), 1);
    assert.equal(bucketSpend(bucket, true, "all"), 106);
    assert.equal(bucketImpressions(bucket, "meta"), 900);
    assert.equal(bucketImpressions(bucket, "all"), 1000);
  });
});

describe("bucketMilestones", () => {
  it("marks the milestones the collapsed row is hiding", () => {
    const days = trackerMilestoneDays({
      announcementAt: "2026-09-02T16:00:00+00:00",
      presaleAt: "2026-09-09T11:00:00+00:00",
      generalSaleAt: "2026-09-09T13:00:00+00:00",
    });
    const bucket = bucketOf([
      { date: "2026-08-27", ad_spend: 100 },
      { date: "2026-09-02", ad_spend: 100 },
    ]);
    // Announce is inside the bucket; presale + general sale are on the
    // first daily row below it.
    assert.deepEqual(bucketMilestones(days, bucket), ["announce"]);
  });
});
