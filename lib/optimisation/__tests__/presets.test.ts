import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateRulesForObjective,
  regenerateThresholdsFromTarget,
  OBJECTIVE_METRIC_PRIORITY,
} from "../../optimisation-rules.ts";
import {
  DEFAULT_COST_LADDER,
  DEFAULT_INVERSE_LADDER,
  defaultLadderFor,
  industrySeedPreset,
  industrySeedPresetId,
  isIndustrySeedPresetId,
  materialiseGuardrails,
  materialiseStrategy,
  presetPrimaryRule,
  presetVersionLabel,
  resolvePreset,
  ruleToPresetRule,
  type ClientOptimisationPreset,
  type PresetRule,
} from "../presets.ts";
import type { CampaignObjective, OptimisationRule } from "../../types.ts";

const OBJECTIVES: CampaignObjective[] = [
  "registration",
  "traffic",
  "purchase",
  "awareness",
  "engagement",
];

const AT = "2026-09-04T12:00:00.000Z";

function savedPreset(
  overrides: Partial<ClientOptimisationPreset> = {},
): ClientOptimisationPreset {
  const rules: PresetRule[] = [
    {
      metric: "cpr",
      timeWindow: "7d",
      enabled: true,
      name: "Primary Rule Set — Cost per Registration",
      priority: "primary",
      benchmarkTarget: 1.6,
      thresholds: [...DEFAULT_COST_LADDER],
    },
  ];
  return {
    id: "11111111-1111-1111-1111-111111111111",
    clientId: "client-a",
    objective: "registration",
    version: 3,
    defaultArm: "shadow",
    mode: "benchmarks",
    rules,
    guardrails: { maxExpansionPercent: 50, ceilingBehaviour: "partial", cooldownHours: 12 },
    updatedAt: AT,
    ...overrides,
  };
}

describe("resolvePreset — fallback chain", () => {
  it("returns the stored preset for an exact client × objective match", () => {
    const stored = savedPreset();
    const resolved = resolvePreset("client-a", "registration", [stored]);
    assert.equal(resolved.source, "manual entry");
    assert.equal(resolved.seedLabel, null);
    assert.equal(resolved.preset.id, stored.id);
    assert.equal(resolved.preset.version, 3);
  });

  it("falls back to the industry seed when the client has no preset at all", () => {
    const resolved = resolvePreset("client-a", "registration", null);
    assert.equal(resolved.source, "industry seed");
    assert.match(resolved.seedLabel ?? "", /industry seed/);
    assert.equal(resolved.preset.id, industrySeedPresetId("registration"));
    assert.equal(resolved.preset.version, 0);
  });

  it("does not fall back across objectives — a signup ladder never serves sales", () => {
    const stored = savedPreset({ objective: "registration" });
    const resolved = resolvePreset("client-a", "purchase", [stored]);
    assert.equal(resolved.source, "industry seed");
    assert.equal(resolved.preset.objective, "purchase");
  });

  it("does not leak another client's preset", () => {
    const stored = savedPreset({ clientId: "client-b" });
    const resolved = resolvePreset("client-a", "registration", [stored]);
    assert.equal(resolved.source, "industry seed");
  });

  it("seeds a preset for every objective, and never arms it", () => {
    for (const objective of OBJECTIVES) {
      const { preset, source } = resolvePreset("client-a", objective, []);
      assert.equal(source, "industry seed");
      assert.equal(preset.defaultArm, "off", objective);
      assert.ok(preset.rules.length > 0, objective);
      assert.ok(isIndustrySeedPresetId(preset.id), objective);
    }
  });
});

