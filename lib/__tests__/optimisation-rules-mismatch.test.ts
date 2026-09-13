import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { migrateDraft } from "../autosave.ts";
import {
  describeOptimisationRulesMismatch,
  generateRulesForObjective,
  inferRulesObjectiveFromRules,
  OBJECTIVE_METRIC_PRIORITY,
} from "../optimisation-rules.ts";
import type {
  CampaignObjective,
  OptimisationRule,
  OptimisationStrategySettings,
  RuleMetric,
} from "../types.ts";

const OBJECTIVES: CampaignObjective[] = [
  "registration",
  "traffic",
  "purchase",
  "initiate_checkout",
  "awareness",
  "engagement",
];

const GUARDRAILS = {
  baseAdSetBudget: 50,
  baseCampaignBudget: 50,
  maxExpansionPercent: 100,
  hardBudgetCeiling: 100,
  ceilingBehaviour: "stop" as const,
};

function rule(partial: Partial<OptimisationRule> & { metric: RuleMetric }): OptimisationRule {
  return {
    id: partial.id ?? "r1",
    name: partial.name ?? "rule",
    metric: partial.metric,
    timeWindow: partial.timeWindow ?? "24h",
    enabled: partial.enabled ?? true,
    priority: partial.priority ?? "primary",
    thresholds: partial.thresholds ?? [],
    ...partial,
  };
}

function cprPrimary(name = "Cost per Registration"): OptimisationRule[] {
  return [rule({ name, metric: "cpr", timeWindow: "24h" })];
}

function lpvPrimary(name = "Cost per Landing Page View"): OptimisationRule[] {
  return [rule({ name, metric: "lpv_cost", timeWindow: "24h" })];
}

function purchaseWithoutRoas(): OptimisationRule[] {
  return generateRulesForObjective("purchase").filter((r) => r.metric !== "roas");
}

function strategyWith(
  rules: OptimisationRule[],
  extra: Partial<OptimisationStrategySettings> = {},
): OptimisationStrategySettings {
  return {
    mode: "benchmarks",
    rules,
    guardrails: { ...GUARDRAILS },
    ...extra,
  };
}

function loadStrategy(
  rules: OptimisationRule[],
  extra: Partial<OptimisationStrategySettings> = {},
): OptimisationStrategySettings {
  const strategy = strategyWith(rules, extra);
  return migrateDraft({
    settings: { objective: "purchase" },
    optimisationStrategy: strategy,
  }).optimisationStrategy;
}

describe("describeOptimisationRulesMismatch", () => {
  for (const objective of OBJECTIVES) {
    it(`${objective} rules generated for that objective report clean`, () => {
      const rules = generateRulesForObjective(objective);
      assert.equal(describeOptimisationRulesMismatch(objective, rules), null);
      assert.equal(describeOptimisationRulesMismatch(objective, rules, objective), null);
    });
  }

  it("a correct registration draft with cpr rules reports clean", () => {
    assert.equal(
      describeOptimisationRulesMismatch("registration", cprPrimary()),
      null,
    );
  });

  it("does not mutate matching rules", () => {
    const rules = generateRulesForObjective("purchase");
    const before = JSON.stringify(rules);
    assert.equal(describeOptimisationRulesMismatch("purchase", rules), null);
    inferRulesObjectiveFromRules(rules);
    assert.equal(JSON.stringify(rules), before);
  });

  it("purchase + cpr primary is mismatched and names purchase (the four prod copies)", () => {
    const mismatch = describeOptimisationRulesMismatch(
      "purchase",
      cprPrimary("Cost per Registration"),
    );
    assert.ok(mismatch);
    assert.equal(mismatch.expectedObjective, "purchase");
    assert.equal(mismatch.writtenFor, "registration");
    assert.equal(mismatch.expectedPrimary, "cpa");
    assert.equal(mismatch.actualPrimary, "cpr");
    assert.equal(mismatch.missingSecondary, "roas");
  });

  it("[NX25-DJ EZ] purchase + lpv_cost primary is mismatched and names purchase", () => {
    const mismatch = describeOptimisationRulesMismatch(
      "purchase",
      lpvPrimary("Cost per Landing Page View"),
    );
    assert.ok(mismatch);
    assert.equal(mismatch.expectedObjective, "purchase");
    assert.equal(mismatch.writtenFor, "traffic");
    assert.equal(mismatch.expectedPrimary, "cpa");
    assert.equal(mismatch.actualPrimary, "lpv_cost");
    assert.equal(mismatch.missingSecondary, "roas");
  });

  it("purchase ladder minus its roas rule is a missing-secondary mismatch", () => {
    const rules = purchaseWithoutRoas();
    assert.equal(inferRulesObjectiveFromRules(rules), "purchase");
    const mismatch = describeOptimisationRulesMismatch("purchase", rules);
    assert.ok(mismatch);
    assert.equal(mismatch.expectedObjective, "purchase");
    assert.equal(mismatch.writtenFor, "purchase");
    assert.equal(mismatch.expectedPrimary, "cpa");
    assert.equal(mismatch.actualPrimary, "cpa");
    assert.equal(mismatch.missingSecondary, "roas");
  });

  it("initiate_checkout carrying a stray roas rule is not flagged", () => {
    const rules = [
      ...generateRulesForObjective("initiate_checkout"),
      rule({
        id: "stray-roas",
        name: "ROAS",
        metric: "roas",
        priority: "secondary",
        timeWindow: "3d",
      }),
    ];
    assert.equal(inferRulesObjectiveFromRules(rules), "initiate_checkout");
    assert.equal(
      describeOptimisationRulesMismatch("initiate_checkout", rules),
      null,
    );
  });

  it("empty rules are not a mismatch — absent is not wrong", () => {
    assert.equal(describeOptimisationRulesMismatch("purchase", []), null);
    assert.equal(describeOptimisationRulesMismatch("registration", []), null);
  });

  it("a stored rulesObjective that disagrees is a mismatch even when metrics match", () => {
    const rules = generateRulesForObjective("purchase");
    const mismatch = describeOptimisationRulesMismatch(
      "purchase",
      rules,
      "registration",
    );
    assert.ok(mismatch);
    assert.equal(mismatch.writtenFor, "registration");
    assert.equal(mismatch.expectedObjective, "purchase");
    assert.equal(mismatch.actualPrimary, "cpa");
  });

  it("prefers the stored rulesObjective over metric inference for writtenFor", () => {
    const mismatch = describeOptimisationRulesMismatch(
      "purchase",
      cprPrimary(),
      "traffic",
    );
    assert.ok(mismatch);
    assert.equal(mismatch.writtenFor, "traffic");
  });

  it("custom-mode mismatch is still reported — regenerate is an offer, not an effect", () => {
    const mismatch = describeOptimisationRulesMismatch(
      "purchase",
      cprPrimary(),
      "registration",
    );
    assert.ok(mismatch);
    assert.equal(mismatch.expectedObjective, "purchase");
    assert.equal(cprPrimary()[0]!.metric, "cpr");
  });

  it("an objective outside the union is a named mismatch, not a throw", () => {
    const mismatch = describeOptimisationRulesMismatch(
      "not-an-objective" as CampaignObjective,
      cprPrimary(),
    );
    assert.ok(mismatch);
    assert.equal(mismatch.unknownObjective, true);
    assert.equal(mismatch.expectedPrimary, null);
    assert.equal(mismatch.writtenFor, "registration");
  });
});

