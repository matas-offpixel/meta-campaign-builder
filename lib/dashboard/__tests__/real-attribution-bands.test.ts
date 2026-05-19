/**
 * Unit tests for `lib/dashboard/real-attribution-bands.ts`.
 *
 * Pins the trust × coverage state matrix the prompt asked for. The
 * tile re-imports these helpers verbatim, so any DOM regression
 * still has to break a logic-level test first.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  trustBand,
  coverageBand,
  formatRatio,
} from "../real-attribution-bands.ts";

describe("trustBand", () => {
  it("returns red when the ratio is null (no Meta data)", () => {
    assert.equal(trustBand(null), "red");
  });

  it("returns red on non-finite values (defensive)", () => {
    assert.equal(trustBand(Number.NaN), "red");
    assert.equal(trustBand(Number.POSITIVE_INFINITY), "red");
  });

  it("returns green inside the 0.7–1.3 sweet spot", () => {
    assert.equal(trustBand(0.7), "green");
    assert.equal(trustBand(0.85), "green");
    assert.equal(trustBand(1), "green");
    assert.equal(trustBand(1.3), "green");
  });

  it("returns amber outside the sweet spot in either direction", () => {
    assert.equal(trustBand(0.6), "amber"); // Meta over-reports
    assert.equal(trustBand(1.4), "amber"); // Meta under-reports
    assert.equal(trustBand(2.5), "amber"); // 2.5×
    assert.equal(trustBand(0.05), "amber");
  });

  it("returns amber on extreme over-reporting (e.g. 14× from a CAPI loop)", () => {
    assert.equal(trustBand(14), "amber");
  });
});

describe("coverageBand", () => {
  it("returns neutral when the ratio is null (no real sales yet)", () => {
    assert.equal(coverageBand(null), "neutral");
  });

  it("returns red when coverage < 20%", () => {
    assert.equal(coverageBand(0), "red");
    assert.equal(coverageBand(0.05), "red");
    assert.equal(coverageBand(0.19999), "red");
  });

  it("returns amber for 20–50%", () => {
    assert.equal(coverageBand(0.2), "amber");
    assert.equal(coverageBand(0.35), "amber");
    assert.equal(coverageBand(0.49999), "amber");
  });

  it("returns green at 50%+", () => {
    assert.equal(coverageBand(0.5), "green");
    assert.equal(coverageBand(0.75), "green");
    assert.equal(coverageBand(1), "green");
  });
});

describe("formatRatio", () => {
  it("renders an em dash for nullish / non-finite", () => {
    assert.equal(formatRatio(null), "—");
    assert.equal(formatRatio(Number.NaN), "—");
    assert.equal(formatRatio(Number.POSITIVE_INFINITY), "—");
  });

  it("renders < 10× as a percentage", () => {
    assert.equal(formatRatio(0.5), "50%");
    assert.equal(formatRatio(1), "100%");
    assert.equal(formatRatio(2.5), "250%");
  });

  it("renders very small ratios with one decimal of precision", () => {
    assert.equal(formatRatio(0.05), "5.0%");
    assert.equal(formatRatio(0.012), "1.2%");
  });

  it("renders ≥ 10× as a multiplier", () => {
    assert.equal(formatRatio(10), "10.0×");
    assert.equal(formatRatio(14.7), "14.7×");
  });
});

describe("trust × coverage state matrix (the four corners)", () => {
  // The prompt asks for "all four states (trust+coverage
  // combinations)". The matrix is denser than that — trust has 3
  // bands (green/amber/red) × coverage has 4 (green/amber/red/
  // neutral) — but the four CORNERS are the demo-facing ones:
  //
  //   1. Trust green + Coverage green = "We agree with Meta and
  //      drove half the sales" (the launch-ready state).
  //   2. Trust green + Coverage red = "We agree with Meta and
  //      organic dominates" (paid is small but accurate).
  //   3. Trust amber + Coverage green = "Meta over/under-reports
  //      but we still account for half of real sales".
  //   4. Trust red + Coverage neutral = "Pre-Joe — no Meta
  //      purchase data and no real sales yet".

  it("corner 1 — trust green + coverage green", () => {
    assert.equal(trustBand(1.0), "green");
    assert.equal(coverageBand(0.6), "green");
  });

  it("corner 2 — trust green + coverage red", () => {
    assert.equal(trustBand(0.9), "green");
    assert.equal(coverageBand(0.05), "red");
  });

  it("corner 3 — trust amber + coverage green", () => {
    assert.equal(trustBand(0.4), "amber");
    assert.equal(coverageBand(0.55), "green");
  });

  it("corner 4 — trust red + coverage neutral (pre-Joe)", () => {
    assert.equal(trustBand(null), "red");
    assert.equal(coverageBand(null), "neutral");
  });
});