describe("ruleToPresetRule — absolute bands become multipliers", () => {
  it("divides each band by the campaign target when one is set", () => {
    const rule: OptimisationRule = {
      id: "r1",
      name: "CPR",
      metric: "cpr",
      timeWindow: "7d",
      enabled: true,
      useOverride: true,
      campaignTargetValue: 2,
      accountBenchmarkValue: 1.6,
      thresholds: [
        { id: "t1", operator: "below", value: 0.8, action: "increase_budget", actionValue: 30, label: "" },
        { id: "t2", operator: "between", value: 0.8, valueTo: 1.3, action: "increase_budget", actionValue: 15, label: "" },
        { id: "t3", operator: "above", value: 3.5, action: "pause", label: "" },
      ],
    };
    const preset = ruleToPresetRule(rule);
    assert.equal(preset.benchmarkTarget, 2);
    assert.equal(preset.thresholds[0].multiplier, 0.4);
    assert.equal(preset.thresholds[1].multiplierTo, 0.65);
    assert.equal(preset.thresholds[2].multiplier, 1.75);
    // A pause band carries no percent.
    assert.equal(preset.thresholds[2].actionValue, undefined);
  });

  it("prefers an explicit override to the account benchmark", () => {
    const rule = generateRulesForObjective("registration")[0];
    const withOverride: OptimisationRule = {
      ...rule,
      useOverride: true,
      campaignTargetValue: 4,
    };
    assert.equal(ruleToPresetRule(withOverride).benchmarkTarget, 4);
    assert.equal(ruleToPresetRule(rule).benchmarkTarget, rule.accountBenchmarkValue);
  });

  it("keeps the default ladder rather than dividing by a missing target", () => {
    const rule: OptimisationRule = {
      id: "r1",
      name: "CPR",
      metric: "cpr",
      timeWindow: "7d",
      enabled: true,
      thresholds: [
        { id: "t1", operator: "below", value: 1, action: "increase_budget", actionValue: 30, label: "" },
      ],
    };
    const preset = ruleToPresetRule(rule, null);
    assert.equal(preset.benchmarkTarget, null);
    assert.deepEqual(preset.thresholds, [...DEFAULT_COST_LADDER]);
  });

  it("uses the inverse ladder for roas", () => {
    assert.deepEqual(defaultLadderFor("roas"), DEFAULT_INVERSE_LADDER);
    assert.deepEqual(defaultLadderFor("cpa"), DEFAULT_COST_LADDER);
  });
});

describe("materialiseStrategy", () => {
  it("is idempotent — same preset + target is deep-equal, ids included", () => {
    const preset = savedPreset();
    const target = { value: 1.2, unit: "reg" as const, budgetAmount: 120, materialisedAt: AT };
    const a = materialiseStrategy(preset, target);
    const b = materialiseStrategy(preset, target);
    assert.deepEqual(a, b);
    // Deterministic ids, not uuids — re-materialising must not churn autosave.
    assert.equal(a.rules[0].id, `${preset.id}:3:cpr`);
    assert.equal(a.rules[0].thresholds[0].id, `${preset.id}:3:cpr:0`);
  });

  it("scales the ladder around the plan target", () => {
    const strategy = materialiseStrategy(savedPreset(), {
      value: 1.2,
      unit: "reg",
      budgetAmount: 120,
      materialisedAt: AT,
    });
    const bands = strategy.rules[0].thresholds;
    assert.equal(bands[0].value, 0.48); // 0.4 × 1.20
    assert.equal(bands[1].valueTo, 0.78); // 0.65 × 1.20
    assert.equal(bands[4].value, 2.1); // 1.75 × 1.20
    assert.equal(strategy.rules[0].campaignTargetValue, 1.2);
  });

  it("falls back to the rule benchmark when the plan carries no target", () => {
    const strategy = materialiseStrategy(savedPreset(), {
      value: null,
      unit: null,
      budgetAmount: 120,
      materialisedAt: AT,
    });
    assert.equal(strategy.preset?.targetValue, null);
    assert.equal(strategy.rules[0].campaignTargetValue, 1.6);
    assert.equal(strategy.rules[0].thresholds[0].value, 0.64); // 0.4 × 1.60
  });

  it("records preset provenance without linking to the live preset", () => {
    const strategy = materialiseStrategy(savedPreset(), {
      value: 1.2,
      unit: "reg",
      budgetAmount: 120,
      materialisedAt: AT,
    });
    assert.deepEqual(strategy.preset, {
      presetId: "11111111-1111-1111-1111-111111111111",
      presetVersion: 3,
      materialisedAt: AT,
      source: "manual entry",
      targetValue: 1.2,
      targetUnit: "reg",
      targetSource: "plan",
      defaultArm: "shadow",
    });
  });

  it("labels a seeded preset industry seed even when a target was typed", () => {
    const strategy = materialiseStrategy(industrySeedPreset("client-a", "registration"), {
      value: 1.2,
      unit: "reg",
      budgetAmount: 120,
      materialisedAt: AT,
    });
    assert.equal(strategy.preset?.source, "industry seed");
    assert.equal(strategy.preset?.presetVersion, 0);
  });

  it("rescales only the ladder the target belongs to", () => {
    // Purchase carries a CPA primary and a ROAS secondary. A £30 CPA target
    // must not be read as a 30× return.
    const seed = industrySeedPreset("client-a", "purchase");
    const strategy = materialiseStrategy(seed, {
      value: 30,
      unit: "purchase",
      budgetAmount: 200,
      materialisedAt: AT,
    });
    const cpa = strategy.rules.find((r) => r.metric === "cpa");
    const roas = strategy.rules.find((r) => r.metric === "roas");
    assert.ok(cpa && roas);
    assert.equal(cpa.campaignTargetValue, 30);
    assert.equal(roas.campaignTargetValue, 3.2); // the ROAS benchmark, untouched
  });

  it("derives guardrail base and ceiling from the campaign budget", () => {
    const strategy = materialiseStrategy(savedPreset(), {
      value: 1.2,
      unit: "reg",
      budgetAmount: 120,
      materialisedAt: AT,
    });
    assert.equal(strategy.guardrails.baseCampaignBudget, 120);
    assert.equal(strategy.guardrails.maxExpansionPercent, 50);
    assert.equal(strategy.guardrails.hardBudgetCeiling, 180);
    assert.equal(strategy.guardrails.ceilingBehaviour, "partial");
    assert.equal(strategy.guardrails.cooldownHours, 12);
  });

  it("omits absent optional guardrails rather than writing undefined keys", () => {
    const guardrails = materialiseGuardrails(
      { maxExpansionPercent: 100, ceilingBehaviour: "stop" },
      50,
    );
    assert.deepEqual(Object.keys(guardrails).sort(), [
      "baseCampaignBudget",
      "ceilingBehaviour",
      "hardBudgetCeiling",
      "maxExpansionPercent",
    ]);
  });

  it("promotes a stale 24h window to the metric's floor", () => {
    // A preset saved before per-metric windows (#875) can still say 24h on a
    // conversion metric. Materialising must not hand the evaluator a window
    // narrower than its own floor.
    const preset = savedPreset({
      rules: [{ ...savedPreset().rules[0], timeWindow: "24h" }],
    });
    const strategy = materialiseStrategy(preset, {
      value: 1.2,
      unit: "reg",
      budgetAmount: 120,
      materialisedAt: AT,
    });
    assert.equal(strategy.rules[0].timeWindow, "7d");
  });

  it("leaves a fast metric's 24h window alone", () => {
    const seed = industrySeedPreset("client-a", "traffic");
    const strategy = materialiseStrategy(seed, {
      value: 0.35,
      unit: "lpv",
      budgetAmount: 60,
      materialisedAt: AT,
    });
    const lpv = strategy.rules.find((r) => r.metric === "lpv_cost");
    assert.equal(lpv?.timeWindow, "24h");
  });

  it("produces no bands when neither a target nor a benchmark exists", () => {
    const preset = savedPreset({
      rules: [{ ...savedPreset().rules[0], benchmarkTarget: null }],
    });
    const strategy = materialiseStrategy(preset, {
      value: null,
      unit: null,
      budgetAmount: 120,
      materialisedAt: AT,
    });
    // An empty ladder makes the evaluator maintain; it never invents a band.
    assert.deepEqual(strategy.rules[0].thresholds, []);
  });
});