describe("generateRulesForObjective", () => {
  it("throws the objective name instead of handing out a CPR ladder", () => {
    assert.throws(
      () => generateRulesForObjective("not-an-objective" as CampaignObjective),
      /not-an-objective/,
    );
  });

  it("regenerating a purchase draft yields the cpa primary and the roas secondary", () => {
    const rules = generateRulesForObjective("purchase");
    assert.equal(rules[0]?.metric, "cpa");
    assert.equal(rules[0]?.priority, "primary");
    assert.equal(rules[1]?.metric, "roas");
    assert.equal(rules[1]?.priority, "secondary");
    assert.equal(OBJECTIVE_METRIC_PRIORITY.purchase.primary, "cpa");
    assert.equal(OBJECTIVE_METRIC_PRIORITY.purchase.secondary, "roas");
  });
});

describe("inferRulesObjectiveFromRules", () => {
  it("purchase + cpr classifies as registration", () => {
    assert.equal(inferRulesObjectiveFromRules(cprPrimary()), "registration");
  });

  it("purchase + lpv_cost classifies as traffic", () => {
    assert.equal(inferRulesObjectiveFromRules(lpvPrimary()), "traffic");
  });

  it("cpa uniquely identifies purchase once checkout has its own metric", () => {
    assert.equal(
      inferRulesObjectiveFromRules(generateRulesForObjective("purchase")),
      "purchase",
    );
    assert.equal(
      inferRulesObjectiveFromRules(generateRulesForObjective("initiate_checkout")),
      "initiate_checkout",
    );
  });

  it("a purchase ladder minus its roas rule still infers purchase", () => {
    assert.equal(inferRulesObjectiveFromRules(purchaseWithoutRoas()), "purchase");
  });

  it("empty rules cannot be classified", () => {
    assert.equal(inferRulesObjectiveFromRules([]), null);
  });
});

describe("migrateDraft stamps rulesObjective", () => {
  it("purchase + cpr stamps registration and leaves the rules untouched", () => {
    const rules = cprPrimary();
    const snapshot = JSON.stringify(rules);
    const out = loadStrategy(rules);
    assert.equal(out.rulesObjective, "registration");
    assert.equal(JSON.stringify(out.rules), snapshot);
  });

  it("purchase minus roas stamps purchase and is still a missing-secondary mismatch", () => {
    const rules = purchaseWithoutRoas();
    const out = loadStrategy(rules);
    assert.equal(out.rulesObjective, "purchase");
    const mismatch = describeOptimisationRulesMismatch("purchase", out.rules, out.rulesObjective);
    assert.ok(mismatch);
    assert.equal(mismatch.writtenFor, "purchase");
    assert.equal(mismatch.missingSecondary, "roas");
  });

  it("initiate_checkout + stray roas stamps checkout and is not flagged", () => {
    const rules = [
      ...generateRulesForObjective("initiate_checkout"),
      rule({ id: "stray-roas", name: "ROAS", metric: "roas", priority: "secondary" }),
    ];
    const out = migrateDraft({
      settings: { objective: "initiate_checkout" },
      optimisationStrategy: strategyWith(rules),
    }).optimisationStrategy;
    assert.equal(out.rulesObjective, "initiate_checkout");
    assert.equal(
      describeOptimisationRulesMismatch("initiate_checkout", out.rules, out.rulesObjective),
      null,
    );
  });

  it("a matching draft is byte-identical after migrateDraft, stamp included", () => {
    const rules = generateRulesForObjective("registration");
    const strategy = strategyWith(rules, { rulesObjective: "registration" });
    const before = JSON.stringify(strategy);
    const out = migrateDraft({
      settings: { objective: "registration" },
      optimisationStrategy: strategy,
    }).optimisationStrategy;
    assert.equal(JSON.stringify(out), before);
    assert.equal(out.rulesObjective, "registration");
    assert.equal(JSON.stringify(out.rules), JSON.stringify(rules));
  });
});
