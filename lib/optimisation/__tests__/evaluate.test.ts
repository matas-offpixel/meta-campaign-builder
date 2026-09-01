/**
 * Tests for lib/optimisation/evaluate.ts — task #120 PR A dry-run evaluator.
 *
 * Run: node --test lib/optimisation/__tests__/evaluate.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateAdSet,
  evaluateCampaign,
  resolveLastTouchedAt,
  type EvaluateAdSetInput,
} from "../evaluate.ts";
import type { BudgetGuardrails, OptimisationRule } from "../../types.ts";

function tid(): string {
  return Math.random().toString(36).slice(2);
}

const CPR_RULE: OptimisationRule = {
  id: tid(),
  name: "Primary Rule Set — Cost per Registration",
  metric: "cpr",
  timeWindow: "24h",
  enabled: true,
  priority: "primary",
  thresholds: [
    { id: tid(), operator: "below", value: 1, action: "increase_budget", actionValue: 30, label: "Below £1 CPR → scale aggressively (+30%)" },
    { id: tid(), operator: "between", value: 1, valueTo: 2, action: "increase_budget", actionValue: 10, label: "£1–£2 CPR → scale moderately (+10%)" },
    { id: tid(), operator: "between", value: 2, valueTo: 3, action: "decrease_budget", actionValue: 0, label: "£2–£3 CPR → maintain" },
    { id: tid(), operator: "between", value: 3, valueTo: 5, action: "decrease_budget", actionValue: 25, label: "£3–£5 CPR → reduce (-25%)" },
    { id: tid(), operator: "above", value: 5, action: "pause", label: "Above £5 CPR → pause ad set" },
  ],
};

const GUARDRAILS: BudgetGuardrails = {
  baseCampaignBudget: 100, // £100/day
  maxExpansionPercent: 50, // ceiling from base = £150/day
  hardBudgetCeiling: 150,
  ceilingBehaviour: "stop",
};

function baseInput(overrides: Partial<EvaluateAdSetInput> = {}): EvaluateAdSetInput {
  return {
    rules: [CPR_RULE],
    guardrails: GUARDRAILS,
    currentBudgetPence: 10000, // £100/day
    liveMetric: { name: "cpr", value: 0.5, window: "24h" },
    lastTouchedAt: null,
    impressions: 1000,
    now: new Date("2026-08-07T12:00:00Z"),
    ...overrides,
  };
}

describe("evaluateAdSet — rule band matching", () => {
  it("below threshold → scale_up with the matched threshold's actionValue", () => {
    const result = evaluateAdSet(baseInput({ liveMetric: { name: "cpr", value: 0.5, window: "24h" } }));
    assert.equal(result.action, "scale_up");
    assert.equal(result.deltaPercent, 30);
    assert.equal(result.budgetAfterPence, 13000);
    assert.equal(result.ruleMatched, "Below £1 CPR → scale aggressively (+30%)");
    assert.equal(result.guardrailNote, null);
  });

  it("between threshold → scale_up with the moderate band", () => {
    const result = evaluateAdSet(baseInput({ liveMetric: { name: "cpr", value: 1.5, window: "24h" } }));
    assert.equal(result.action, "scale_up");
    assert.equal(result.deltaPercent, 10);
    assert.equal(result.budgetAfterPence, 11000);
  });

  it("between threshold with actionValue 0 → maintain", () => {
    const result = evaluateAdSet(baseInput({ liveMetric: { name: "cpr", value: 2.5, window: "24h" } }));
    assert.equal(result.action, "maintain");
    assert.equal(result.deltaPercent, 0);
    assert.equal(result.budgetAfterPence, 10000);
  });

  it("between threshold with a real decrease → scale_down", () => {
    const result = evaluateAdSet(baseInput({ liveMetric: { name: "cpr", value: 4, window: "24h" } }));
    assert.equal(result.action, "scale_down");
    assert.equal(result.deltaPercent, -25);
    assert.equal(result.budgetAfterPence, 7500);
  });

  it("above threshold → pause, budget unchanged", () => {
    const result = evaluateAdSet(baseInput({ liveMetric: { name: "cpr", value: 6, window: "24h" } }));
    assert.equal(result.action, "pause");
    assert.equal(result.deltaPercent, null);
    assert.equal(result.budgetAfterPence, 10000);
  });

  it("no band matches (gap in thresholds) → maintain with ruleMatched null", () => {
    const gappyRule: OptimisationRule = {
      ...CPR_RULE,
      thresholds: [
        { id: tid(), operator: "below", value: 1, action: "increase_budget", actionValue: 30, label: "low" },
        // Deliberate gap: nothing covers 1..999.
        { id: tid(), operator: "above", value: 999, action: "pause", label: "high" },
      ],
    };
    const result = evaluateAdSet(baseInput({ rules: [gappyRule], liveMetric: { name: "cpr", value: 50, window: "24h" } }));
    assert.equal(result.action, "maintain");
    assert.equal(result.ruleMatched, null);
  });

  it("no enabled rule for the metric → maintain with ruleMatched null", () => {
    const disabledRule: OptimisationRule = { ...CPR_RULE, enabled: false };
    const result = evaluateAdSet(baseInput({ rules: [disabledRule] }));
    assert.equal(result.action, "maintain");
    assert.equal(result.ruleMatched, null);
    assert.match(result.reason, /No enabled rule/);
  });
});

describe("evaluateAdSet — guardrails", () => {
  it("clamps to the hard ceiling when it is the tighter cap (ceilingBehaviour=partial)", () => {
    const guardrails: BudgetGuardrails = {
      baseCampaignBudget: 100,
      maxExpansionPercent: 100, // expansion cap = £200 — looser than hard ceiling
      hardBudgetCeiling: 120, // tighter — this one binds
      ceilingBehaviour: "partial",
    };
    // £100 budget +30% = £130, which exceeds the £120 hard ceiling.
    const result = evaluateAdSet(
      baseInput({ guardrails, currentBudgetPence: 10000, liveMetric: { name: "cpr", value: 0.5, window: "24h" } }),
    );
    assert.equal(result.action, "scale_up");
    assert.equal(result.budgetAfterPence, 12000); // clamped to £120
    assert.equal(result.guardrailNote, "hit_hard_ceiling");
  });

  it("clamps to the max-expansion cap when it is the tighter cap", () => {
    const guardrails: BudgetGuardrails = {
      baseCampaignBudget: 100,
      maxExpansionPercent: 10, // expansion cap = £110 — tighter, this one binds
      hardBudgetCeiling: 500,
      ceilingBehaviour: "partial",
    };
    const result = evaluateAdSet(
      baseInput({ guardrails, currentBudgetPence: 10000, liveMetric: { name: "cpr", value: 0.5, window: "24h" } }),
    );
    assert.equal(result.action, "scale_up");
    assert.equal(result.budgetAfterPence, 11000); // clamped to £110
    assert.equal(result.guardrailNote, "capped_by_max_expansion");
  });

  it("ceilingBehaviour=stop maintains (no scale) once at the cap", () => {
    const guardrails: BudgetGuardrails = { ...GUARDRAILS, hardBudgetCeiling: 105, maxExpansionPercent: 5, ceilingBehaviour: "stop" };
    const result = evaluateAdSet(baseInput({ guardrails, currentBudgetPence: 10000 }));
    assert.equal(result.action, "maintain");
    assert.equal(result.budgetAfterPence, 10000);
    assert.ok(result.guardrailNote);
  });

  it("ceilingBehaviour=pause_scaling flips to pause once at the cap", () => {
    const guardrails: BudgetGuardrails = { ...GUARDRAILS, hardBudgetCeiling: 105, maxExpansionPercent: 5, ceilingBehaviour: "pause_scaling" };
    const result = evaluateAdSet(baseInput({ guardrails, currentBudgetPence: 10000 }));
    assert.equal(result.action, "pause");
    assert.equal(result.budgetAfterPence, 10000);
    assert.ok(result.guardrailNote);
  });

  it("scale_down never consults the ceiling guardrails", () => {
    const guardrails: BudgetGuardrails = { ...GUARDRAILS, hardBudgetCeiling: 1, maxExpansionPercent: 1 };
    const result = evaluateAdSet(baseInput({ guardrails, liveMetric: { name: "cpr", value: 4, window: "24h" } }));
    assert.equal(result.action, "scale_down");
    assert.equal(result.guardrailNote, null);
  });

  it("maxSingleAdSetBudget fixed clamps tighter than the campaign ceilings (partial)", () => {
    const guardrails: BudgetGuardrails = {
      baseCampaignBudget: 100,
      maxExpansionPercent: 100, // £200
      hardBudgetCeiling: 200,
      ceilingBehaviour: "partial",
      maxSingleAdSetBudget: 110, // £110 fixed — tightest
      maxSingleAdSetBudgetType: "fixed",
    };
    // £100 +30% = £130 → clamp to £110
    const result = evaluateAdSet(baseInput({ guardrails, currentBudgetPence: 10000 }));
    assert.equal(result.action, "scale_up");
    assert.equal(result.budgetAfterPence, 11000);
    assert.equal(result.guardrailNote, "capped_by_max_single_adset_budget");
  });

  it("maxSingleAdSetBudget percent is of baseCampaignBudget, not of current", () => {
    const guardrails: BudgetGuardrails = {
      baseCampaignBudget: 100,
      maxExpansionPercent: 100,
      hardBudgetCeiling: 500,
      ceilingBehaviour: "partial",
      maxSingleAdSetBudget: 115, // 115% of £100 = £115
      maxSingleAdSetBudgetType: "percent",
    };
    const result = evaluateAdSet(baseInput({ guardrails, currentBudgetPence: 10000 }));
    assert.equal(result.action, "scale_up");
    assert.equal(result.budgetAfterPence, 11500);
    assert.equal(result.guardrailNote, "capped_by_max_single_adset_budget");
  });

  it("maxDailyIncreasePercent clamps the remaining increase after prior applied deltas", () => {
    const guardrails: BudgetGuardrails = {
      baseCampaignBudget: 100,
      maxExpansionPercent: 100,
      hardBudgetCeiling: 500,
      ceilingBehaviour: "partial",
      maxDailyIncreasePercent: 25,
    };
    // Already +20% applied today; remaining +5% of £100 = £105
    const result = evaluateAdSet(
      baseInput({ guardrails, currentBudgetPence: 10000, appliedIncreasePercentLast24h: 20 }),
    );
    assert.equal(result.action, "scale_up");
    assert.equal(result.budgetAfterPence, 10500);
    assert.equal(result.guardrailNote, "capped_by_max_daily_increase");
  });

  it("maxDailyIncreasePercent already exhausted → ceilingBehaviour=stop maintains", () => {
    const guardrails: BudgetGuardrails = {
      baseCampaignBudget: 100,
      maxExpansionPercent: 100,
      hardBudgetCeiling: 500,
      ceilingBehaviour: "stop",
      maxDailyIncreasePercent: 20,
    };
    const result = evaluateAdSet(
      baseInput({ guardrails, currentBudgetPence: 10000, appliedIncreasePercentLast24h: 20 }),
    );
    assert.equal(result.action, "maintain");
    assert.equal(result.budgetAfterPence, 10000);
    assert.equal(result.guardrailNote, "capped_by_max_daily_increase");
  });

  it("hardBudgetCeiling still wins a tie with maxSingleAdSetBudget", () => {
    const guardrails: BudgetGuardrails = {
      baseCampaignBudget: 100,
      maxExpansionPercent: 100,
      hardBudgetCeiling: 110,
      ceilingBehaviour: "partial",
      maxSingleAdSetBudget: 110,
      maxSingleAdSetBudgetType: "fixed",
    };
    const result = evaluateAdSet(baseInput({ guardrails, currentBudgetPence: 10000 }));
    assert.equal(result.budgetAfterPence, 11000);
    assert.equal(result.guardrailNote, "hit_hard_ceiling");
  });

  it("maxSingleAdSetBudget binds over a looser hard ceiling and expansion", () => {
    const guardrails: BudgetGuardrails = {
      baseCampaignBudget: 100,
      maxExpansionPercent: 50, // £150
      hardBudgetCeiling: 150,
      ceilingBehaviour: "partial",
      maxSingleAdSetBudget: 120,
      maxSingleAdSetBudgetType: "fixed",
      maxDailyIncreasePercent: 80, // +80% of current = £180 — looser
    };
    const result = evaluateAdSet(baseInput({ guardrails, currentBudgetPence: 10000 }));
    assert.equal(result.budgetAfterPence, 12000);
    assert.equal(result.guardrailNote, "capped_by_max_single_adset_budget");
  });
});

describe("evaluateAdSet — dormant / recent-touch skips", () => {
  it("0 impressions → skip_dormant regardless of the metric value", () => {
    const result = evaluateAdSet(baseInput({ impressions: 0, liveMetric: { name: "cpr", value: 0.1, window: "24h" } }));
    assert.equal(result.action, "skip_dormant");
    assert.equal(result.budgetAfterPence, 10000);
    assert.equal(result.ruleMatched, null);
  });

  it("touched inside the default 24h cooldown → skip_recent_touch", () => {
    const now = new Date("2026-08-07T12:00:00Z");
    const lastTouchedAt = new Date("2026-08-07T06:00:00Z"); // 6h ago
    const result = evaluateAdSet(baseInput({ now, lastTouchedAt }));
    assert.equal(result.action, "skip_recent_touch");
  });

  it("touched outside the cooldown window → evaluates normally", () => {
    const now = new Date("2026-08-07T12:00:00Z");
    const lastTouchedAt = new Date("2026-08-06T00:00:00Z"); // 36h ago
    const result = evaluateAdSet(baseInput({ now, lastTouchedAt }));
    assert.equal(result.action, "scale_up");
  });

  it("respects a custom guardrails.cooldownHours over the 24h default", () => {
    const now = new Date("2026-08-07T12:00:00Z");
    const lastTouchedAt = new Date("2026-08-07T09:00:00Z"); // 3h ago
    const guardrails: BudgetGuardrails = { ...GUARDRAILS, cooldownHours: 2 };
    const result = evaluateAdSet(baseInput({ now, lastTouchedAt, guardrails }));
    // 3h ago is outside a 2h cooldown → evaluates normally, not skipped.
    assert.equal(result.action, "scale_up");
  });

  it("dormant check takes precedence over recent-touch", () => {
    const now = new Date("2026-08-07T12:00:00Z");
    const lastTouchedAt = new Date("2026-08-07T11:00:00Z"); // 1h ago — would also skip_recent_touch
    const result = evaluateAdSet(baseInput({ now, lastTouchedAt, impressions: 0 }));
    assert.equal(result.action, "skip_dormant");
  });

  it("resolveLastTouchedAt prefers applied_at over decided_at", () => {
    const applied = new Date("2026-08-19T10:00:00Z");
    const decided = new Date("2026-08-20T08:00:00Z");
    assert.equal(resolveLastTouchedAt(applied, decided), applied);
  });

  it("resolveLastTouchedAt falls back to decided_at when never written", () => {
    const decided = new Date("2026-08-20T08:00:00Z");
    assert.equal(resolveLastTouchedAt(null, decided), decided);
    assert.equal(resolveLastTouchedAt(null, null), null);
  });
});

describe("evaluateCampaign — CBO guardrails at campaign grain", () => {
  it("hard ceiling binds on the campaign daily budget", () => {
    const guardrails: BudgetGuardrails = {
      baseCampaignBudget: 100,
      maxExpansionPercent: 100,
      hardBudgetCeiling: 120,
      ceilingBehaviour: "partial",
    };
    const result = evaluateCampaign(
      baseInput({
        guardrails,
        currentBudgetPence: 10000,
        liveMetric: { name: "cpr", value: 0.5, window: "24h" },
      }),
    );
    assert.equal(result.action, "scale_up");
    assert.equal(result.budgetAfterPence, 12000);
    assert.equal(result.guardrailNote, "hit_hard_ceiling");
  });

  it("maxSingleAdSetBudget does not bind on the CBO path", () => {
    const guardrails: BudgetGuardrails = {
      baseCampaignBudget: 100,
      maxExpansionPercent: 100,
      hardBudgetCeiling: 500,
      ceilingBehaviour: "partial",
      maxSingleAdSetBudget: 50,
      maxSingleAdSetBudgetType: "fixed",
    };
    const adSet = evaluateAdSet(
      baseInput({
        guardrails,
        currentBudgetPence: 10000,
        liveMetric: { name: "cpr", value: 0.5, window: "24h" },
      }),
    );
    assert.equal(adSet.guardrailNote, "capped_by_max_single_adset_budget");
    const campaign = evaluateCampaign(
      baseInput({
        guardrails,
        currentBudgetPence: 10000,
        liveMetric: { name: "cpr", value: 0.5, window: "24h" },
      }),
    );
    assert.equal(campaign.action, "scale_up");
    assert.equal(campaign.budgetAfterPence, 13000);
    assert.equal(campaign.guardrailNote, null);
  });
});
