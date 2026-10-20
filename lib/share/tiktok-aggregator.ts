import type { EventDailyRollup } from "@/lib/db/event-daily-rollups";

export interface TikTokRollupTotals {
  spend: number;
  impressions: number;
  clicks: number;
  videoViews100p: number;
  /** Sum of daily tiktok_reach values. Over-counts users active across
   *  multiple days (same caveat as Meta reach-sum). Use for frequency and
   *  cost-per-1000-reached with this understanding. */
  reach: number;
  videoViews2s: number;
  videoViews6s: number;
  postEngagement: number;
  results: number;
  /** Sum of tiktok_avg_play_time_ms across rows that carried a non-null
   *  value. Divide by avgPlayTimeMsRows to get the mean. Weighting by
   *  impressions would be more accurate but isn't available per-row in
   *  the rollup; this matches the Meta block's day-averaging convention. */
  avgPlayTimeMsTotal: number;
  /** Count of rows that contributed to avgPlayTimeMsTotal (denominator). */
  avgPlayTimeMsRows: number;
  fetchedAt: string | null;
}

/**
 * Aggregate event_daily_rollups TikTok columns within a [since, until]
 * window into campaign-level totals for the hybrid share-report resolver.
 *
 * Rows with zero/null tiktok_spend are skipped (same guard as the original
 * aggregator). All fields default to 0 / null when no rows are in window.
 */
export function aggregateTikTokRollups(
  rows: EventDailyRollup[],
  window: { since: string; until: string },
): TikTokRollupTotals {
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let videoViews100p = 0;
  let reach = 0;
  let videoViews2s = 0;
  let videoViews6s = 0;
  let postEngagement = 0;
  let results = 0;
  let avgPlayTimeMsTotal = 0;
  let avgPlayTimeMsRows = 0;
  let fetchedAt: string | null = null;

  for (const row of rows) {
    if (row.date < window.since || row.date > window.until) continue;
    if ((row.tiktok_spend ?? 0) <= 0) continue;

    spend += Number(row.tiktok_spend ?? 0);
    impressions += Number(row.tiktok_impressions ?? 0);
    clicks += Number(row.tiktok_clicks ?? 0);
    videoViews100p += Number(row.tiktok_video_views ?? 0);
    reach += Number(row.tiktok_reach ?? 0);
    videoViews2s += Number(row.tiktok_video_views_2s ?? 0);
    videoViews6s += Number(row.tiktok_video_views_6s ?? 0);
    postEngagement += Number(row.tiktok_post_engagement ?? 0);
    results += Number(row.tiktok_results ?? 0);
    if (row.tiktok_avg_play_time_ms != null) {
      avgPlayTimeMsTotal += Number(row.tiktok_avg_play_time_ms);
      avgPlayTimeMsRows += 1;
    }
    if (
      row.source_tiktok_at &&
      (!fetchedAt || row.source_tiktok_at > fetchedAt)
    ) {
      fetchedAt = row.source_tiktok_at;
    }
  }

  return {
    spend: Math.round(spend * 100) / 100,
    impressions: Math.round(impressions),
    clicks: Math.round(clicks),
    videoViews100p: Math.round(videoViews100p),
    reach: Math.round(reach),
    videoViews2s: Math.round(videoViews2s),
    videoViews6s: Math.round(videoViews6s),
    postEngagement: Math.round(postEngagement),
    results: Math.round(results),
    avgPlayTimeMsTotal,
    avgPlayTimeMsRows,
    fetchedAt,
  };
}
