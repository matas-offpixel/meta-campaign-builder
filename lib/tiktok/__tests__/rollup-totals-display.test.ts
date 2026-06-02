import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTikTokRollupTotalsDisplay } from "../rollup-totals-display.ts";

describe("buildTikTokRollupTotalsDisplay — VIEW_CONTENT / Ironworks", () => {
  const ironworksRollup = {
    spend: 1084.7,
    impressions: 536_995,
    clicks: 2_704,
    videoViews: 310_000,
    rollupResults: 480_926,
    rollupEngagementResults: 0,
  };

  it("legacy mislabelled rollup shows View Content events, not Conversions", () => {
    const display = buildTikTokRollupTotalsDisplay(ironworksRollup);
    assert.equal(display.conversions, 0);
    assert.equal(display.engagementEvents, 480_926);
    assert.equal(display.resultsLabel, "View Content events");
    assert.equal(display.costPerLabel, "Cost per View Content");
    assert.equal(display.showEngagementRow, true);
    assert.equal(display.showConversionRow, false);
  });

  it("explicit engagement column takes precedence over inference", () => {
    const display = buildTikTokRollupTotalsDisplay({
      ...ironworksRollup,
      rollupResults: 163,
      rollupEngagementResults: 480_926,
    });
    assert.equal(display.conversions, 163);
    assert.equal(display.engagementEvents, 480_926);
    assert.equal(display.showEngagementRow, true);
    assert.equal(display.showConversionRow, true);
  });

  it("CONVERT campaigns show Conversions label", () => {
    const display = buildTikTokRollupTotalsDisplay(
      {
        spend: 500,
        impressions: 100_000,
        clicks: 1_000,
        videoViews: 50_000,
        rollupResults: 163,
      },
      [
        { optimizationGoal: "CONVERT", results: 103, spend: 300 },
        { optimizationGoal: "CONVERT", results: 60, spend: 200 },
      ],
    );
    assert.equal(display.conversions, 163);
    assert.equal(display.resultsLabel, "Conversions");
    assert.equal(display.showConversionRow, true);
    assert.equal(display.showEngagementRow, false);
  });

  it("VIEW_CONTENT per-campaign rows show conversions and engagement", () => {
    const display = buildTikTokRollupTotalsDisplay(
      {
        spend: 1084.7,
        impressions: 536_995,
        clicks: 2_704,
        videoViews: 310_000,
        rollupResults: 173,
        rollupEngagementResults: 480_926,
      },
      [
        {
          optimizationGoal: "VIEW_CONTENT",
          results: 108,
          engagementResults: 278_105,
          spend: 500,
        },
        {
          optimizationGoal: "VIEW_CONTENT",
          results: 65,
          engagementResults: 208_311,
          spend: 400,
        },
      ],
    );
    assert.equal(display.conversions, 173);
    assert.equal(display.engagementEvents, 486_416);
    assert.equal(display.showConversionRow, true);
    assert.equal(display.showEngagementRow, true);
  });
});
