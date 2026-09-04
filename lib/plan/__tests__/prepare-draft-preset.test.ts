import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { OPTIMISATION_PRESET_SEED_LABEL, type ClientOptimisationPreset } from "../../optimisation/presets.ts";
import {
  applyOptimisationPreset,
  buildPrefillMetaDraft,
  planLadderObjective,
} from "../prepare-draft.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan, type CampaignPlanTarget } from "../types.ts";
import type { PlanTargetUnit } from "../../types.ts";

const CLIENT = "cl-1";
const NOW = "2026-09-04T12:00:00.000Z";

function plan(overrides: {
  target?: CampaignPlanTarget;
  objectiveIntent?: CampaignPlan["intent"]["objectiveIntent"];
  metaDaily?: number;
}): CampaignPlan {
  return {
    id: "p1",
    userId: "u1",
    name: "IRW OHD",
    status: "draft",
    intent: {
      eventId: "e1",
      objectiveIntent: overrides.objectiveIntent ?? "registration",
      budget: {
        totalDaily: overrides.metaDaily ?? 80,
        metaDaily: overrides.metaDaily ?? 80,
        tiktokDaily: 0,
        googleDaily: 0,
      },
      target: overrides.target ?? { value: null, unit: null },
      destinationUrl: "https://example.com",
      audienceClusterRef: null,
      creativeSetRef: null,
      startDate: null,
      endDate: null,
      startTime: null,
      endTime: null,
    },
    launches: {
      meta: { ...IDLE_PLAN_LAUNCH },
      tiktok: { ...IDLE_PLAN_LAUNCH },
      google: { ...IDLE_PLAN_LAUNCH },
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function storedPreset(
  overrides: Partial<ClientOptimisationPreset> = {},
): ClientOptimisationPreset {
  return {
    id: "preset-1",
    clientId: CLIENT,
    objective: "registration",
    version: 3,
    defaultArm: "shadow",
    mode: "custom",
    rules: [
      {
        metric: "cpr",
        name: "Cost per Registration",
        timeWindow: "7d",
        enabled: true,
        priority: "primary",
        benchmarkTarget: 2,
        thresholds: [
          { operator: "below", multiplier: 0.5, action: "increase_budget", actionValue: 30 },
          { operator: "between", multiplier: 0.5, multiplierTo: 1.2, action: "decrease_budget", actionValue: 0 },
          { operator: "above", multiplier: 1.2, action: "pause" },
        ],
      },
    ],
    guardrails: {
      maxExpansionPercent: 60,
      ceilingBehaviour: "partial",
      maxDailyIncreasePercent: 35,
      cooldownHours: 24,
    },
    updatedAt: NOW,
    ...overrides,
  };
}

describe("planLadderObjective — the unit wins over the intent", () => {
  it("derives the objective from the target unit when there is one", () => {
    const cases: Array<[PlanTargetUnit, string]> = [
      ["reg", "registration"],
      ["purchase", "purchase"],
      ["lpv", "traffic"],
      ["click", "traffic"],
      ["view", "awareness"],
    ];
    for (const [unit, objective] of cases) {
      const p = plan({ target: { value: 1, unit }, objectiveIntent: "registration" });
      assert.equal(planLadderObjective(p), objective, unit);
    }
  });

  it("falls back to objectiveIntent when the plan has no unit yet", () => {
    assert.equal(planLadderObjective(plan({ objectiveIntent: "purchase" })), "purchase");
  });
});

describe("applyOptimisationPreset — the one place a preset becomes a strategy", () => {
  it("materialises the stored preset at the plan's target", () => {
    const draft = buildPrefillMetaDraft(
      plan({ target: { value: 1.5, unit: "reg" } }),
      CLIENT,
      [storedPreset()],
    );
    const strategy = draft.optimisationStrategy;
    assert.equal(strategy.mode, "custom");
    assert.equal(strategy.rules.length, 1);
    assert.equal(strategy.rules[0].metric, "cpr");
    assert.equal(strategy.rules[0].campaignTargetValue, 1.5);
    // 0.5 × 1.5 and 1.2 × 1.5 — the client's shape at this campaign's price.
    assert.equal(strategy.rules[0].thresholds[0].value, 0.75);
    assert.equal(strategy.rules[0].thresholds[2].value, 1.8);
  });

  it("records provenance the wizard badge and any audit can read", () => {
    const draft = buildPrefillMetaDraft(
      plan({ target: { value: 1.5, unit: "reg" } }),
      CLIENT,
      [storedPreset()],
    );
    assert.deepEqual(draft.optimisationStrategy.preset, {
      presetId: "preset-1",
      presetVersion: 3,
      materialisedAt: draft.optimisationStrategy.preset!.materialisedAt,
      source: "manual entry",
      targetValue: 1.5,
      targetUnit: "reg",
      targetSource: "plan",
      defaultArm: "shadow",
    });
  });

  it("sets the optimisation goal from the unit, not the adapter's guess", () => {
    const draft = buildPrefillMetaDraft(
      plan({ target: { value: 0.4, unit: "lpv" }, objectiveIntent: "registration" }),
      CLIENT,
      [storedPreset({ objective: "traffic" })],
    );
    assert.equal(draft.settings.objective, "traffic");
    assert.equal(draft.settings.optimisationGoal, "landing_page_views");
  });

  it("leaves the optimisation goal alone when the plan has no unit", () => {
    const p = plan({});
    // What the Meta adapter picks with no preset in play at all.
    const adapterGoal = buildPrefillMetaDraft(p, null).settings.optimisationGoal;
    const withoutUnit = buildPrefillMetaDraft(p, CLIENT, [storedPreset()]);
    assert.equal(withoutUnit.settings.optimisationGoal, adapterGoal);
    // The strategy is still materialised — only the goal is left alone.
    assert.ok(withoutUnit.optimisationStrategy.preset);

    const withUnit = buildPrefillMetaDraft(
      plan({ target: { value: 2, unit: "reg" } }),
      CLIENT,
      [storedPreset()],
    );
    assert.equal(withUnit.settings.optimisationGoal, "complete_registration");
  });
});

describe("applyOptimisationPreset — no target, no preset", () => {
  it("falls back to the preset's benchmark target and marks the NUMBER seeded", () => {
    const draft = buildPrefillMetaDraft(plan({}), CLIENT, [storedPreset()]);
    const rule = draft.optimisationStrategy.rules[0];
    // The preset's £2 benchmark stands in for the missing zone D value.
    assert.equal(rule.campaignTargetValue, 2);
    assert.equal(rule.useOverride, false);
    assert.equal(draft.optimisationStrategy.preset?.targetValue, null);
    assert.equal(draft.optimisationStrategy.preset?.targetSource, "industry seed");
    // The ladder shape is still this client's, so `source` must not claim
    // otherwise — the two axes are recorded separately on purpose.
    assert.equal(draft.optimisationStrategy.preset?.source, "manual entry");
  });

  it("falls back to the industry seed ladder when the client has no preset", () => {
    const draft = buildPrefillMetaDraft(
      plan({ target: { value: 1.8, unit: "reg" } }),
      CLIENT,
      [],
    );
    assert.equal(draft.optimisationStrategy.preset?.source, "industry seed");
    assert.equal(draft.optimisationStrategy.preset?.presetVersion, 0);
    // The operator's number is still the operator's, seeded ladder or not.
    assert.equal(draft.optimisationStrategy.preset?.targetSource, "plan");
    assert.equal(draft.optimisationStrategy.rules[0].campaignTargetValue, 1.8);
    // A seeded preset still defaults to off — nothing arms itself.
    assert.equal(draft.optimisationStrategy.preset?.defaultArm, "off");
  });

  it("the seeded badge copy matches the funnel card's wording", () => {
    assert.match(OPTIMISATION_PRESET_SEED_LABEL, /^industry seed/);
  });

  it("ignores a preset for a different objective", () => {
    const draft = buildPrefillMetaDraft(
      plan({ target: { value: 12, unit: "purchase" } }),
      CLIENT,
      [storedPreset()],
    );
    assert.equal(draft.settings.objective, "purchase");
    // No cross-objective fallback: a signup ladder is not a sales ladder.
    assert.equal(draft.optimisationStrategy.preset?.source, "industry seed");
    assert.equal(draft.optimisationStrategy.rules[0].metric, "cpa");
  });
});

describe("applyOptimisationPreset — clientless drafts", () => {
  it("leaves the wizard's own strategy untouched with no client", () => {
    const draft = buildPrefillMetaDraft(plan({ target: { value: 2, unit: "reg" } }), null, [
      storedPreset(),
    ]);
    assert.equal(draft.optimisationStrategy.preset, undefined);
  });

  it("is a no-op when presets are not loaded at all", () => {
    const before = buildPrefillMetaDraft(plan({}), null);
    assert.equal(before.optimisationStrategy.preset, undefined);
  });
});

describe("materialisation is idempotent through prepare-draft", () => {
  it("same plan + same preset + same clock → deep-equal strategy", () => {
    const p = plan({ target: { value: 1.5, unit: "reg" } });
    const a = applyOptimisationPreset(
      buildPrefillMetaDraft(p, null),
      p,
      CLIENT,
      [storedPreset()],
      NOW,
    ).optimisationStrategy;
    const b = applyOptimisationPreset(
      buildPrefillMetaDraft(p, null),
      p,
      CLIENT,
      [storedPreset()],
      NOW,
    ).optimisationStrategy;
    assert.deepEqual(a, b);
  });
});

describe("the tick never reads a preset", () => {
  // The whole point of materialising: lib/optimisation/evaluate.ts and
  // tick-runner.ts keep reading campaign_drafts.optimisationStrategy exactly
  // as they did before this PR. An import here would mean a preset edit
  // could change a live campaign's behaviour without anyone touching it.
  for (const file of [
    "lib/optimisation/evaluate.ts",
    "lib/optimisation/tick-runner.ts",
    "lib/optimisation/gates.ts",
    "lib/optimisation/apply.ts",
  ]) {
    it(`${file} has zero imports from lib/optimisation/presets.ts`, () => {
      const source = readFileSync(file, "utf8");
      assert.equal(
        /from\s+["'][^"']*presets(\.ts)?["']/.test(source),
        false,
        `${file} imports the preset module`,
      );
      assert.equal(/materialiseStrategy|resolvePreset/.test(source), false, file);
    });
  }
});
