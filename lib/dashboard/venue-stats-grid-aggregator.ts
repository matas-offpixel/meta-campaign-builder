/**
 * lib/dashboard/venue-stats-grid-aggregator.ts
 *
 * Pure aggregator powering the topline campaign stats grid on the
 * venue report. Sums the slim `DailyRollupRow[]` (loaded by
 * `client-portal-server.ts`) by platform within an optional date
 * window and returns the cell values the Black-Butter style grid
 * renders.
 *
 * Single responsibility: numeric aggregation. No formatting, no
 * empty-state branching — those live in the grid component so
 * the aggregator stays trivially testable.
 */

import type { DailyRollupRow } from "@/lib/db/client-portal-server";
import type { PlatformId } from "@/lib/dashboard/platform-colors";

export interface VenueStatsGridCells {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  /** Click-through rate, %. Null when impressions=0. */
  ctr: number | null;
  /** Cost per 1,000 impressions, currency. Null when impressions=0. */
  cpm: number | null;
  videoPlays: number;
  engagements: number;
  /** Cost per video play. Null when video plays=0. */
  costPerVideoPlay: number | null;
  /** Cost per engagement. Null when engagements=0. */
  costPerEngagement: number | null;
  /** Cost per click. Null when clicks=0. Subline on the Clicks cell. */
  costPerClick: number | null;
  /** Number of distinct days summed (powers the headline copy). */
  daysCount: number;
  /** Latest source timestamp across the platform's source columns
   *  within the window — drives "last sync" copy when the parent
   *  isn't using the global `lastSyncedAt`. */
  fetchedAt: string | null;
  /** True when at least one row had non-zero spend or impressions
   *  for this platform — otherwise the grid renders the empty-state
   *  card instead of a row of "—" / 0s. */
  hasData: boolean;
}

const EMPTY_CELLS: VenueStatsGridCells = {
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  ctr: null,
  cpm: null,
  videoPlays: 0,
  engagements: 0,
  costPerVideoPlay: null,
  costPerEngagement: null,
  costPerClick: null,
  daysCount: 0,
  fetchedAt: null,
  hasData: false,
};

/**
 * Filter rows to those within `[since, until]` (inclusive). Both
 * bounds are YYYY-MM-DD strings; lexicographic comparison is correct
 * because the rollup `date` column is stored canonical.
 *
 * `windowDays === null` means lifetime (no filter).
 */
function isInWindow(
  date: string,
  windowDays: ReadonlySet<string> | null,
): boolean {
  if (windowDays === null) return true;
  return windowDays.has(date);
}

/**
 * Aggregate stats for a single platform across the given rollup rows
 * and (optional) window. Multi-event venues sum across every event in
 * the rollup set the caller passes in (filter upstream by event_id
 * before calling — the aggregator is platform-only, not venue-aware).
 *
 * Note on Meta spend: prefers `ad_spend_allocated` (post-allocator,
 * deduplicated for multi-event venues) over the raw `ad_spend`. The
 * raw `ad_spend` is identical across every event in a venue group
 * (Meta returns the campaign total per event), which would
 * triple-count for a 3-event venue group. Allocated spend is per-
 * event-correct.
 */
