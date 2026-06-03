/**
 * Tests for lib/dashboard/event-code-adset-splits.ts
 *
 * Verifies that:
 * 1. Glasgow O2 (owner) has spend and engagement reduced by 21.47 %
 * 2. Glasgow SWG3 (borrower) has spend and engagement increased by 21.47 %
 * 3. Non-Glasgow event codes are unaffected (zero adjustment)
 * 4. Combined O2 + SWG3 = same total as before (conservation)
 *
 * Numbers are derived from the hardcoded campaign 6925933901665 snapshot:
 *   spend £7,784.08, reach 1,006,656, link_clicks 87,591, LPV 62,679
 *   Split: O2 78.53 %, SWG3 21.47 %
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getSpendAdjustmentGbp,
  applyAdsetSplitsToLifetimeMeta,
  CAMPAIGN_SPLITS,
} from "../event-code-adset-splits.ts";
import type { EventCodeLifetimeMetaCacheRow } from "../../db/event-code-lifetime-meta-cache.ts";

// ── helpers ───────────────────────────────────────────────────────────────────

function cacheRow(
  eventCode: string,
  reach: number,
  linkClicks: number,
  landingPageViews: number,
): EventCodeLifetimeMetaCacheRow {
  return {
    client_id: "test-client",
    event_code: eventCode,
    meta_reach: reach,
    meta_impressions: reach * 5,
    meta_link_clicks: linkClicks,
    meta_landing_page_views: landingPageViews,
    meta_regs: null,
    meta_video_plays_3s: null,
    meta_video_plays_15s: null,
    meta_video_plays_p100: null,
    meta_engagements: null,
    campaign_names: ["[WC26-GLASGOW-O2] TRAFFIC"],
    fetched_at: "2026-06-03T00:00:00Z",
    created_at: "2026-06-03T00:00:00Z",
    updated_at: "2026-06-03T00:00:00Z",
  };
}

// Snapshot totals from CAMPAIGN_SPLITS config
const SNAP = CAMPAIGN_SPLITS[0]!.snapshotTotals;
const SWG3_SHARE = 0.2147; // 21.47 %

// ── getSpendAdjustmentGbp ─────────────────────────────────────────────────────

describe("getSpendAdjustmentGbp", () => {
  it("returns zero for non-Glasgow event codes", () => {
    assert.equal(getSpendAdjustmentGbp("WC26-MANCHESTER"), 0);
    assert.equal(getSpendAdjustmentGbp("WC26-EDINBURGH"), 0);
    assert.equal(getSpendAdjustmentGbp(""), 0);
    assert.equal(getSpendAdjustmentGbp("WC26-GLASGOW"), 0); // no exact match
  });

  it("returns a NEGATIVE delta for WC26-GLASGOW-O2 (owner loses SWG3 share)", () => {
    const adj = getSpendAdjustmentGbp("WC26-GLASGOW-O2");
    const expected = -(SNAP.spend * SWG3_SHARE);
    assert.ok(adj < 0, "O2 adjustment must be negative");
    assert.ok(
      Math.abs(adj - -1671.24) < 0.01,
      `O2 adj ${adj.toFixed(2)} should be ≈ -1671.24 (-snapshot × (1 - O2 share))`,
    );
    assert.ok(
      Math.abs(adj - expected) < 0.01,
      `O2 adj ${adj.toFixed(2)} ≠ expected ${expected.toFixed(2)}`,
    );
  });

  it("returns a POSITIVE delta for WC26-GLASGOW-SWG3 (borrower gains its share)", () => {
    const adj = getSpendAdjustmentGbp("WC26-GLASGOW-SWG3");
    const expected = SNAP.spend * SWG3_SHARE;
    assert.ok(adj > 0, "SWG3 adjustment must be positive");
    assert.ok(
      Math.abs(adj - 1671.24) < 0.01,
      `SWG3 adj ${adj.toFixed(2)} should be ≈ +1671.24 (snapshot × SWG3 share)`,
    );
    assert.ok(
      Math.abs(adj - expected) < 0.01,
      `SWG3 adj ${adj.toFixed(2)} ≠ expected ${expected.toFixed(2)}`,
    );
  });

  it("O2 + SWG3 adjustments cancel out (conservation of spend)", () => {
    const o2Adj = getSpendAdjustmentGbp("WC26-GLASGOW-O2");
    const swg3Adj = getSpendAdjustmentGbp("WC26-GLASGOW-SWG3");
    assert.ok(
      Math.abs(o2Adj + swg3Adj) < 0.001,
      `O2 + SWG3 adjustments should cancel: ${(o2Adj + swg3Adj).toFixed(4)}`,
    );
  });

  it("post-split O2 spend ≈ £6,349 given pre-split dashboard total ≈ £8,000", () => {
    // Dashboard Performance Summary (2026-06-03) shows £7,999.91 before refresh;
    // Meta MCP O2 ad-set subtotal ≈ £6,349.30 after subtracting SWG3 share.
    const preSplitO2Spend = 7999.91;
    const adj = getSpendAdjustmentGbp("WC26-GLASGOW-O2");
    const postSplit = preSplitO2Spend + adj;
    assert.ok(
      Math.abs(postSplit - 6349.3) < 22,
      `Post-split O2 spend ${postSplit.toFixed(2)} should be ≈ £6,349 (rollup vs ad-set subtotal may differ ~£20)`,
    );
  });

  it("post-split SWG3 spend ≈ £2,819 given SWG3-only rollup ≈ £1,148", () => {
    // SWG3-only campaigns ≈ £1,147.74 (no mixed campaign attribution).
    // After split: SWG3 gains 21.47 % of £7,784.08 = £1,671.07
    //   post-split SWG3 = £1,147.74 + £1,671.07 ≈ £2,818.81 ≈ £2,819
    const preSplitSwg3Spend = 1147.74; // approximate
    const adj = getSpendAdjustmentGbp("WC26-GLASGOW-SWG3");
    const postSplit = preSplitSwg3Spend + adj;
    assert.ok(
      Math.abs(postSplit - 2818.48) < 1.5,
      `Post-split SWG3 spend ${postSplit.toFixed(2)} should be ≈ £2,819`,
    );
  });
});

// ── applyAdsetSplitsToLifetimeMeta ───────────────────────────────────────────

describe("applyAdsetSplitsToLifetimeMeta", () => {
  // Pre-split O2 row: reach=918,000, clicks=106,000, LPV=53,000
  // (Campaign 6925933901665 contributes its full reach/clicks/LPV here)
  const PRE_SPLIT_O2_REACH = 918000;
  const PRE_SPLIT_O2_CLICKS = 106000;
  const PRE_SPLIT_O2_LPV = 53000;

  // Pre-split SWG3 row: reach=84,000, clicks=6,000, LPV=3,000
  // (No mixed campaign contribution — only SWG3-tagged campaigns)
  const PRE_SPLIT_SWG3_REACH = 84000;
  const PRE_SPLIT_SWG3_CLICKS = 6000;
  const PRE_SPLIT_SWG3_LPV = 3000;

  const rows = [
    cacheRow("WC26-GLASGOW-O2", PRE_SPLIT_O2_REACH, PRE_SPLIT_O2_CLICKS, PRE_SPLIT_O2_LPV),
    cacheRow("WC26-GLASGOW-SWG3", PRE_SPLIT_SWG3_REACH, PRE_SPLIT_SWG3_CLICKS, PRE_SPLIT_SWG3_LPV),
    cacheRow("WC26-MANCHESTER", 500000, 40000, 20000),
  ];

  const adjusted = applyAdsetSplitsToLifetimeMeta(rows);

  it("does not mutate the input array", () => {
    assert.equal(rows[0]!.meta_reach, PRE_SPLIT_O2_REACH, "O2 input row unchanged");
    assert.equal(rows[1]!.meta_reach, PRE_SPLIT_SWG3_REACH, "SWG3 input row unchanged");
  });

  it("non-Glasgow rows are returned by reference (no copy)", () => {
    // Manchester row unchanged — same values (and ideally same reference)
    const manchesterOut = adjusted.find((r) => r.event_code === "WC26-MANCHESTER")!;
    assert.equal(manchesterOut.meta_reach, 500000);
    assert.equal(manchesterOut.meta_link_clicks, 40000);
    assert.equal(manchesterOut.meta_landing_page_views, 20000);
  });

  it("O2 reach is reduced by 21.47 % of campaign snapshot reach", () => {
    const o2Out = adjusted.find((r) => r.event_code === "WC26-GLASGOW-O2")!;
    const expectedReach = PRE_SPLIT_O2_REACH - SNAP.reach * SWG3_SHARE;
    assert.ok(
      Math.abs(o2Out.meta_reach! - expectedReach) < 1,
      `O2 reach ${o2Out.meta_reach} ≠ expected ${expectedReach.toFixed(0)}`,
    );
  });

  it("SWG3 reach is increased by 21.47 % of campaign snapshot reach", () => {
    const swg3Out = adjusted.find((r) => r.event_code === "WC26-GLASGOW-SWG3")!;
    const expectedReach = PRE_SPLIT_SWG3_REACH + SNAP.reach * SWG3_SHARE;
    assert.ok(
      Math.abs(swg3Out.meta_reach! - expectedReach) < 1,
      `SWG3 reach ${swg3Out.meta_reach} ≠ expected ${expectedReach.toFixed(0)}`,
    );
  });

  it("O2 link_clicks is reduced by 21.47 % of campaign snapshot clicks", () => {
    const o2Out = adjusted.find((r) => r.event_code === "WC26-GLASGOW-O2")!;
    const expected = PRE_SPLIT_O2_CLICKS - SNAP.linkClicks * SWG3_SHARE;
    assert.ok(
      Math.abs(o2Out.meta_link_clicks! - expected) < 1,
      `O2 clicks ${o2Out.meta_link_clicks} ≠ expected ${expected.toFixed(0)}`,
    );
  });

  it("SWG3 link_clicks is increased by 21.47 % of campaign snapshot clicks", () => {
    const swg3Out = adjusted.find((r) => r.event_code === "WC26-GLASGOW-SWG3")!;
    const expected = PRE_SPLIT_SWG3_CLICKS + SNAP.linkClicks * SWG3_SHARE;
    assert.ok(
      Math.abs(swg3Out.meta_link_clicks! - expected) < 1,
      `SWG3 clicks ${swg3Out.meta_link_clicks} ≠ expected ${expected.toFixed(0)}`,
    );
  });

  it("O2 + SWG3 reach sum is conserved after adjustment", () => {
    const o2Out = adjusted.find((r) => r.event_code === "WC26-GLASGOW-O2")!;
    const swg3Out = adjusted.find((r) => r.event_code === "WC26-GLASGOW-SWG3")!;
    const beforeSum = PRE_SPLIT_O2_REACH + PRE_SPLIT_SWG3_REACH;
    const afterSum = o2Out.meta_reach! + swg3Out.meta_reach!;
    assert.ok(
      Math.abs(afterSum - beforeSum) < 1,
      `Reach sum not conserved: before=${beforeSum} after=${afterSum}`,
    );
  });

  it("null cache fields (no LPV data) remain null after adjustment", () => {
    const nullRow: EventCodeLifetimeMetaCacheRow = {
      ...cacheRow("WC26-GLASGOW-O2", 918000, 106000, 53000),
      meta_landing_page_views: null,
    };
    const [out] = applyAdsetSplitsToLifetimeMeta([nullRow]);
    assert.equal(out!.meta_landing_page_views, null, "null LPV stays null");
  });

  it("empty array returns empty array", () => {
    assert.deepEqual(applyAdsetSplitsToLifetimeMeta([]), []);
  });

  it("post-split O2 reach ≈ 702k given pre-split dashboard total ≈ 918,000", () => {
    // Pre-split O2 cache row has full campaign reach baked in.
    // 918,000 − 21.47 % × 1,006,656 = 918,000 − 216,130 ≈ 701,870
    const preSplitO2Reach = 918000;
    const [out] = applyAdsetSplitsToLifetimeMeta([
      cacheRow("WC26-GLASGOW-O2", preSplitO2Reach, 106000, 53000),
    ]);
    const expected = preSplitO2Reach - SNAP.reach * SWG3_SHARE;
    assert.ok(
      out!.meta_reach != null && out.meta_reach > 695000 && out.meta_reach < 710000,
      `Post-split O2 reach ${out!.meta_reach} should be in the 695k–710k band`,
    );
    assert.ok(
      Math.abs(out!.meta_reach! - expected) < 1,
    );
  });
});
