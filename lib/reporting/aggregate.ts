/**
 * lib/reporting/aggregate.ts
 *
 * Tiny pure helper that rolls up a flat list of insight-style rows
 * into a single weighted aggregate. Used by the cross-event rollup
 * (`/reporting`) so the page-level KPI strip and per-event totals
 * use the same arithmetic — sum-then-divide, never mean-of-means
 * (which would make the dashboard disagree with Ads Manager).
 *
 * Pure / framework-free / no Meta types so it stays trivially
 * testable and importable from any boundary.
 */

export interface InsightRow {
  spend: number;
  impressions: number;
  clicks: number;
  /** Cost-per-result count (purchases / leads / etc.). */
  results: number;
}

export interface Aggregate {
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  /** Weighted CTR as a percentage (0–100). null when impressions = 0. */
  ctr: number | null;
  /** Blended CPR in the row's currency. null when results = 0. */
  cpr: number | null;
  /** Weighted CPM. null when impressions = 0. */
  cpm: number | null;
}

export function aggregate(rows: ReadonlyArray<InsightRow>): Aggregate {
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let results = 0;
  for (const r of rows) {
    spend += Number.isFinite(r.spend) ? r.spend : 0;
    impressions += Number.isFinite(r.impressions) ? r.impressions : 0;
    clicks += Number.isFinite(r.clicks) ? r.clicks : 0;
    results += Number.isFinite(r.results) ? r.results : 0;
  }
  return {
    spend,
    impressions,
    clicks,
    results,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    cpr: results > 0 ? spend / results : null,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
  };
}