export function aggregateStatsForPlatform(
  rows: DailyRollupRow[],
  platform: Exclude<PlatformId, "all">,
  windowDays: ReadonlySet<string> | null,
): VenueStatsGridCells {
  const cells: VenueStatsGridCells = { ...EMPTY_CELLS };
  const days = new Set<string>();
  let fetchedAt: string | null = null;

  for (const row of rows) {
    if (!isInWindow(row.date, windowDays)) continue;

    if (platform === "meta") {
      const allocated = row.ad_spend_allocated;
      const presale = row.ad_spend_presale;
      const hasAllocated = allocated != null || presale != null;
      const spend = hasAllocated
        ? (allocated ?? 0) + (presale ?? 0)
        : (row.ad_spend ?? 0);
      const impressions = row.meta_impressions ?? 0;
      const reach = row.meta_reach ?? 0;
      const clicks = row.link_clicks ?? 0;
      const videoPlays = row.meta_video_plays_3s ?? 0;
      const engagements = row.meta_engagements ?? 0;
      cells.spend += spend;
      cells.impressions += impressions;
      cells.reach += reach;
      cells.clicks += clicks;
      cells.videoPlays += videoPlays;
      cells.engagements += engagements;
      if (
        spend > 0 ||
        impressions > 0 ||
        reach > 0 ||
        clicks > 0 ||
        videoPlays > 0 ||
        engagements > 0
      ) {
        days.add(row.date);
      }
      const ts = row.source_meta_at;
      if (ts && (!fetchedAt || ts > fetchedAt)) fetchedAt = ts;
    } else if (platform === "tiktok") {
      const spend = row.tiktok_spend ?? 0;
      const impressions = row.tiktok_impressions ?? 0;
      const clicks = row.tiktok_clicks ?? 0;
      const videoPlays = row.tiktok_video_views ?? 0;
      cells.spend += spend;
      cells.impressions += impressions;
      cells.clicks += clicks;
      cells.videoPlays += videoPlays;
      // TikTok rollup doesn't carry deduplicated reach or engagement
      // metrics; leave both at zero so the cells render "—" rather
      // than implying a real zero.
      if (spend > 0 || impressions > 0 || clicks > 0 || videoPlays > 0) {
        days.add(row.date);
      }
      const ts = row.source_tiktok_at;
      if (ts && (!fetchedAt || ts > fetchedAt)) fetchedAt = ts;
    } else {
      const spend = row.google_ads_spend ?? 0;
      const impressions = row.google_ads_impressions ?? 0;
      const clicks = row.google_ads_clicks ?? 0;
      const videoPlays = row.google_ads_video_views ?? 0;
      cells.spend += spend;
      cells.impressions += impressions;
      cells.clicks += clicks;
      cells.videoPlays += videoPlays;
      if (spend > 0 || impressions > 0 || clicks > 0 || videoPlays > 0) {
        days.add(row.date);
      }
      const ts = row.source_google_ads_at;
      if (ts && (!fetchedAt || ts > fetchedAt)) fetchedAt = ts;
    }
  }

  cells.daysCount = days.size;
  cells.fetchedAt = fetchedAt;
  cells.hasData = days.size > 0;
  cells.ctr =
    cells.impressions > 0 ? (cells.clicks / cells.impressions) * 100 : null;
  cells.cpm =
    cells.impressions > 0 ? (cells.spend / cells.impressions) * 1000 : null;
  cells.costPerClick =
    cells.clicks > 0 ? cells.spend / cells.clicks : null;
  cells.costPerVideoPlay =
    cells.videoPlays > 0 ? cells.spend / cells.videoPlays : null;
  cells.costPerEngagement =
    cells.engagements > 0 ? cells.spend / cells.engagements : null;

  return cells;
}

/**
 * Aggregate "All" view by summing the per-platform aggregates. Reach
 * is left at the Meta-only number — TikTok and Google Ads don't
 * expose a comparable deduped reach metric. Engagements is Meta-only
 * for the same reason. The combined grid is for at-a-glance budget
 * + delivery; per-platform detail comes from selecting the platform
 * tab.
 */
export function aggregateStatsForAll(
  rows: DailyRollupRow[],
  windowDays: ReadonlySet<string> | null,
): VenueStatsGridCells {
  const meta = aggregateStatsForPlatform(rows, "meta", windowDays);
  const tiktok = aggregateStatsForPlatform(rows, "tiktok", windowDays);
  const google = aggregateStatsForPlatform(rows, "google_ads", windowDays);
  const cells: VenueStatsGridCells = {
    spend: meta.spend + tiktok.spend + google.spend,
    impressions: meta.impressions + tiktok.impressions + google.impressions,
    reach: meta.reach,
    clicks: meta.clicks + tiktok.clicks + google.clicks,
    ctr: null,
    cpm: null,
    videoPlays: meta.videoPlays + tiktok.videoPlays + google.videoPlays,
    engagements: meta.engagements,
    costPerVideoPlay: null,
    costPerEngagement: null,
    costPerClick: null,
    daysCount: Math.max(meta.daysCount, tiktok.daysCount, google.daysCount),
    fetchedAt: latestTimestamp([
      meta.fetchedAt,
      tiktok.fetchedAt,
      google.fetchedAt,
    ]),
    hasData: meta.hasData || tiktok.hasData || google.hasData,
  };
  cells.ctr =
    cells.impressions > 0 ? (cells.clicks / cells.impressions) * 100 : null;
  cells.cpm =
    cells.impressions > 0 ? (cells.spend / cells.impressions) * 1000 : null;
  cells.costPerClick = cells.clicks > 0 ? cells.spend / cells.clicks : null;
  cells.costPerVideoPlay =
    cells.videoPlays > 0 ? cells.spend / cells.videoPlays : null;
  cells.costPerEngagement =
    cells.engagements > 0 ? cells.spend / cells.engagements : null;
  return cells;
}

function latestTimestamp(values: Array<string | null>): string | null {
  let latest: string | null = null;
  for (const v of values) {
    if (!v) continue;
    if (!latest || v > latest) latest = v;
  }
  return latest;
}

/**
 * Window-day set helper — pass the resolved date list from
 * `resolvePresetToDays` here. Returns a Set for O(1) `has()` checks
 * inside the aggregator's hot loop.
 *
 * `null` means "no window — sum lifetime". `[]` (empty array) means
 * "explicitly empty window" and yields zero on every cell.
 */
export function buildWindowDaySet(
  windowDays: string[] | null,
): ReadonlySet<string> | null {
  if (windowDays === null) return null;
  return new Set(windowDays);
}
