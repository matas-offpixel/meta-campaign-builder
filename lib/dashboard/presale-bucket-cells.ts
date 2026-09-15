/**
 * lib/dashboard/presale-bucket-cells.ts
 *
 * Cell values for the Daily Tracker's collapsed pre-general-sale row.
 *
 * Daily rows coerce a missing metric to 0 — a synced day with no spend
 * really did spend nothing. The bucket can't do that: it stands in for
 * a range of days, and "£0.00 across 40 days" is a claim, not an
 * absence. These helpers keep `null` when every contributing column is
 * null on every day in the bucket, and otherwise project the same
 * platform view the daily rows use.
 *
 * Split out of the tracker component so the rules are unit-testable
 * without rendering a 2,000-line table.
 */

import type { CirqlinSnapshotRow } from "@/lib/cirqlin/types";
import type { MailchimpSnapshotRow } from "@/lib/mailchimp/compute-registrations";
// Relative + extensioned so `node --test` can load this module without
// the bundler's `@/` alias — same convention as the sibling helpers.
import {
  cirqlinSignupsForRange,
  hasCirqlinRegs,
} from "../cirqlin/tracker-signups.ts";
import { netNewMailchimpRegistrationsForRange } from "../mailchimp/tracker-registrations.ts";

import type { PresaleBucketTotals } from "./presale-bucket.ts";
import {
  previousDay,
  trackerMilestonesInRange,
  type TrackerMilestoneKind,
} from "./tracker-phase.ts";

/** Matches `PlatformKey` on the trend chart. */
export type BucketPlatform = "all" | "meta" | "google" | "tiktok";

function sumOrNull(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let any = false;
  for (const value of values) {
    if (value == null) continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    total += n;
    any = true;
  }
  return any ? total : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function bucketSpend(
  presale: PresaleBucketTotals,
  isBrandCampaign: boolean,
  platform: BucketPlatform,
): number | null {
  // Only brand campaigns expose the platform filter; every other
  // report is all-platforms by definition.
  if (!isBrandCampaign || platform === "all") {
    const total = sumOrNull([
      presale.ad_spend,
      presale.tiktok_spend,
      presale.google_ads_spend,
    ]);
    return total == null ? null : round2(total);
  }
  if (platform === "meta") return presale.ad_spend;
  if (platform === "google") return presale.google_ads_spend;
  return presale.tiktok_spend;
}

export function bucketClicks(
  presale: PresaleBucketTotals,
  isBrandCampaign: boolean,
  platform: BucketPlatform,
): number | null {
  if (!isBrandCampaign || platform === "all") {
    return sumOrNull([
      presale.link_clicks,
      presale.tiktok_clicks,
      presale.google_ads_clicks,
    ]);
  }
  if (platform === "meta") return presale.link_clicks;
  if (platform === "google") return presale.google_ads_clicks;
  return presale.tiktok_clicks;
}

export function bucketImpressions(
  presale: PresaleBucketTotals,
  platform: BucketPlatform,
): number | null {
  if (platform === "meta") return presale.meta_impressions;
  if (platform === "google") return presale.google_ads_impressions;
  if (platform === "tiktok") return presale.tiktok_impressions;
  return sumOrNull([
    presale.meta_impressions,
    presale.tiktok_impressions,
    presale.google_ads_impressions,
  ]);
}

export function bucketVideoViews(
  presale: PresaleBucketTotals,
  platform: BucketPlatform,
): number | null {
  if (platform === "meta") return presale.meta_video_plays_3s;
  if (platform === "google") return presale.google_ads_video_views;
  if (platform === "tiktok") return presale.tiktok_video_views;
  return sumOrNull([
    presale.meta_video_plays_3s,
    presale.tiktok_video_views,
    presale.google_ads_video_views,
  ]);
}

/**
 * REGS for the bucket, read from whichever source the REGS column is
 * showing on the daily rows below it: Cirqlin per-day when those
 * snapshots exist, else net-new Mailchimp tag members, else Meta.
 * Mixing sources in one column would make the bucket and the days
 * incomparable.
 */
export function bucketRegs({
  presale,
  mailchimpSnapshots,
  cirqlinSnapshots,
  isBrandCampaign,
}: {
  presale: PresaleBucketTotals;
  mailchimpSnapshots: ReadonlyArray<MailchimpSnapshotRow> | null;
  cirqlinSnapshots?: ReadonlyArray<CirqlinSnapshotRow> | null;
  isBrandCampaign: boolean;
}): number | null {
  const lastDay = previousDay(presale.cutoffDate);
  if (hasCirqlinRegs(cirqlinSnapshots) && cirqlinSnapshots && lastDay && presale.earliestDate) {
    return cirqlinSignupsForRange(
      cirqlinSnapshots,
      presale.earliestDate,
      lastDay,
    );
  }
  if (!mailchimpSnapshots || mailchimpSnapshots.length === 0 || isBrandCampaign) {
    return presale.meta_regs;
  }
  if (!presale.earliestDate || !lastDay) return null;
  return netNewMailchimpRegistrationsForRange(
    mailchimpSnapshots,
    presale.earliestDate,
    lastDay,
  );
}

/** Milestones falling inside the collapsed bucket's range. */
export function bucketMilestones(
  milestoneDays: ReadonlyMap<string, TrackerMilestoneKind[]>,
  presale: PresaleBucketTotals,
): TrackerMilestoneKind[] {
  return trackerMilestonesInRange(
    milestoneDays,
    presale.earliestDate,
    previousDay(presale.cutoffDate),
  );
}
