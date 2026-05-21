/**
 * lib/reporting/google-ads-report-shape.ts
 *
 * Pure helpers that decide which "shape" the Google Ads report block
 * should render based on what campaign types are present. Extracted
 * out of `components/report/google-ads-report-block.tsx` so the
 * decision is testable without booting React.
 *
 * Shipped as part of Phase 4 of the Google Search Campaign Creator
 * (the previous phases built insights + push). The reporting block
 * was originally built for YouTube/Video awareness campaigns; this
 * makes it render correctly for SEARCH campaigns (and for events
 * with a mix of both).
 */

import type { CampaignInsightsRow } from "@/lib/reporting/event-insights";

/**
 * Channel kind a campaign falls into for the purposes of the report
 * block. Derived from `CampaignInsightsRow.campaign_type` which the
 * insights layer formats as `"SEARCH"` or `"VIDEO:VIDEO_ACTION"`
 * (etc.) — see `lib/google-ads/insights.ts`.
 *
 * `"OTHER"` covers any future channel type (e.g. Performance Max)
 * that the matcher pulls in but we haven't tuned the render for yet.
 */
export type GoogleAdsChannelKind = "VIDEO" | "SEARCH" | "OTHER";

export function googleAdsChannelKind(row: CampaignInsightsRow): GoogleAdsChannelKind {
  const t = (row.campaign_type ?? "").toUpperCase();
  if (t.includes("VIDEO")) return "VIDEO";
  if (t.includes("SEARCH")) return "SEARCH";
  return "OTHER";
}

export interface GoogleAdsReportPresence {
  /** Any VIDEO campaign in the breakdown. Drives video-quartile + VTR tiles. */
  hasVideo: boolean;
  /** Any SEARCH campaign in the breakdown. Drives search-shaped row 2 fallback. */
  hasSearch: boolean;
  /** Mixed search + video. Drives the per-row type badge in the campaign table. */
  isMixed: boolean;
  /** Sum of `results` across SEARCH campaigns — proxies conversions for the v1 search wizard. */
  searchConversions: number;
  /** Total spend across SEARCH campaigns. */
  searchSpend: number;
}

export function googleAdsReportPresence(
  campaigns: CampaignInsightsRow[],
): GoogleAdsReportPresence {
  let hasVideo = false;
  let hasSearch = false;
  let searchConversions = 0;
  let searchSpend = 0;
  for (const c of campaigns) {
    const kind = googleAdsChannelKind(c);
    if (kind === "VIDEO") hasVideo = true;
    if (kind === "SEARCH") {
      hasSearch = true;
      searchConversions += c.results ?? 0;
      searchSpend += c.spend;
    }
  }
  return {
    hasVideo,
    hasSearch,
    isMixed: hasVideo && hasSearch,
    searchConversions,
    searchSpend,
  };
}

/**
 * The set of columns to render in the per-campaign breakdown table.
 *
 *   - `clicks`   universal — always shown
 *   - `ctr`      universal — always shown
 *   - `avgCpc`   universal — always shown (was missing from the v1
 *                video-shaped table; the primary "broken-for-SEARCH"
 *                bug we're fixing here)
 *   - `engagements` video-only — only meaningful when at least one
 *                video campaign is present; gated on `hasVideo`
 *   - `type`     "Type" badge column — only shown when both video
 *                and search are in the same breakdown
 *
 * Columns are returned in render order.
 */
export type GoogleAdsCampaignColumn =
  | "name"
  | "type"
  | "spend"
  | "impressions"
  | "clicks"
  | "ctr"
  | "avgCpc"
  | "engagements";

export function googleAdsCampaignColumns(
  presence: Pick<GoogleAdsReportPresence, "hasVideo" | "isMixed">,
): GoogleAdsCampaignColumn[] {
  const cols: GoogleAdsCampaignColumn[] = ["name"];
  if (presence.isMixed) cols.push("type");
  cols.push("spend", "impressions", "clicks", "ctr", "avgCpc");
  if (presence.hasVideo) cols.push("engagements");
  return cols;
}

/**
 * The set of tiles for "row 2" of the top-line stat grid. Row 1
 * (impressions / spend / clicks / CTR) is universal and not modelled
 * here — it doesn't change with channel mix.
 *
 *   - hasVideo:  current video-shaped row — Engagements, Avg CPC,
 *                Cost per video view, View-through rate.
 *   - search-only (hasSearch && !hasVideo): swap to Avg CPC,
 *                Conversions, Cost per conversion, Engagements.
 *                Engagements is kept (as a 0 typically) to maintain
 *                the 4-tile shape; the meaningful search metric is
 *                Conversions / Cost per conversion which would
 *                otherwise be invisible.
 *   - neither (no matched campaigns): empty array — the block hides
 *                row 2 entirely rather than render four "—" cards.
 */
export type GoogleAdsRow2Tile =
  | "engagements"
  | "avgCpc"
  | "costPerVideoView"
  | "viewThroughRate"
  | "conversions"
  | "costPerConversion";

export function googleAdsRow2Tiles(
  presence: Pick<GoogleAdsReportPresence, "hasVideo" | "hasSearch">,
): GoogleAdsRow2Tile[] {
  if (presence.hasVideo) {
    return ["engagements", "avgCpc", "costPerVideoView", "viewThroughRate"];
  }
  if (presence.hasSearch) {
    return ["avgCpc", "conversions", "costPerConversion", "engagements"];
  }
  return [];
}
