/**
 * Tests for the Phase 4 report-shape helpers.
 *
 * The actual JSX render lives in
 * `components/report/google-ads-report-block.tsx`, but every
 * branching decision was pulled into pure functions in
 * `lib/reporting/google-ads-report-shape.ts` so we can prove the
 * shape per channel mix without booting React.
 *
 * Coverage matrix:
 *   - search-only event → row 2 is the search-shaped tiles, no
 *     engagements column in the breakdown
 *   - video-only event  → row 2 + breakdown unchanged from the
 *     pre-Phase-4 video-shaped report (regression guard for the
 *     BB26-KAYODE awareness report)
 *   - mixed event       → row 2 stays video-shaped, breakdown
 *     gains the "Type" badge column + Engagements column
 *   - empty event       → row 2 is empty (the block hides it
 *     rather than render four "—" cards)
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  googleAdsCampaignColumns,
  googleAdsChannelKind,
  googleAdsReportPresence,
  googleAdsRow2Tiles,
} from "../google-ads-report-shape.ts";
import type { CampaignInsightsRow } from "../event-insights.ts";

function row(
  partial: Partial<CampaignInsightsRow> & { id: string; campaign_type?: string },
): CampaignInsightsRow {
  return {
    id: partial.id,
    name: partial.name ?? `Campaign ${partial.id}`,
    status: partial.status ?? "ENABLED",
    spend: partial.spend ?? 0,
    impressions: partial.impressions ?? 0,
    clicks: partial.clicks ?? 0,
    ctr: partial.ctr ?? null,
    cpm: partial.cpm ?? null,
    cpr: partial.cpr ?? null,
    results: partial.results ?? 0,
    ad_account_id: partial.ad_account_id ?? "test",
    video_views: partial.video_views,
    cost_per_view: partial.cost_per_view ?? null,
    thruplays: partial.thruplays,
    campaign_type: partial.campaign_type,
    video_quartile_p25_rate: partial.video_quartile_p25_rate ?? null,
    video_quartile_p50_rate: partial.video_quartile_p50_rate ?? null,
    video_quartile_p75_rate: partial.video_quartile_p75_rate ?? null,
    video_quartile_p100_rate: partial.video_quartile_p100_rate ?? null,
  };
}

describe("googleAdsChannelKind", () => {
  it("maps SEARCH and SEARCH:SUBTYPE to SEARCH", () => {
    assert.equal(googleAdsChannelKind(row({ id: "1", campaign_type: "SEARCH" })), "SEARCH");
    assert.equal(
      googleAdsChannelKind(row({ id: "2", campaign_type: "SEARCH:UNKNOWN" })),
      "SEARCH",
    );
  });

  it("maps VIDEO and VIDEO:VIDEO_ACTION to VIDEO", () => {
    assert.equal(googleAdsChannelKind(row({ id: "1", campaign_type: "VIDEO" })), "VIDEO");
    assert.equal(
      googleAdsChannelKind(row({ id: "2", campaign_type: "VIDEO:VIDEO_ACTION" })),
      "VIDEO",
    );
  });

  it("maps unknown / missing campaign_type to OTHER", () => {
    assert.equal(googleAdsChannelKind(row({ id: "1" })), "OTHER");
    assert.equal(
      googleAdsChannelKind(row({ id: "2", campaign_type: "PERFORMANCE_MAX" })),
      "OTHER",
    );
  });
});

describe("googleAdsReportPresence", () => {
  it("search-only event flags hasSearch and sums conversions + spend", () => {
    const presence = googleAdsReportPresence([
      row({ id: "1", campaign_type: "SEARCH", spend: 125, results: 25 }),
      row({ id: "2", campaign_type: "SEARCH", spend: 50, results: 5 }),
    ]);
    assert.equal(presence.hasSearch, true);
    assert.equal(presence.hasVideo, false);
    assert.equal(presence.isMixed, false);
    assert.equal(presence.searchConversions, 30);
    assert.equal(presence.searchSpend, 175);
  });

  it("video-only event flags hasVideo and zero search fields", () => {
    const presence = googleAdsReportPresence([
      row({ id: "1", campaign_type: "VIDEO:VIDEO_ACTION", spend: 60 }),
    ]);
    assert.equal(presence.hasVideo, true);
    assert.equal(presence.hasSearch, false);
    assert.equal(presence.isMixed, false);
    assert.equal(presence.searchConversions, 0);
    assert.equal(presence.searchSpend, 0);
  });

  it("mixed event flags both + isMixed", () => {
    const presence = googleAdsReportPresence([
      row({ id: "1", campaign_type: "VIDEO", spend: 100 }),
      row({ id: "2", campaign_type: "SEARCH", spend: 30, results: 4 }),
    ]);
    assert.equal(presence.hasVideo, true);
    assert.equal(presence.hasSearch, true);
    assert.equal(presence.isMixed, true);
    assert.equal(presence.searchConversions, 4);
    assert.equal(presence.searchSpend, 30);
  });

  it("empty event reports neither", () => {
    const presence = googleAdsReportPresence([]);
    assert.equal(presence.hasVideo, false);
    assert.equal(presence.hasSearch, false);
    assert.equal(presence.isMixed, false);
  });
});

describe("googleAdsCampaignColumns", () => {
  it("video-only event keeps the historical video-shaped table (regression guard)", () => {
    // Before Phase 4 this table was Campaign | Spend | Impr. | Eng. |
    // CTR | CPE. Post-Phase-4 it's still video-rich (Engagements
    // kept) but with Clicks + Avg CPC added as universal columns.
    // The critical regression guard: no Type badge column appears
    // unless the event is mixed, so the BB26-KAYODE awareness
    // report doesn't suddenly grow a redundant column.
    const cols = googleAdsCampaignColumns({ hasVideo: true, isMixed: false });
    assert.deepEqual(cols, [
      "name",
      "spend",
      "impressions",
      "clicks",
      "ctr",
      "avgCpc",
      "engagements",
    ]);
  });

  it("search-only event drops the engagements column entirely", () => {
    const cols = googleAdsCampaignColumns({ hasVideo: false, isMixed: false });
    assert.deepEqual(cols, ["name", "spend", "impressions", "clicks", "ctr", "avgCpc"]);
    assert.ok(!cols.includes("engagements"), "search-only must NOT carry engagements column");
  });

  it("mixed event gets a Type badge column + engagements", () => {
    const cols = googleAdsCampaignColumns({ hasVideo: true, isMixed: true });
    assert.deepEqual(cols, [
      "name",
      "type",
      "spend",
      "impressions",
      "clicks",
      "ctr",
      "avgCpc",
      "engagements",
    ]);
  });
});

describe("googleAdsRow2Tiles", () => {
  it("video-only event keeps the historical row 2 (regression guard)", () => {
    assert.deepEqual(
      googleAdsRow2Tiles({ hasVideo: true, hasSearch: false }),
      ["engagements", "avgCpc", "costPerVideoView", "viewThroughRate"],
    );
  });

  it("mixed event keeps the video-shaped row 2 (video metrics dominate)", () => {
    // Mixed event still has VTR/CPV meaningful for the video portion
    // — keep that row. Search metrics surface in the breakdown table.
    assert.deepEqual(
      googleAdsRow2Tiles({ hasVideo: true, hasSearch: true }),
      ["engagements", "avgCpc", "costPerVideoView", "viewThroughRate"],
    );
  });

  it("search-only event swaps row 2 to search-shaped tiles", () => {
    assert.deepEqual(
      googleAdsRow2Tiles({ hasVideo: false, hasSearch: true }),
      ["avgCpc", "conversions", "costPerConversion", "engagements"],
    );
  });

  it("empty event hides row 2 (no four-dash card row)", () => {
    assert.deepEqual(googleAdsRow2Tiles({ hasVideo: false, hasSearch: false }), []);
  });
});
