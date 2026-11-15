import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { THIN_MIN_AD_SETS, THIN_MIN_SPEND_GBP } from "../../analysis/interest-performance.ts";
import { CONFIDENCE_SCORE, SHRINK_K, THIN_MIN_RESULTS, choosePool, confidenceLabel, confidenceOf, shrinkIndex } from "../shrink.ts";

describe("shrinkage", () => {
  it("(n·index + k·pool) / (n + k) with k = 10", () => {
    assert.equal(SHRINK_K, 10);
    const { shrunkIndex, nEffective } = shrinkIndex(10, 0.6, { index: 1, fundedAds: 40 });
    assert.equal(shrunkIndex, (10 * 0.6 + 10 * 1) / 20);
    assert.equal(nEffective, 20);
    assert.ok(Math.abs(shrinkIndex(3, 0.5, { index: 0.9, fundedAds: 40 }).shrunkIndex! - (1.5 + 9) / 13) < 1e-12);
  });

  it("n = 0 is the pool; a pool lends at most what it has", () => {
    assert.deepEqual(shrinkIndex(0, 0.4, { index: 0.8, fundedAds: 4 }), { shrunkIndex: 0.8, nEffective: 4 });
  });

  it("no index → no shrunk index", () => {
    assert.deepEqual(shrinkIndex(5, null, { index: 0.8, fundedAds: 20 }), { shrunkIndex: null, nEffective: 5 });
  });

  it("client pools toward vertical; a thin vertical pool falls back to 'all'", () => {
    const vertical = { index: 0.7, confidence: "ok" as const, fundedAds: 12 };
    const thinVertical = { index: 0.2, confidence: "thin" as const, fundedAds: 2 };
    const all = { index: 0.9, confidence: "strong" as const, fundedAds: 80 };
    assert.deepEqual(choosePool([vertical, all]), { index: 0.7, fundedAds: 12 });
    assert.deepEqual(choosePool([thinVertical, all]), { index: 0.9, fundedAds: 80 });
    const shrunk = shrinkIndex(4, 0.5, choosePool([thinVertical, all])).shrunkIndex!;
    assert.ok(Math.abs(shrunk - (4 * 0.5 + 10 * 0.9) / 14) < 1e-12);
  });

  it("no pool row, or none with an index → 1; every pool thin → the last with an index", () => {
    assert.deepEqual(choosePool([]), { index: 1, fundedAds: 0 });
    assert.deepEqual(choosePool([null, { index: null, confidence: "ok", fundedAds: 9 }]), { index: 1, fundedAds: 0 });
    assert.deepEqual(
      choosePool([
        { index: 0.5, confidence: "thin", fundedAds: 1 },
        { index: 0.8, confidence: "thin", fundedAds: 2 },
      ]),
      { index: 0.8, fundedAds: 2 },
    );
  });
});

describe("confidence", () => {
  it("thin reuses the #1026 constants; strong is ≥ 10 funded ads and ≥ £500", () => {
    assert.equal(THIN_MIN_AD_SETS, 3);
    assert.equal(THIN_MIN_SPEND_GBP, 150);
    assert.equal(confidenceOf(2, 10_000), "thin");
    assert.equal(confidenceOf(50, 149.99), "thin");
    assert.equal(confidenceOf(3, 150), "ok");
    assert.equal(confidenceOf(10, 499), "ok");
    assert.equal(confidenceOf(9, 5000), "ok");
    assert.equal(confidenceOf(10, 500), "strong");
  });

  it("results count too: under 10 stage results is thin, whatever the ads and spend", () => {
    assert.equal(THIN_MIN_RESULTS, 10);
    assert.equal(confidenceOf(40, 5000, 9), "thin");
    assert.equal(confidenceOf(40, 5000, 10), "strong");
    assert.equal(confidenceOf(3, 150, 10), "ok");
    assert.equal(confidenceOf(40, 5000), "strong");
  });

  it("the numeric score round-trips to the label", () => {
    for (const label of ["thin", "ok", "strong"] as const) assert.equal(confidenceLabel(CONFIDENCE_SCORE[label]), label);
    assert.equal(confidenceLabel(null), null);
  });

  it("the file header documents the choice of k and the results floor", () => {
    const header = readFileSync("lib/learning/shrink.ts", "utf8");
    assert.match(header, /k = 10 is the number of funded ads/);
    assert.match(header, /thin unless its ads have at least\s+\* THIN_MIN_RESULTS \(10\) results/);
  });
});
