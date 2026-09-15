/**
 * lib/dashboard/presale-bucket.ts
 *
 * One aggregation for the Daily Tracker's pre-general-sale bucket —
 * the single collapsed row that stands in for every day before
 * `events.general_sale_at`.
 *
 * Two surfaces build that bucket (the single-event rollup API /
 * share report, and the multi-event venue report) and both used to
 * carry their own hand-rolled sum. They disagreed about which
 * columns were worth keeping, so the bucket silently dropped
 * registrations: an event whose whole signup phase happened before
 * general sale showed "—" in REGS and the visible daily rows looked
 * like the entire campaign.
 *
 * Rules:
 *   - Every column the bucket hides is summed. A column is `null`
 *     only when it is null on every day in the bucket — a real zero
 *     stays a zero.
 *   - `earliestDate` is the first day with ANY non-zero metric, not
 *     the first row present. The rollup sync zero-pads its window, so
 *     a campaign that started on 26 Aug had 60 all-zero rows reaching
 *     back to 27 Jun and the bucket label read "from Sat 27 Jun".
 *   - The cutoff is a calendar day (`YYYY-MM-DD`). Callers holding a
 *     `timestamptz` must slice it first — a raw ISO timestamp makes
 *     the general-sale day itself sort INTO the bucket, which hides
 *     the row the general-sale marker belongs on.
 */

/** The subset of a rollup / timeline row the bucket aggregates. */
export interface PresaleBucketInputRow {
  /** YYYY-MM-DD. */
  date: string;
  ad_spend?: number | null;
  ad_spend_allocated?: number | null;
  ad_spend_presale?: number | null;
  link_clicks?: number | null;
  landing_page_views?: number | null;
  meta_regs?: number | null;
  meta_impressions?: number | null;
  meta_video_plays_3s?: number | null;
  tiktok_spend?: number | null;
  tiktok_clicks?: number | null;
  tiktok_impressions?: number | null;
  tiktok_video_views?: number | null;
  google_ads_spend?: number | null;
  google_ads_clicks?: number | null;
  google_ads_impressions?: number | null;
  google_ads_video_views?: number | null;
  tickets_sold?: number | null;
  revenue?: number | null;
}

export interface PresaleBucketTotals {
  /** Calendar day (YYYY-MM-DD) the bucket stops at, exclusive. */
  cutoffDate: string;
  ad_spend: number | null;
  link_clicks: number | null;
  /** Meta Landing Page Views (migration 099). No tracker column yet;
   *  summed so the bucket never becomes the reason a future column
   *  reads "—". */
  landing_page_views: number | null;
  /** Meta-attributed registrations — the column the bucket used to drop. */
  meta_regs: number | null;
  meta_impressions: number | null;
  meta_video_plays_3s: number | null;
  tiktok_spend: number | null;
  tiktok_clicks: number | null;
  tiktok_impressions: number | null;
  tiktok_video_views: number | null;
  google_ads_spend: number | null;
  google_ads_clicks: number | null;
  google_ads_impressions: number | null;
  google_ads_video_views: number | null;
  tickets_sold: number | null;
  revenue: number | null;
  /** Number of rows folded into the bucket. */
  daysCount: number;
  /** First day in the bucket carrying any non-zero metric. Falls back
   *  to the earliest row when every day is empty. */
  earliestDate: string | null;
}

const SUMMED_FIELDS = [
  "ad_spend",
  "link_clicks",
  "landing_page_views",
  "meta_regs",
  "meta_impressions",
  "meta_video_plays_3s",
  "tiktok_spend",
  "tiktok_clicks",
  "tiktok_impressions",
  "tiktok_video_views",
  "google_ads_spend",
  "google_ads_clicks",
  "google_ads_impressions",
  "google_ads_video_views",
  "tickets_sold",
  "revenue",
] as const satisfies ReadonlyArray<keyof PresaleBucketInputRow>;

type SummedField = (typeof SUMMED_FIELDS)[number];

/** Fields carrying money — rounded to 2dp so float tails don't leak
 *  into the rendered total. */
const MONEY_FIELDS = new Set<SummedField>([
  "ad_spend",
  "tiktok_spend",
  "google_ads_spend",
  "revenue",
]);

/**
 * True when the row records something that actually happened. Zero-pad
 * rows written by the sync window are all zeros (not nulls), so `!= null`
 * alone would anchor the bucket label to the padding.
 */
export function presaleRowHasActivity(row: PresaleBucketInputRow): boolean {
  for (const field of SUMMED_FIELDS) {
    const value = row[field];
    if (value == null) continue;
    const n = Number(value);
    if (Number.isFinite(n) && n !== 0) return true;
  }
  return false;
}

/** Earliest date among rows with any non-zero metric. */
export function firstPresaleActivityDate(
  rows: readonly PresaleBucketInputRow[],
): string | null {
  let earliest: string | null = null;
  for (const row of rows) {
    if (!presaleRowHasActivity(row)) continue;
    if (earliest === null || row.date < earliest) earliest = row.date;
  }
  return earliest;
}

/**
 * Collapse every row strictly before `cutoffDate` into one bucket.
 * Returns `null` when there is no cutoff or no row falls before it —
 * the caller renders the table flat in that case.
 */
export function aggregatePresaleBucket(
  rows: readonly PresaleBucketInputRow[],
  cutoffDate: string | null,
): PresaleBucketTotals | null {
  if (!cutoffDate) return null;
  const day = cutoffDate.slice(0, 10);
  const inBucket = rows.filter((r) => r.date < day);
  if (inBucket.length === 0) return null;

  const sums = new Map<SummedField, number | null>();
  for (const field of SUMMED_FIELDS) sums.set(field, null);

  let earliestRowDate: string | null = null;
  for (const row of inBucket) {
    if (earliestRowDate === null || row.date < earliestRowDate) {
      earliestRowDate = row.date;
    }
    for (const field of SUMMED_FIELDS) {
      const value = row[field];
      if (value == null) continue;
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      sums.set(field, (sums.get(field) ?? 0) + n);
    }
  }

  const read = (field: SummedField): number | null => {
    const value = sums.get(field) ?? null;
    if (value == null) return null;
    return MONEY_FIELDS.has(field) ? round2(value) : value;
  };

  return {
    cutoffDate: day,
    ad_spend: read("ad_spend"),
    link_clicks: read("link_clicks"),
    landing_page_views: read("landing_page_views"),
    meta_regs: read("meta_regs"),
    meta_impressions: read("meta_impressions"),
    meta_video_plays_3s: read("meta_video_plays_3s"),
    tiktok_spend: read("tiktok_spend"),
    tiktok_clicks: read("tiktok_clicks"),
    tiktok_impressions: read("tiktok_impressions"),
    tiktok_video_views: read("tiktok_video_views"),
    google_ads_spend: read("google_ads_spend"),
    google_ads_clicks: read("google_ads_clicks"),
    google_ads_impressions: read("google_ads_impressions"),
    google_ads_video_views: read("google_ads_video_views"),
    tickets_sold: read("tickets_sold"),
    revenue: read("revenue"),
    daysCount: inBucket.length,
    earliestDate: firstPresaleActivityDate(inBucket) ?? earliestRowDate,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
