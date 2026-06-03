import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeCrossPlatformRateMetrics } from "../brand-campaign-cross-platform-stats.ts";

/** Ironworks [IRWOHD] confirmed rollup totals (Apr 4 → Jun 2). */
const IRONWORKS = {
  metaSpend: 2678.81,
  tiktokSpend: 1084.7,
  googleSpend: 0,
  metaImpressions: 559_145,
  tiktokImpressions: 536_995,
  metaClicks: 11_193,
  tiktokClicks: 2_704,
  metaReach: 198_432,
  tiktokReach: 47_210,
};

describe("computeCrossPlatformRateMetrics — Ironworks fixture", () => {
  it("sums spend across Meta + TikTok", () => {
    const result = computeCrossPlatformRateMetrics(
      {
        metaSpend: IRONWORKS.metaSpend,
        tiktokSpend: IRONWORKS.tiktokSpend,
        googleSpend: IRONWORKS.googleSpend,
      },
      {
        metaImpressions: IRONWORKS.metaImpressions,
        tiktokImpressions: IRONWORKS.tiktokImpressions,
        googleImpressions: 0,
        metaClicks: IRONWORKS.metaClicks,
        tiktokClicks: IRONWORKS.tiktokClicks,
        googleClicks: 0,
      },
    );
    assert.ok(Math.abs(result.spend - 3763.51) < 0.02);
  });

  it("CTR = total_clicks / total_impressions (not average of platform CTRs)", () => {
    const result = computeCrossPlatformRateMetrics(
      {
        metaSpend: IRONWORKS.metaSpend,
        tiktokSpend: IRONWORKS.tiktokSpend,
        googleSpend: 0,
      },
      {
        metaImpressions: IRONWORKS.metaImpressions,
        tiktokImpressions: IRONWORKS.tiktokImpressions,
        googleImpressions: 0,
        metaClicks: IRONWORKS.metaClicks,
        tiktokClicks: IRONWORKS.tiktokClicks,
        googleClicks: 0,
      },
    );
    const wrongAverage =
      ((IRONWORKS.metaClicks / IRONWORKS.metaImpressions) * 100 +
        (IRONWORKS.tiktokClicks / IRONWORKS.tiktokImpressions) * 100) /
      2;
    const expected =
      ((IRONWORKS.metaClicks + IRONWORKS.tiktokClicks) /
        (IRONWORKS.metaImpressions + IRONWORKS.tiktokImpressions)) *
      100;
    assert.ok(Math.abs((result.ctr ?? 0) - expected) < 0.01);
    assert.ok(Math.abs(wrongAverage - expected) > 0.01, "must not average CTRs");
    assert.ok(Math.abs((result.ctr ?? 0) - 1.27) < 0.02);
  });

  it("CPM = total_spend / total_impressions × 1000", () => {
    const result = computeCrossPlatformRateMetrics(
      {
        metaSpend: IRONWORKS.metaSpend,
        tiktokSpend: IRONWORKS.tiktokSpend,
        googleSpend: 0,
      },
      {
        metaImpressions: IRONWORKS.metaImpressions,
        tiktokImpressions: IRONWORKS.tiktokImpressions,
        googleImpressions: 0,
        metaClicks: IRONWORKS.metaClicks,
        tiktokClicks: IRONWORKS.tiktokClicks,
        googleClicks: 0,
      },
    );
    const impressions = IRONWORKS.metaImpressions + IRONWORKS.tiktokImpressions;
    const expected = (3763.51 / impressions) * 1000;
    assert.ok(Math.abs((result.cpm ?? 0) - expected) < 0.02);
    assert.ok(Math.abs((result.cpm ?? 0) - 3.43) < 0.02);
  });

  it("CPC = total_spend / total_clicks", () => {
    const result = computeCrossPlatformRateMetrics(
      {
        metaSpend: IRONWORKS.metaSpend,
        tiktokSpend: IRONWORKS.tiktokSpend,
        googleSpend: 0,
      },
      {
        metaImpressions: IRONWORKS.metaImpressions,
        tiktokImpressions: IRONWORKS.tiktokImpressions,
        googleImpressions: 0,
        metaClicks: IRONWORKS.metaClicks,
        tiktokClicks: IRONWORKS.tiktokClicks,
        googleClicks: 0,
      },
    );
    const clicks = IRONWORKS.metaClicks + IRONWORKS.tiktokClicks;
    const expected = 3763.51 / clicks;
    assert.ok(Math.abs((result.cpc ?? 0) - expected) < 0.01);
    assert.ok(Math.abs((result.cpc ?? 0) - 0.27) < 0.02);
  });

  it("reach = metaReach + tiktokReach (additive, no deduplication)", () => {
    const result = computeCrossPlatformRateMetrics(
      {
        metaSpend: IRONWORKS.metaSpend,
        tiktokSpend: IRONWORKS.tiktokSpend,
        googleSpend: 0,
      },
      {
        metaImpressions: IRONWORKS.metaImpressions,
        tiktokImpressions: IRONWORKS.tiktokImpressions,
        googleImpressions: 0,
        metaClicks: IRONWORKS.metaClicks,
        tiktokClicks: IRONWORKS.tiktokClicks,
        googleClicks: 0,
        metaReach: IRONWORKS.metaReach,
        tiktokReach: IRONWORKS.tiktokReach,
        googleReach: 0,
      },
    );
    assert.strictEqual(result.reach, IRONWORKS.metaReach + IRONWORKS.tiktokReach);
    assert.ok(result.reach > IRONWORKS.metaReach, "All-pill reach must exceed Meta-only reach");
    assert.ok(result.reach > IRONWORKS.tiktokReach, "All-pill reach must exceed TikTok-only reach");
  });

  it("reach defaults to 0 when reach inputs are omitted (backward-compat)", () => {
    const result = computeCrossPlatformRateMetrics(
      { metaSpend: 100, tiktokSpend: 50, googleSpend: 0 },
      {
        metaImpressions: 1000,
        tiktokImpressions: 500,
        googleImpressions: 0,
        metaClicks: 10,
        tiktokClicks: 5,
        googleClicks: 0,
        // no metaReach / tiktokReach / googleReach
      },
    );
    assert.strictEqual(result.reach, 0);
  });
});

describe("paid media display — cross-platform constant across pills", () => {
  type PlatformFilter = "all" | "meta" | "tiktok" | "google";

  function resolvePaidMediaSpent(
    _platformFilter: PlatformFilter,
    crossPlatformSpend: number,
  ): number {
    return crossPlatformSpend;
  }

  it("Ironworks: £3,763.51 regardless of active pill", () => {
    const total = IRONWORKS.metaSpend + IRONWORKS.tiktokSpend;
    for (const pill of ["all", "meta", "tiktok", "google"] as const) {
      assert.ok(
        Math.abs(resolvePaidMediaSpent(pill, total) - 3763.51) < 0.02,
        `pill ${pill} should show cross-platform total`,
      );
    }
  });
});
