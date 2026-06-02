/**
 * lib/dashboard/brand-campaign-trend-points.ts
 *
 * Canonical TrendChartPoint builder for brand_campaign events.
 *
 * Replaces the divergent `lib/mailchimp/trend-data.ts`
 * (`computeMailchimpTrendPoints`) path that patched CPR math in isolation.
 * Feeding the output of `buildBrandCampaignTrendPoints` into
 * `aggregateTrendChartPoints` produces correct carry-forward and
 * lifetime-spend / lifetime-subscribers (CPR) — the same arithmetic the
 * venue trend chart uses for ticket CPT.
 *
 * Anti-drift: do NOT add a third aggregator here. All accumulation logic
 * lives in `lib/dashboard/trend-chart-data.ts`.
 */

import {
  aggregateTrendChartPoints,
  type TrendChartDay,
  type TrendChartPoint,
  type TrendGranularity,
} from "./trend-chart-data.ts";
import type { MailchimpSnapshotRow } from "../mailchimp/compute-registrations.ts";
import { buildMailchimpRegistrationSnapshotPoints } from "./venue-trend-points.ts";

/**
 * Shape of an `event_daily_rollups` row as consumed here.
 * Intentionally narrow — only the fields needed for spend + clicks.
 */
export interface BrandRollupRow {
  date: string;
  ad_spend?: number | string | null;
  ad_spend_allocated?: number | string | null;
  tiktok_spend?: number | string | null;
  google_ads_spend?: number | string | null;
  link_clicks?: number | string | null;
  tiktok_clicks?: number | string | null;
  google_ads_clicks?: number | string | null;
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build `TrendChartPoint[]` for a brand_campaign event by combining
 * cross-platform spend from `event_daily_rollups` with Mailchimp
 * subscriber snapshot points.
 *
 * Spend points carry per-day values (matching `buildVenueTrendPoints`'s
 * per-day spend semantics). Platform can be narrowed to "meta" / "tiktok" /
 * "google" when the caller wants a per-platform view — defaults to "all"
 * (Meta + TikTok + Google).
 *
 * Registration snapshot points are tagged `ticketsKind: "cumulative_snapshot"`.
 * When the combined array is fed to `aggregateTrendChartPoints`:
 *   - `tickets` carry-forwards across days without a Mailchimp snapshot.
 *   - `cpt` (relabelled "CPR" in the presentation layer) is computed as
 *     `runningSpend(day) / cumulativeSubscribers(day)` — the lifetime/lifetime
 *     ratio the agency quotes to clients.
 *
 * No CPR arithmetic lives here. Do NOT add it.
 */
export function buildBrandCampaignTrendPoints(
  rollups: BrandRollupRow[],
  mailchimpSnapshots: MailchimpSnapshotRow[],
  platform: "all" | "meta" | "tiktok" | "google" = "all",
): TrendChartPoint[] {
  const spendPoints: TrendChartPoint[] = rollups.map((r) => {
    let spend = 0;
    let clicks = 0;

    if (platform === "all" || platform === "meta") {
      const metaSpend =
        r.ad_spend_allocated != null
          ? safeNum(r.ad_spend_allocated)
          : safeNum(r.ad_spend);
      spend += metaSpend;
      clicks += safeNum(r.link_clicks);
    }
    if (platform === "all" || platform === "tiktok") {
      spend += safeNum(r.tiktok_spend);
      clicks += safeNum(r.tiktok_clicks);
    }
    if (platform === "all" || platform === "google") {
      spend += safeNum(r.google_ads_spend);
      clicks += safeNum(r.google_ads_clicks);
    }

    return {
      date: r.date,
      spend: spend > 0 ? spend : null,
      tickets: null,
      revenue: null,
      linkClicks: clicks > 0 ? clicks : null,
    };
  });

  const snapshotPoints = buildMailchimpRegistrationSnapshotPoints(mailchimpSnapshots);

  return [...spendPoints, ...snapshotPoints];
}

/**
 * Brand_campaign charts always anchor on the earliest spend OR Mailchimp
 * registration day — shared by internal dashboard and public share report.
 */
export function aggregateBrandCampaignTrendChartPoints(
  points: TrendChartPoint[],
  granularity: TrendGranularity,
): TrendChartDay[] {
  return aggregateTrendChartPoints(points, granularity, {
    leadingAnchor: "spend_or_registrations",
  });
}

/** Build + aggregate brand_campaign trend days in one call. */
export function buildBrandCampaignTrendDays(
  rollups: BrandRollupRow[],
  mailchimpSnapshots: MailchimpSnapshotRow[],
  granularity: TrendGranularity,
  platform: "all" | "meta" | "tiktok" | "google" = "all",
): TrendChartDay[] {
  return aggregateBrandCampaignTrendChartPoints(
    buildBrandCampaignTrendPoints(rollups, mailchimpSnapshots, platform),
    granularity,
  );
}
