import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  describeOptimisationRulesMismatch,
  generateRulesForObjective,
  inferRulesObjectiveFromRules,
  OBJECTIVE_METRIC_PRIORITY,
} from "../optimisation-rules.ts";
import type {
  CampaignObjective,
  OptimisationRule,
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

describe("describeOptimisationRulesMismatch", () => {
  for (const objective of OBJECTIVES) {
    it(`${objective} rules generated for that objective report clean`, () => {
      const rules = generateRulesForObjective(objective);
      assert.equal(describeOptimisationRulesMismatch(objective, rules), null);
      assert.equal(describeOptimisationRulesMismatch(objective, rules, objective), null);
    });
  }

  it("registration draft with cpr rules reports clean", () => {
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

  it("[IRW0001] purchase + cpr primary is mismatched and names purchase", () => {
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

  it("[NX26-FOLAMOUR] purchase + cpr primary is mismatched and names purchase", () => {
    const mismatch = describeOptimisationRulesMismatch(
      "purchase",
      cprPrimary("Cost per Registration"),
    );
    assert.ok(mismatch);
    assert.equal(mismatch.expectedObjective, "purchase");
    assert.equal(mismatch.writtenFor, "registration");
  });

  it("[NX26-DOD] On sale — purchase + cpr primary is mismatched and names purchase", () => {
    const mismatch = describeOptimisationRulesMismatch(
      "purchase",
      cprPrimary("Cost per Registration"),
    );
    assert.ok(mismatch);
    assert.equal(mismatch.expectedObjective, "purchase");
    assert.equal(mismatch.writtenFor, "registration");
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
    // The helper is pure. Custom mode does not call generateRulesForObjective.
    assert.equal(cprPrimary()[0]!.metric, "cpr");
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
    const rules = cprPrimary();
    assert.equal(inferRulesObjectiveFromRules(rules), "registration");
  });

  it("purchase + lpv_cost classifies as traffic", () => {
    assert.equal(inferRulesObjectiveFromRules(lpvPrimary()), "traffic");
  });

  it("cpa + roas classifies as purchase, not initiate_checkout", () => {
    assert.equal(
      inferRulesObjectiveFromRules(generateRulesForObjective("purchase")),
      "purchase",
    );
  });

  it("cpa without a secondary classifies as initiate_checkout", () => {
    assert.equal(
      inferRulesObjectiveFromRules(generateRulesForObjective("initiate_checkout")),
      "initiate_checkout",
    );
  });

  it("empty rules cannot be classified", () => {
    assert.equal(inferRulesObjectiveFromRules([]), null);
  });

  it("migrateDraft defaults rulesObjective from the primary metric when absent", () => {
    const src = readFileSync("lib/autosave.ts", "utf8");
    assert.match(src, /inferRulesObjectiveFromRules/);
    assert.match(src, /rulesObjective/);
    assert.match(
      src,
      /if \(draft\.optimisationStrategy\.rulesObjective == null\)/,
    );
  });
});

describe("wizard hole — Campaign Setup records the stamp, Optimisation does not silently overwrite custom", () => {
  it("Campaign Setup never calls generateRulesForObjective", () => {
    const src = readFileSync("components/steps/campaign-setup.tsx", "utf8");
    assert.doesNotMatch(src, /generateRulesForObjective/);
    assert.match(src, /inferRulesObjectiveFromRules/);
    assert.match(src, /rulesObjective/);
  });

  it("Optimisation only auto-regenerates in benchmarks mode without a preset", () => {
    const src = readFileSync("components/steps/optimisation-strategy.tsx", "utf8");
    assert.match(
      src,
      /if \(strategy\.mode === "benchmarks" && !strategy\.preset\)/,
    );
    assert.match(src, /describeOptimisationRulesMismatch/);
    assert.match(src, /Regenerate for/);
  });
});
