import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACCOUNT_BENCHMARKS,
  describeLadderReadiness,
  describeOptimisationRulesMismatch,
  generateRulesForObjective,
  getAccountBenchmarkMedian,
  metricLabelFor,
  OBJECTIVE_METRIC_PRIORITY,
} from "../optimisation-rules.ts";
import { evaluateAdSet } from "../optimisation/evaluate.ts";
import { resolvePrimaryLiveMetric } from "../optimisation/live-metric.ts";
import { industrySeedPreset, materialiseStrategy, ruleToPresetRule } from "../optimisation/presets.ts";
import type { BudgetGuardrails, OptimisationRule } from "../types.ts";

const GUARDRAILS: BudgetGuardrails = {
  baseCampaignBudget: 100,
  maxExpansionPercent: 50,
  hardBudgetCeiling: 150,
  ceilingBehaviour: "stop",
};

function purchaseThresholdSnapshot(rules: OptimisationRule[]) {
  return rules.map((r) => ({
    metric: r.metric,
    priority: r.priority,
    thresholds: r.thresholds.map((t) => ({
      operator: t.operator,
      value: t.value,
      valueTo: t.valueTo,
      action: t.action,
      actionValue: t.actionValue,
    })),
  }));
}

describe("initiate_checkout has its own numbers — or honestly none", () => {
  it("the generated ladder has no bands and no borrowed median", () => {
    const rules = generateRulesForObjective("initiate_checkout");
    assert.equal(rules.length, 1);
    assert.equal(rules[0]!.metric, "cpic");
    assert.deepEqual(rules[0]!.thresholds, []);
    assert.equal(rules[0]!.useOverride, false);
    assert.equal(rules[0]!.campaignTargetValue, undefined);
    assert.equal(getAccountBenchmarkMedian("initiate_checkout", "cpic"), undefined);
    assert.equal(getAccountBenchmarkMedian("initiate_checkout", "cpa"), undefined);
    assert.equal(
      ACCOUNT_BENCHMARKS.initiate_checkout.some((b) => b.tag === "primary"),
      false,
    );
  });

  it("no campaign target is a named no-action, not maintain and not a scale-up", () => {
    const rules = generateRulesForObjective("initiate_checkout");
    const readiness = describeLadderReadiness("initiate_checkout", rules);
    assert.equal(readiness.status, "insufficient_evidence");
    assert.match(readiness.reason, /will not act/);

    const result = evaluateAdSet({
      rules,
      guardrails: GUARDRAILS,
      currentBudgetPence: 10000,
      liveMetric: { name: "cpic", value: 4.2, window: "3d", resultCount: 20 },
      lastTouchedAt: null,
      impressions: 1000,
      now: new Date("2026-09-13T12:00:00Z"),
    });
    assert.notEqual(result.action, "scale_up");
    assert.notEqual(result.action, "scale_down");
    assert.notEqual(result.action, "pause");
    // evaluate.ts names empty bands `maintain`. The step names the absence
    // `insufficient_evidence`. We do not unfreeze evaluate.ts to rename it.
    assert.equal(result.action, "maintain");
    assert.equal(result.deltaPercent, null);
  });

  it("a purchase ladder on checkout is a mismatch once the signatures differ", () => {
    const purchaseRules = generateRulesForObjective("purchase");
    const mismatch = describeOptimisationRulesMismatch(
      "initiate_checkout",
      purchaseRules,
    );
    assert.ok(mismatch);
    assert.equal(mismatch.expectedObjective, "initiate_checkout");
    assert.equal(mismatch.expectedPrimary, "cpic");
    assert.equal(mismatch.actualPrimary, "cpa");
    assert.equal(mismatch.writtenFor, "purchase");
  });

  it("a purchase ladder's ROAS rule is not evaluated on a checkout live metric", () => {
    const purchaseRules = generateRulesForObjective("purchase");
    const result = evaluateAdSet({
      rules: purchaseRules,
      guardrails: GUARDRAILS,
      currentBudgetPence: 10000,
      liveMetric: { name: "cpic", value: 4.2, window: "3d", resultCount: 20 },
      lastTouchedAt: null,
      impressions: 1000,
      now: new Date("2026-09-13T12:00:00Z"),
    });
    assert.equal(result.action, "maintain");
    assert.match(result.reason, /No enabled rule configured for metric "cpic"/);
    assert.equal(result.ruleMatched, null);
  });

  it("the tick's live metric for checkout is cpic, never roas, never purchase cpa", () => {
    const reading = resolvePrimaryLiveMetric(
      "initiate_checkout",
      {
        impressions: 1000,
        cpc: null,
        cpm: null,
        ctr: null,
        costPerActionType: {
          purchase: 15,
          roas: 0.1,
          "offsite_conversion.fb_pixel_initiate_checkout": 4.2,
        },
        actionCountByType: {
          purchase: 2,
          "offsite_conversion.fb_pixel_initiate_checkout": 9,
        },
      },
      "3d",
    );
    assert.equal(reading?.name, "cpic");
    assert.equal(reading?.value, 4.2);
  });

  it("a purchase campaign's rules are byte-identical to the previous ladder", () => {
    const rules = generateRulesForObjective("purchase");
    assert.deepEqual(purchaseThresholdSnapshot(rules), [
      {
        metric: "cpa",
        priority: "primary",
        thresholds: [
          { operator: "below", value: 10, valueTo: undefined, action: "increase_budget", actionValue: 30 },
          { operator: "between", value: 10, valueTo: 18, action: "increase_budget", actionValue: 10 },
          { operator: "between", value: 18, valueTo: 30, action: "maintain", actionValue: 0 },
          { operator: "between", value: 30, valueTo: 45, action: "decrease_budget", actionValue: 25 },
          { operator: "above", value: 45, valueTo: undefined, action: "pause", actionValue: undefined },
        ],
      },
      {
        metric: "roas",
        priority: "secondary",
        thresholds: [
          { operator: "above", value: 5, valueTo: undefined, action: "increase_budget", actionValue: 15 },
          { operator: "between", value: 3, valueTo: 5, action: "maintain", actionValue: 0 },
          { operator: "below", value: 1.5, valueTo: undefined, action: "decrease_budget", actionValue: 30 },
          { operator: "below", value: 0.8, valueTo: undefined, action: "pause", actionValue: undefined },
        ],
      },
    ]);
    assert.equal(getAccountBenchmarkMedian("purchase", "cpa"), 18);
  });

  it("the step label is Cost per Initiate Checkout, never CPP", () => {
    assert.equal(
      metricLabelFor("initiate_checkout", "cpic"),
      "Cost per Initiate Checkout",
    );
    assert.equal(OBJECTIVE_METRIC_PRIORITY.initiate_checkout.primaryLabel, "Cost per Initiate Checkout");
    assert.notEqual(metricLabelFor("initiate_checkout", "cpic"), "CPP");
    assert.equal(metricLabelFor("purchase", "cpa"), "Cost per Purchase");
  });

  it("setting a campaign target arms the ladder via regenerateThresholdsFromTarget", () => {
    const [rule] = generateRulesForObjective("initiate_checkout");
    assert.ok(rule);
    const armed = {
      ...rule,
      useOverride: true,
      campaignTargetValue: 6,
      thresholds: [
        {
          id: "t",
          operator: "below" as const,
          value: 2.4,
          action: "increase_budget" as const,
          actionValue: 30,
          label: "from target",
        },
      ],
    };
    assert.equal(describeLadderReadiness("initiate_checkout", [armed]).status, "armed");
  });

  it("industry seed and ruleToPresetRule keep empty checkout bands empty", () => {
    const [rule] = generateRulesForObjective("initiate_checkout");
    assert.ok(rule);
    assert.deepEqual(ruleToPresetRule(rule).thresholds, []);
    const seed = industrySeedPreset("client-a", "initiate_checkout");
    assert.equal(seed.rules[0]?.metric, "cpic");
    assert.deepEqual(seed.rules[0]?.thresholds, []);
    assert.equal(seed.defaultArm, "off");
  });

  it("materialiseStrategy cannot arm a checkout ladder even once a target is set", () => {
    const seed = industrySeedPreset("client-a", "initiate_checkout");
    const strategy = materialiseStrategy(seed, {
      value: 6,
      unit: null,
      budgetAmount: 100,
      materialisedAt: "2026-09-13T12:00:00.000Z",
    });
    assert.equal(strategy.rules[0]?.metric, "cpic");
    assert.deepEqual(strategy.rules[0]?.thresholds, []);
    assert.equal(strategy.preset?.targetValue, 6);
  });
});
