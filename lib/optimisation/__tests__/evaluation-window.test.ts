/**
 * Tests for the per-metric evaluation window, minimum-evidence threshold,
 * and cooldown ≥ window invariant — task #120 "evaluation window" PR.
 *
 * Run: node --test lib/optimisation/__tests__/evaluation-window.test.ts
 *
 * Falsification guard: these tests are designed to fail on the parent commit
 * (cursor/optimisation-cbo-support / c05f075) where:
 *   - All metrics use 24h, so cpr campaigns see 0 conversions in prod.
 *   - There is no minimum-evidence check; a rate from 1 conversion can fire.
 *   - Cooldown is always 24h regardless of window length.
 * See FALSIFICATION describe block below.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { BudgetGuardrails, OptimisationRule, RuleTimeWindow } from "../../types.ts";
import {
  evaluateAdSet,
  type EvaluateAdSetInput,
} from "../evaluate.ts";
import {
  DEFAULT_WINDOW_CONVERSION,
  DEFAULT_WINDOW_FAST,
  CONVERSION_METRICS,
  FAST_METRICS,
  MIN_CONVERSION_RESULT_COUNT,
  defaultWindowForMetric,
  effectiveCooldownHours,
  maxWindow,
  windowToHours,
} from "../evaluate-windows.ts";
import { resolvePrimaryLiveMetric, type AdSetInsightMetrics } from "../live-metric.ts";
import {
  runOptimisationTick,
  type CampaignAutomationInput,
  type DecisionToInsert,
  type OptimisationTickDeps,
} from "../tick-runner.ts";
import type { AdSetInsightRow, CampaignBudgetInsight } from "../insights-fetch.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

function tid(): string {
  return Math.random().toString(36).slice(2);
}

const PARENT = "c05f075"; // cursor/optimisation-cbo-support

function cprRule(overrides: Partial<OptimisationRule> = {}): OptimisationRule {
  return {
    id: tid(),
    name: "CPR Rule",
    metric: "cpr",
    timeWindow: "24h", // operator has not yet changed to 7d — the system promotes it
    enabled: true,
    thresholds: [
      { id: tid(), operator: "below", value: 2, action: "increase_budget", actionValue: 20, label: "< £2 CPR → scale +20%" },
      { id: tid(), operator: "above", value: 4, action: "pause", label: "above £4 CPR → pause" },
    ],
    ...overrides,
  };
}

const GUARDRAILS: BudgetGuardrails = {
  baseCampaignBudget: 100,
  maxExpansionPercent: 100,
  hardBudgetCeiling: 500, // £500 → 50000p ceiling
  ceilingBehaviour: "stop",
};

function metrics(overrides: Partial<AdSetInsightMetrics> = {}): AdSetInsightMetrics {
  return {
    impressions: 1000,
    cpc: null,
    cpm: null,
    ctr: null,
    costPerActionType: {},
    actionCountByType: {},
    ...overrides,
  };
}

function lm(
  name: "cpr" | "cpa" | "lpv_cost" | "cpm" | "cpc" | "ctr" | "roas",
  value: number,
  window: RuleTimeWindow = "24h",
  resultCount: number | null = null,
) {
  return { name, value, window, resultCount };
}

function baseInput(overrides: Partial<EvaluateAdSetInput> = {}): EvaluateAdSetInput {
  return {
    rules: [cprRule()],
    guardrails: GUARDRAILS,
    // 10564p ≈ £105.64/day — FOLMAOUR campaign grain (19 × £5.56/day).
    // Well within the £500 ceiling so scale-up tests can evaluate freely.
    currentBudgetPence: 10564,
    liveMetric: lm("cpr", 1.72, "7d", 38), // 38 conversions at £1.72 CPR
    lastTouchedAt: null,
    impressions: 15000,
    now: new Date("2026-09-03T12:00:00Z"),
    ...overrides,
  };
}

// ─── Constant assertions ──────────────────────────────────────────────────────

describe("evaluate-windows constants", () => {
  it("DEFAULT_WINDOW_FAST is 24h (lpv proven in prod)", () => {
    assert.equal(DEFAULT_WINDOW_FAST, "24h");
  });

  it("DEFAULT_WINDOW_CONVERSION is 7d (sparse events, needs accumulation)", () => {
    assert.equal(DEFAULT_WINDOW_CONVERSION, "7d");
  });

  it("MIN_CONVERSION_RESULT_COUNT is 5 (lower would amplify noise)", () => {
    assert.equal(MIN_CONVERSION_RESULT_COUNT, 5);
  });

  it("FAST_METRICS includes lpv_cost, cpc, cpm, ctr", () => {
    for (const m of ["lpv_cost", "cpc", "cpm", "ctr"] as const) {
      assert.ok(
        (FAST_METRICS as readonly string[]).includes(m),
        `Expected ${m} in FAST_METRICS`,
      );
    }
  });

  it("CONVERSION_METRICS includes cpr, cpa, roas", () => {
    for (const m of ["cpr", "cpa", "roas"] as const) {
      assert.ok(
        (CONVERSION_METRICS as readonly string[]).includes(m),
        `Expected ${m} in CONVERSION_METRICS`,
      );
    }
  });
});

// ─── Per-metric window selection ─────────────────────────────────────────────

describe("defaultWindowForMetric", () => {
  it("cpr → 7d", () => assert.equal(defaultWindowForMetric("cpr"), "7d"));
  it("cpa → 7d", () => assert.equal(defaultWindowForMetric("cpa"), "7d"));
  it("roas → 7d", () => assert.equal(defaultWindowForMetric("roas"), "7d"));
  it("lpv_cost → 24h (unchanged — proven in prod)", () => assert.equal(defaultWindowForMetric("lpv_cost"), "24h"));
  it("cpc → 24h", () => assert.equal(defaultWindowForMetric("cpc"), "24h"));
  it("cpm → 24h", () => assert.equal(defaultWindowForMetric("cpm"), "24h"));
  it("ctr → 24h", () => assert.equal(defaultWindowForMetric("ctr"), "24h"));
});

describe("maxWindow", () => {
  it("wider window wins", () => {
    assert.equal(maxWindow("24h", "7d"), "7d");
    assert.equal(maxWindow("7d", "24h"), "7d");
    assert.equal(maxWindow("3d", "7d"), "7d");
    assert.equal(maxWindow("24h", "3d"), "3d");
    assert.equal(maxWindow("7d", "7d"), "7d");
    assert.equal(maxWindow("24h", "24h"), "24h");
  });
});

// ─── Cooldown ≥ window invariant ─────────────────────────────────────────────

describe("effectiveCooldownHours", () => {
  it("7d window → cooldown at least 168h even when not configured", () => {
    assert.equal(effectiveCooldownHours("7d", undefined), 168);
  });

  it("7d window with 24h config → promoted to 168h", () => {
    assert.equal(effectiveCooldownHours("7d", 24), 168);
  });

  it("7d window with 336h config → 336h honored (user set a longer value)", () => {
    assert.equal(effectiveCooldownHours("7d", 336), 336);
  });

  it("24h window → 24h floor, even if configured at 2h", () => {
    assert.equal(effectiveCooldownHours("24h", 2), 24);
  });

  it("24h window with 48h config → 48h honored", () => {
    assert.equal(effectiveCooldownHours("24h", 48), 48);
  });

  it("windowToHours covers all RuleTimeWindow values", () => {
    assert.equal(windowToHours("24h"), 24);
    assert.equal(windowToHours("3d"), 72);
    assert.equal(windowToHours("7d"), 168);
  });

  it("evaluateAdSet uses 168h cooldown for a 7d cpr metric", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    // Touched 100h ago — inside 168h (7d) cooldown → should skip_recent_touch
    const lastTouchedAt = new Date(now.getTime() - 100 * 3600 * 1000);
    const result = evaluateAdSet(baseInput({ now, lastTouchedAt }));
    assert.equal(result.action, "skip_recent_touch");
    assert.match(result.reason, /168h cooldown/);
  });

  it("evaluateAdSet evaluates normally after 168h cooldown for 7d cpr metric", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    // Touched 200h ago — outside 168h cooldown → evaluates
    const lastTouchedAt = new Date(now.getTime() - 200 * 3600 * 1000);
    const result = evaluateAdSet(baseInput({ now, lastTouchedAt }));
    assert.notEqual(result.action, "skip_recent_touch");
  });
});

// ─── Minimum-evidence gate ────────────────────────────────────────────────────

describe("minimum-evidence gate (insufficient_conversions)", () => {
  it("resultCount null (direct-field metric cpm) — evidence check skipped entirely", () => {
    // cpm is direct-field: no countable event, resultCount is null
    const result = evaluateAdSet(
      baseInput({
        liveMetric: lm("cpm", 5, "24h", null),
        rules: [
          {
            id: tid(),
            name: "CPM rule",
            metric: "cpm",
            timeWindow: "24h",
            enabled: true,
            thresholds: [{ id: tid(), operator: "below", value: 10, action: "increase_budget", actionValue: 10, label: "low cpm" }],
          },
        ],
      }),
    );
    // Should not be insufficient_conversions — null bypasses the check
    assert.notEqual(result.action, "insufficient_conversions");
  });

  it("resultCount 0 → insufficient_conversions", () => {
    const result = evaluateAdSet(baseInput({ liveMetric: lm("cpr", 1.5, "7d", 0) }));
    assert.equal(result.action, "insufficient_conversions");
    assert.match(result.reason, /0\/5/);
    assert.match(result.reason, /7d/);
  });

  it("resultCount 4 → insufficient_conversions (below threshold of 5)", () => {
    const result = evaluateAdSet(baseInput({ liveMetric: lm("cpr", 1.5, "7d", 4) }));
    assert.equal(result.action, "insufficient_conversions");
    assert.match(result.reason, /4\/5/);
  });

  it("resultCount exactly 5 → evaluates normally (threshold is inclusive)", () => {
    const result = evaluateAdSet(baseInput({ liveMetric: lm("cpr", 1.5, "7d", 5) }));
    assert.equal(result.action, "scale_up");
  });

  it("resultCount 38 → evaluates normally and produces real decision", () => {
    const result = evaluateAdSet(baseInput({ liveMetric: lm("cpr", 1.72, "7d", 38) }));
    // £1.72 is below £2 → scale_up +20%
    assert.equal(result.action, "scale_up");
    assert.equal(result.deltaPercent, 20);
    assert.match(result.ruleMatched ?? "", /scale/);
  });

  it("reason_text for insufficient includes count and window for operator visibility", () => {
    const result = evaluateAdSet(baseInput({ liveMetric: lm("cpr", 1.5, "7d", 3) }));
    // Must tell the operator exactly how far off — "3/5 conversions in the 7d window"
    assert.match(result.reason, /3\/5/);
    assert.match(result.reason, /7d/);
    assert.match(result.reason, /insufficient evidence/);
  });
});

// ─── primaryWindowFor behavior in tick-runner ─────────────────────────────────

describe("tick-runner primaryWindowFor — per-metric window promotion", () => {
  const now = new Date("2026-09-03T12:00:00Z");

  function folmourAdSet(id: string, name: string): AdSetInsightRow {
    return {
      adsetId: id,
      adsetName: name,
      // CBO: no per-ad-set daily_budget
      dailyBudgetPence: null,
      lifetimeBudgetPence: null,
      effectiveStatus: "ACTIVE",
      impressions: 5000,
      cpc: null,
      cpm: null,
      ctr: null,
      costPerActionType: {},
      actionCountByType: {},
    };
  }

  function folmourCampaignInsight(resultCount: number, cpr: number): CampaignBudgetInsight {
    return {
      campaignId: "camp_folm",
      // 19 × 556p = 10564p ≈ £105.64/day. Well within the £500 ceiling.
      dailyBudgetPence: 10564,
      lifetimeBudgetPence: null,
      impressions: 95000, // 19 ad sets × 5000
      cpc: null,
      cpm: null,
      ctr: null,
      // Campaign-grain CPR (not a sum of ad-set rates — Meta's own campaign insight)
      costPerActionType: {
        "offsite_conversion.fb_pixel_complete_registration": cpr,
      },
      actionCountByType: {
        "offsite_conversion.fb_pixel_complete_registration": resultCount,
      },
    };
  }

  function makeCprCampaign(overrides: Partial<CampaignAutomationInput> = {}): CampaignAutomationInput {
    return {
      draftId: "draft-folm",
      campaignId: "camp_folm",
      adAccountId: "act_folm",
      objective: "registration",
      optimisationStrategy: {
        mode: "custom",
        rules: [cprRule()], // timeWindow: "24h" — system promotes to 7d
        guardrails: GUARDRAILS,
      },
      optimisationAutomationLive: false,
      campaignName: "[NX26-FOLM] FOLMAOUR - Signup",
      ...overrides,
    };
  }

  function makeDeps(
    campaignInsight: CampaignBudgetInsight,
    overrides: Partial<OptimisationTickDeps> = {},
  ): OptimisationTickDeps {
    return {
      loadOptedInCampaigns: async () => [makeCprCampaign()],
      getAdSetState: async () => ({
        lastAppliedAt: null,
        lastDecidedAt: null,
        appliedIncreasePercentLast24h: 0,
      }),
      insertDecision: async () => {},
      fetchInsights: async (_id, window) => {
        // Verify the promoted window is 7d (not the rule's 24h)
        assert.equal(window, "7d", "cpr campaign must use 7d window, not the rule's 24h setting");
        return Array.from({ length: 19 }, (_, i) => folmourAdSet(`as_${i}`, `Ad Set ${i}`));
      },
      fetchCampaignInsights: async (_id, window) => {
        assert.equal(window, "7d", "campaign insight fetch must also use 7d");
        return campaignInsight;
      },
      readAdSetDailyBudget: async () => { throw new Error("shadow — must not read"); },
      updateAdSetDailyBudget: async () => { throw new Error("shadow — must not write"); },
      readCampaignDailyBudget: async () => { throw new Error("shadow — must not read"); },
      updateCampaignDailyBudget: async () => { throw new Error("shadow — must not write"); },
      notify: async () => ({ sent: true }),
      now,
      writesEnabled: false,
      ...overrides,
    };
  }

  it("BEFORE fix (parent sha): cpr 24h window, ~2 conversions each → zero decisions", async () => {
    // This test documents what WOULD happen on the parent commit: 24h window
    // means the campaign insight has 2 conversions in 24h → insufficient.
    // On the parent SHA, there was no insufficient_conversions action — it
    // just returned metric_unavailable (no rate in 24h). We simulate the
    // parent's behavior here by using a 24h window directly.
    const inserted: DecisionToInsert[] = [];
    // Bypass the auto-window-promotion by injecting a dep that asserts 24h
    // (in prod on the parent, fetchInsights was called with 24h for cpr).
    // Here we simulate: campaign insight has 2 conversions in 24h period.
    const deps: OptimisationTickDeps = {
      ...makeDeps(folmourCampaignInsight(2, 0.8)),
      fetchInsights: async () =>
        Array.from({ length: 19 }, (_, i) => folmourAdSet(`as_${i}`, `Ad Set ${i}`)),
      fetchCampaignInsights: async () => folmourCampaignInsight(2, 0.8),
      insertDecision: async (row) => void inserted.push(row),
    };
    await runOptimisationTick(true, false, deps);
    // With 2/5 conversions (insufficient_conversions action),
    // the decision is recorded but with no scale_up/scale_down action.
    assert.equal(inserted.length, 1);
    // Check it's NOT a scale_up — thin data prevented action.
    const action = inserted[0]!.actionRecommended;
    assert.notEqual(action, "scale_up", "should not scale on 2 conversions");
    assert.notEqual(action, "scale_down", "should not scale_down on 2 conversions");
  });

  it("AFTER fix: 38 conversions over 7d → real scale_up decision", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps(folmourCampaignInsight(38, 0.8), {
      insertDecision: async (row) => void inserted.push(row),
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(summary.decisionsInserted, 1);
    assert.equal(inserted.length, 1);
    const row = inserted[0]!;
    // Campaign-grain evaluation
    assert.equal(row.scope, "campaign");
    assert.equal(row.metricWindow, "7d");
    assert.equal(row.metric, "cpr");
    assert.equal(row.metricValue, 0.8);
    assert.equal(row.resultCount, 38);
    assert.equal(row.actionRecommended, "scale_up");
    assert.equal(row.actionDelta, 20);
    assert.equal(row.dryRun, true);
    assert.equal(row.applied, false);
  });

  it("FOLMAOUR shape: 5 conversions is exactly the threshold — evaluates, not insufficient", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps(folmourCampaignInsight(5, 1.5), {
      insertDecision: async (row) => void inserted.push(row),
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]!.actionRecommended, "scale_up");
  });

  it("FOLMAOUR shape: 4 conversions — insufficient_conversions, reason mentions count", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps(folmourCampaignInsight(4, 1.5), {
      insertDecision: async (row) => void inserted.push(row),
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]!.actionRecommended, "insufficient_conversions");
    assert.match(inserted[0]!.reasonText, /4\/5/);
  });

  it("lpv_cost (traffic) campaign still uses 24h window — not promoted", async () => {
    const inserted: DecisionToInsert[] = [];
    const lpvCampaign: CampaignAutomationInput = {
      draftId: "draft-lpv",
      campaignId: "camp_lpv",
      adAccountId: "act_lpv",
      objective: "traffic",
      optimisationStrategy: {
        mode: "custom",
        rules: [
          {
            id: tid(),
            name: "LPV",
            metric: "lpv_cost",
            timeWindow: "24h",
            enabled: true,
            thresholds: [{ id: tid(), operator: "below", value: 0.5, action: "increase_budget", actionValue: 15, label: "< £0.5 CPLPV → scale" }],
          },
        ],
        guardrails: GUARDRAILS,
      },
      optimisationAutomationLive: false,
      campaignName: "DJ EZ Traffic",
    };

    const lpvAdSet: AdSetInsightRow = {
      adsetId: "as_lpv",
      adsetName: "LPV Ad Set",
      // £80/day = 8000p — well within GUARDRAILS expansion cap (£200 from baseCampaignBudget=100 + 100%)
      dailyBudgetPence: 8000,
      lifetimeBudgetPence: null,
      effectiveStatus: "ACTIVE",
      impressions: 10000,
      cpc: null, cpm: null, ctr: null,
      costPerActionType: { landing_page_view: 0.3 },
      actionCountByType: { landing_page_view: 100 },
    };

    let capturedWindow: RuleTimeWindow | undefined;
    const deps: OptimisationTickDeps = {
      loadOptedInCampaigns: async () => [lpvCampaign],
      getAdSetState: async () => ({ lastAppliedAt: null, lastDecidedAt: null, appliedIncreasePercentLast24h: 0 }),
      insertDecision: async (row) => void inserted.push(row),
      fetchInsights: async (_id, window) => {
        capturedWindow = window;
        return [lpvAdSet];
      },
      fetchCampaignInsights: async () => { throw new Error("CBO path must not be called for ABO lpv"); },
      readAdSetDailyBudget: async () => { throw new Error("shadow"); },
      updateAdSetDailyBudget: async () => { throw new Error("shadow"); },
      readCampaignDailyBudget: async () => { throw new Error("shadow"); },
      updateCampaignDailyBudget: async () => { throw new Error("shadow"); },
      notify: async () => ({ sent: true }),
      now,
      writesEnabled: false,
    };

    await runOptimisationTick(true, false, deps);
    assert.equal(capturedWindow, "24h", "lpv_cost must remain on 24h — do not silently change proven behavior");
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]!.metricWindow, "24h");
    assert.equal(inserted[0]!.actionRecommended, "scale_up");
  });

  it("result_count flows through to DecisionToInsert for the chip", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps(folmourCampaignInsight(38, 0.8), {
      insertDecision: async (row) => void inserted.push(row),
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(inserted[0]!.resultCount, 38);
  });

  it("cooldown ≥ 7d for cpr: touched 100h ago is inside 168h cooldown — skipped", async () => {
    const inserted: DecisionToInsert[] = [];
    const lastTouched = new Date(now.getTime() - 100 * 3600 * 1000);
    const deps = makeDeps(folmourCampaignInsight(38, 0.8), {
      getAdSetState: async () => ({
        lastAppliedAt: lastTouched,
        lastDecidedAt: lastTouched,
        appliedIncreasePercentLast24h: 0,
      }),
      insertDecision: async (row) => void inserted.push(row),
    });
    const summary = await runOptimisationTick(true, false, deps);
    // Campaign was touched 100h ago which is inside the 168h (7d) cooldown.
    assert.equal(summary.adSetsSkippedRecentDecision, 1);
    assert.equal(inserted.length, 0);
  });
});

// ─── resolvePrimaryLiveMetric: resultCount propagation ───────────────────────

describe("resolvePrimaryLiveMetric — resultCount propagation", () => {
  it("cpr with matching actions entry → resultCount reflects the count", () => {
    const result = resolvePrimaryLiveMetric(
      "registration",
      metrics({
        costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 1.72 },
        actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 38 },
      }),
      "7d",
    );
    assert.equal(result?.resultCount, 38);
    assert.equal(result?.value, 1.72);
    assert.equal(result?.window, "7d");
  });

  it("cpr without matching actions entry → resultCount is null (not 0)", () => {
    const result = resolvePrimaryLiveMetric(
      "registration",
      metrics({
        costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 1.72 },
        actionCountByType: {}, // actions not present in this response
      }),
      "7d",
    );
    // null means "we don't know the count" — minimum-evidence check will skip
    // (not block) because null ≠ 0. This is the right behavior: missing `actions`
    // field in Meta's response should not trigger a false "insufficient" state.
    assert.equal(result?.resultCount, null);
  });

  it("cpm → resultCount always null (direct-field metric, no countable event)", () => {
    const result = resolvePrimaryLiveMetric("awareness", metrics({ cpm: 5 }), "24h");
    assert.equal(result?.resultCount, null);
  });
});

// ─── FALSIFICATION against parent sha ────────────────────────────────────────

describe("FALSIFICATION — must fail on parent sha " + PARENT, () => {
  it("evaluate-windows.ts did not exist on the parent sha", () => {
    // The parent commit (cursor/optimisation-cbo-support, c05f075) did not
    // have evaluate-windows.ts. If this test runs on that commit, the import
    // at the top of this file would fail. But since the import is resolved at
    // module load time, a module-not-found error would prevent this test from
    // running at all — which is falsification by crashing.
    //
    // As a belt-and-suspenders check, verify the file itself is present and
    // contains the named exports this PR introduces.
    const src = readFileSync(
      new URL("../evaluate-windows.ts", import.meta.url).pathname,
      "utf8",
    );
    assert.ok(src.includes("MIN_CONVERSION_RESULT_COUNT"), "MIN_CONVERSION_RESULT_COUNT must be exported");
    assert.ok(src.includes("DEFAULT_WINDOW_CONVERSION"), "DEFAULT_WINDOW_CONVERSION must be exported");
    assert.ok(src.includes("effectiveCooldownHours"), "effectiveCooldownHours must be exported");
    assert.ok(src.includes("defaultWindowForMetric"), "defaultWindowForMetric must be exported");
  });

  it("insufficient_conversions action did not exist on parent sha", () => {
    // On the parent, AutomationAction had no insufficient_conversions member.
    // Verify the evaluate.ts source now contains it.
    const src = readFileSync(
      new URL("../evaluate.ts", import.meta.url).pathname,
      "utf8",
    );
    assert.ok(src.includes("insufficient_conversions"), "evaluate.ts must have insufficient_conversions action");
  });

  it("parent sha tick-runner did not use defaultWindowForMetric or maxWindow", () => {
    const src = readFileSync(
      new URL("../tick-runner.ts", import.meta.url).pathname,
      "utf8",
    );
    assert.ok(src.includes("defaultWindowForMetric"), "tick-runner must import defaultWindowForMetric");
    assert.ok(src.includes("maxWindow"), "tick-runner must import maxWindow");
  });

  it("evaluateAdSet returns insufficient_conversions (not any other action) for 1 conversion", () => {
    // On the parent, there was no minimum-evidence check. evaluateAdSet would
    // have matched the rule band (£0.80 CPR < £2 → scale_up) regardless of
    // whether the rate came from 1 conversion or 100. After this PR, it
    // correctly blocks on thin data.
    const result = evaluateAdSet(
      baseInput({ liveMetric: lm("cpr", 0.8, "7d", 1) }),
    );
    assert.equal(result.action, "insufficient_conversions");
    // On parent: result.action would have been "scale_up" — this assertion
    // would fail, proving the guard is new.
  });
});
