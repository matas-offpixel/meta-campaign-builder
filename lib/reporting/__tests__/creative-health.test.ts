// ─────────────────────────────────────────────────────────────────────────────
// Creative health scorer tests (PR #56 #4).
//
// Verifies:
//   - threshold edge cases (frequency at 2.5 / 4.0, CTR at 0.8% / 1.5%)
//   - the SCALE / OK / ROTATE / FATIGUED / KILL combination matrix
//   - terminal branches (paused, insufficient impressions)
//   - tooltip shape mirrors the spec example
// ─────────────────────────────────────────────────────────────────────────────

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  classifyAttention,
  classifyFatigue,
  combine,
  HEALTH_LABELS,
  MIN_IMPRESSIONS_FOR_BADGE,
  scoreHealth,
  tooltipFor,
} from "../creative-health.ts";

describe("classifyFatigue", () => {
  it("returns null when frequency is null/non-finite", () => {
    assert.equal(classifyFatigue(null), null);
    assert.equal(classifyFatigue(Number.NaN), null);
    assert.equal(classifyFatigue(Number.POSITIVE_INFINITY), null);
  });
  it("buckets at the spec thresholds", () => {
    assert.equal(classifyFatigue(0), "fresh");
    assert.equal(classifyFatigue(2.49), "fresh");
    assert.equal(classifyFatigue(2.5), "watch");
    assert.equal(classifyFatigue(3.5), "watch");
    assert.equal(classifyFatigue(4.0), "watch");
    assert.equal(classifyFatigue(4.01), "fatigued");
    assert.equal(classifyFatigue(10), "fatigued");
  });
});

describe("classifyAttention", () => {
  it("returns null when ctr is null/non-finite", () => {
    assert.equal(classifyAttention(null), null);
    assert.equal(classifyAttention(Number.NaN), null);
  });
  it("buckets at the spec thresholds (CTR is a fraction)", () => {
    // < 0.8% → weak
    assert.equal(classifyAttention(0.005), "weak");
    assert.equal(classifyAttention(0.0079), "weak");
    // 0.8% – 1.5% → ok
    assert.equal(classifyAttention(0.008), "ok");
    assert.equal(classifyAttention(0.012), "ok");
    assert.equal(classifyAttention(0.015), "ok");
    // > 1.5% → strong
    assert.equal(classifyAttention(0.0151), "strong");
    assert.equal(classifyAttention(0.05), "strong");
  });
});

describe("combine matrix", () => {
  it("matches the spec table", () => {
    assert.equal(combine("fresh", "strong"), "scale");
    assert.equal(combine("fresh", "weak"), "kill");
    assert.equal(combine("fatigued", "strong"), "rotate");
    assert.equal(combine("fatigued", "weak"), "fatigued");
    assert.equal(combine("fresh", "ok"), "ok");
    assert.equal(combine("watch", "strong"), "ok");
    assert.equal(combine("watch", "ok"), "ok");
    assert.equal(combine("watch", "weak"), "ok");
    assert.equal(combine("fatigued", "ok"), "ok");
  });
});

describe("scoreHealth", () => {
  const baseImpressions = 10_000;

  it("returns paused when no underlying ad is active", () => {
    const s = scoreHealth({
      frequency: 1.5,
      inlineLinkClicks: 250,
      impressions: baseImpressions,
      anyAdActive: false,
    });
    assert.equal(s.action, "paused");
  });

  it("returns insufficient below the impressions floor", () => {
    const s = scoreHealth({
      frequency: 2,
      inlineLinkClicks: 50,
      impressions: MIN_IMPRESSIONS_FOR_BADGE - 1,
      anyAdActive: true,
    });
    assert.equal(s.action, "insufficient");
  });

  it("flags a fresh strong-CTR creative as SCALE", () => {
    // freq 1.5 (fresh), CTR 250/10000 = 2.5% (strong)
    const s = scoreHealth({
      frequency: 1.5,
      inlineLinkClicks: 250,
      impressions: 10_000,
      anyAdActive: true,
    });
    assert.equal(s.action, "scale");
    assert.equal(s.fatigue, "fresh");
    assert.equal(s.attention, "strong");
  });

  it("flags a fresh weak-CTR creative as KILL", () => {
    // freq 1.0 (fresh), CTR 50/10000 = 0.5% (weak)
    const s = scoreHealth({
      frequency: 1.0,
      inlineLinkClicks: 50,
      impressions: 10_000,
      anyAdActive: true,
    });
    assert.equal(s.action, "kill");
  });

  it("flags a fatigued strong-CTR creative as ROTATE", () => {
    const s = scoreHealth({
      frequency: 5.0,
      inlineLinkClicks: 200,
      impressions: 10_000,
      anyAdActive: true,
    });
    assert.equal(s.action, "rotate");
  });

  it("flags a fatigued weak-CTR creative as FATIGUED", () => {
    const s = scoreHealth({
      frequency: 6.0,
      inlineLinkClicks: 50,
      impressions: 10_000,
      anyAdActive: true,
    });
    assert.equal(s.action, "fatigued");
  });

  it("falls back to OK when frequency is unknown but impressions clear the floor", () => {
    const s = scoreHealth({
      frequency: null,
      inlineLinkClicks: 200,
      impressions: 10_000,
      anyAdActive: true,
    });
    assert.equal(s.action, "ok");
  });

  it("uses zero CTR when impressions exist but no link clicks (active campaign)", () => {
    const s = scoreHealth({
      frequency: 1.0,
      inlineLinkClicks: 0,
      impressions: 10_000,
      anyAdActive: true,
    });
    assert.equal(s.attention, "weak");
    assert.equal(s.action, "kill");
  });
});

describe("tooltipFor", () => {
  it("renders the spec example shape for a ROTATE", () => {
    const s = scoreHealth({
      frequency: 3.2,
      // freq 3.2 → watch tier; need a fatigued read-out for ROTATE.
      // bump frequency so we hit fatigued × strong:
      inlineLinkClicks: 180,
      impressions: 10_000,
      anyAdActive: true,
    });
    // freq 3.2 + CTR 1.8% (strong) → watch × strong → OK, not ROTATE.
    // Re-score with a fatigued frequency:
    const rotate = scoreHealth({
      frequency: 4.5,
      inlineLinkClicks: 180,
      impressions: 10_000,
      anyAdActive: true,
    });
    const tip = tooltipFor(rotate);
    assert.match(tip, /Frequency 4\.50 \(Fatigued\)/);
    assert.match(tip, /Link CTR 1\.80% \(Strong\)/);
    assert.match(tip, /Next: ROTATE/);
    // (the OK branch above is just a sanity that 3.2 reads as "watch")
    assert.equal(s.fatigue, "watch");
  });

  it("explains the early-window branch", () => {
    const tip = tooltipFor(
      scoreHealth({
        frequency: 1,
        inlineLinkClicks: 1,
        impressions: 200,
        anyAdActive: true,
      }),
    );
    assert.match(tip, /<1k impressions \(200\)/);
  });

  it("explains the paused branch", () => {
    const tip = tooltipFor(
      scoreHealth({
        frequency: 1,
        inlineLinkClicks: 200,
        impressions: 10_000,
        anyAdActive: false,
      }),
    );
    assert.match(tip, /Campaign paused/);
  });
});

describe("HEALTH_LABELS coverage", () => {
  it("has a label for every action", () => {
    const actions = [
      "scale",
      "ok",
      "rotate",
      "fatigued",
      "kill",
      "paused",
      "insufficient",
    ] as const;
    for (const a of actions) {
      assert.ok(HEALTH_LABELS[a], `missing label for ${a}`);
    }
  });
});
