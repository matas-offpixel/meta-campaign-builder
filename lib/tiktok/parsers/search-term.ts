/**
 * lib/tiktok/parsers/search-term.ts
 *
 * Search-term breakdown XLSX parser. TikTok occasionally emits the same
 * search term across multiple rows (different attribution windows on
 * the same query, etc); this parser aggregates exact-string duplicates
 * by summing Cost / Impressions / destination Clicks and recomputing
 * the derived CPM / CPC / CTR fields. Theme bucketing uses
 * {@link bucketSearchTerm}.
 */

import type {
  TikTokMetricBlock,
  TikTokSearchTermRow,
} from "@/lib/types/tiktok";

import { bucketSearchTerm } from "../theme-rules.ts";
import {
  buildHeaderIndex,
  isSkippableRow,
  parseMetricBlock,
} from "./shared.ts";

const COL_SEARCH_TERM = "search term";

/** Sum two nullable numbers, treating nulls as zero on either side. */
function addNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * Merge two metric blocks for the same search term.
 *
 * Sum strategy:
 *   - Additive volume metrics (cost, impressions, clicks, video views,
 *     interactive add-on counts) are summed cell by cell.
 *   - Derived rate metrics (cpm, cpc, ctr, frequency-style averages)
 *     are recomputed from the merged volumes — summing rates produces
 *     nonsense, so we'd rather drop to null when the inputs aren't
 *     enough to recompute.
 *   - When impressions are masked (`<5`) on either input, we keep the
 *     surviving raw token so the UI can flag the row.
 */
function mergeBlocks(
  a: TikTokMetricBlock,
  b: TikTokMetricBlock,
): TikTokMetricBlock {
  const cost = addNullable(a.cost, b.cost);
  const impressions = addNullable(a.impressions, b.impressions);
  const clicks_destination = addNullable(
    a.clicks_destination,
    b.clicks_destination,
  );

  const cpm =
    impressions != null && impressions > 0 && cost != null
      ? (cost / impressions) * 1000
      : null;
  const cpc_destination =
    clicks_destination != null && clicks_destination > 0 && cost != null
      ? cost / clicks_destination
      : null;
  const ctr_destination =
    impressions != null && impressions > 0 && clicks_destination != null
      ? (clicks_destination / impressions) * 100
      : null;

  return {
    cost,
    impressions,
    impressions_raw: a.impressions_raw ?? b.impressions_raw ?? null,
    cpm,
    clicks_destination,
    cpc_destination,
    ctr_destination,
    video_views_2s: addNullable(a.video_views_2s, b.video_views_2s),
    video_views_6s: addNullable(a.video_views_6s, b.video_views_6s),
    video_views_p25: addNullable(a.video_views_p25, b.video_views_p25),
    video_views_p50: addNullable(a.video_views_p50, b.video_views_p50),
    video_views_p75: addNullable(a.video_views_p75, b.video_views_p75),
    video_views_p100: addNullable(a.video_views_p100, b.video_views_p100),
    // Rate-style fields — recomputing from raw plays would require fields
    // we don't carry, so we drop to null on collision.
    avg_play_time_per_user: null,
    avg_play_time_per_video_view: null,
    interactive_addon_impressions: addNullable(
      a.interactive_addon_impressions,
      b.interactive_addon_impressions,
    ),
    interactive_addon_destination_clicks: addNullable(
      a.interactive_addon_destination_clicks,
      b.interactive_addon_destination_clicks,
    ),
  };
}

/**
 * Parse a search-term sheet (rows include the header row at index 0).
 * Aggregates exact-string duplicates, tags each row with a theme bucket,
 * and returns rows in original first-seen order.
 */
export function parseSearchTermSheet(
  rows: readonly (readonly unknown[])[],
): TikTokSearchTermRow[] {
  if (rows.length < 2) return [];
  const [headerRow, ...dataRows] = rows;
  const headerIndex = buildHeaderIndex(headerRow);
  const termCol = headerIndex[COL_SEARCH_TERM];
  if (termCol == null) return [];

  const order: string[] = [];
  const byTerm = new Map<string, TikTokSearchTermRow>();

  for (const row of dataRows) {
    const termCell = row[termCol];
    if (isSkippableRow(termCell)) continue;

    const search_term = String(termCell).trim();
    const metric = parseMetricBlock(row, headerIndex);
    const existing = byTerm.get(search_term);

    if (existing) {
      const merged = mergeBlocks(existing, metric);
      byTerm.set(search_term, {
        ...merged,
        search_term,
        theme_bucket: existing.theme_bucket,
      });
    } else {
      order.push(search_term);
      byTerm.set(search_term, {
        ...metric,
        search_term,
        theme_bucket: bucketSearchTerm(search_term),
      });
    }
  }

  return order
    .map((term) => byTerm.get(term))
    .filter((row): row is TikTokSearchTermRow => row != null);
}