describe("materialiseStrategy matches regenerateThresholdsFromTarget", () => {
  // The anti-drift guard: the default ladder IS today's regenerate button.
  // If either side changes, this fails rather than letting an operator see
  // two different ladders for the same target.
  const cases: Array<{ metric: "cpr" | "cpa" | "lpv_cost" | "cpm" | "roas"; target: number }> = [
    { metric: "cpr", target: 1.2 },
    { metric: "cpr", target: 1.6 },
    { metric: "cpa", target: 18 },
    { metric: "lpv_cost", target: 0.35 },
    { metric: "cpm", target: 5.5 },
    { metric: "roas", target: 3.2 },
  ];

  for (const { metric, target } of cases) {
    it(`${metric} @ ${target}`, () => {
      const preset = savedPreset({
        rules: [
          {
            metric,
            timeWindow: "7d",
            enabled: true,
            name: "guard",
            benchmarkTarget: target,
            thresholds: [...defaultLadderFor(metric)],
          },
        ],
      });
      const materialised = materialiseStrategy(preset, {
        value: target,
        unit: null,
        budgetAmount: 100,
        materialisedAt: AT,
      }).rules[0].thresholds;
      const regenerated = regenerateThresholdsFromTarget(metric, target);

      assert.equal(materialised.length, regenerated.length);
      // Ids differ by design — the materialised ones are derived from the
      // preset so the strategy is byte-identical on every re-materialise.
      const withoutId = (band: { id: string }) => ({ ...band, id: "" });
      for (let i = 0; i < regenerated.length; i += 1) {
        assert.deepEqual(
          withoutId(materialised[i]),
          withoutId(regenerated[i]),
          `${metric} band ${i}`,
        );
      }
    });
  }
});

describe("preset read helpers", () => {
  it("presetPrimaryRule picks the objective's primary metric", () => {
    for (const objective of OBJECTIVES) {
      const preset = industrySeedPreset("client-a", objective);
      const primary = presetPrimaryRule(preset);
      assert.equal(
        primary?.metric,
        OBJECTIVE_METRIC_PRIORITY[objective].primary,
        objective,
      );
    }
  });

  it("presetVersionLabel calls version 0 a seed, not v0", () => {
    assert.equal(presetVersionLabel(0), "seed");
    assert.equal(presetVersionLabel(3), "v3");
  });
});
