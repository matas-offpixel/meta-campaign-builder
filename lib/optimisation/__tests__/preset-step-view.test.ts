import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { generateRulesForObjective } from "../../optimisation-rules.ts";
import {
  applyTargetToStrategy,
  currentTarget,
  materialiseStrategy,
  presetEditHref,
  presetStepView,
  presetVersionLabel,
  targetRuleIndex,
  type ClientOptimisationPreset,
} from "../presets.ts";
import type { OptimisationStrategySettings } from "../../types.ts";

const STEP = "components/steps/optimisation-strategy.tsx";
const AT = "2026-09-04T12:00:00.000Z";

function preset(overrides: Partial<ClientOptimisationPreset> = {}): ClientOptimisationPreset {
  return {
    id: "preset-1",
    clientId: "cl-1",
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
    guardrails: { maxExpansionPercent: 60, ceilingBehaviour: "partial" },
    updatedAt: AT,
    ...overrides,
  };
}

/** What a draft created before this PR carries — no `preset` key at all. */
function legacyStrategy(): OptimisationStrategySettings {
  return {
    mode: "benchmarks",
    rules: generateRulesForObjective("registration"),
    guardrails: {
      baseCampaignBudget: 100,
      maxExpansionPercent: 100,
      hardBudgetCeiling: 200,
      ceilingBehaviour: "stop",
    },
  };
}

describe("presetStepView — which of the two step-2 views renders", () => {
  it("a materialised draft gets the read-only preset view", () => {
    const strategy = materialiseStrategy(preset(), {
      value: 1.5,
      unit: "reg",
      budgetAmount: 100,
      materialisedAt: AT,
    });
    assert.equal(presetStepView(strategy), "preset");
  });

  it("a pre-PR draft behaves exactly as today — the full editor", () => {
    assert.equal(presetStepView(legacyStrategy()), "editor");
  });

  it("a draft whose preset key was dropped by migrateDraft falls back to the editor", () => {
    const strategy = materialiseStrategy(preset(), {
      value: 1.5,
      unit: "reg",
      budgetAmount: 100,
      materialisedAt: AT,
    });
    delete strategy.preset;
    assert.equal(presetStepView(strategy), "editor");
  });

  it("never throws on a malformed strategy — the step must still render", () => {
    for (const bad of [
      { mode: "none", rules: [], guardrails: undefined },
      { mode: "custom", rules: [], guardrails: undefined, preset: null },
      {},
    ]) {
      assert.doesNotThrow(() =>
        presetStepView(bad as unknown as OptimisationStrategySettings),
      );
    }
  });
});

describe("the one editable field", () => {
  const strategy = materialiseStrategy(preset(), {
    value: 1.5,
    unit: "reg",
    budgetAmount: 100,
    materialisedAt: AT,
  });

  it("finds the ladder rule the target belongs to", () => {
    assert.equal(targetRuleIndex(strategy, "registration"), 0);
    assert.equal(currentTarget(strategy, "registration"), 1.5);
  });

  it("rescales the bands around a new target, keeping the shape", () => {
    const next = applyTargetToStrategy(strategy, "registration", 3);
    assert.equal(currentTarget(next, "registration"), 3);
    // 0.5 and 1.2 of the new target — the client's shape, this campaign's price.
    assert.equal(next.rules[0].thresholds[0].value, 1.5);
    assert.equal(next.rules[0].thresholds[2].value, 3.6);
  });

  it("changes nothing else — mode, guardrails and provenance survive", () => {
    const next = applyTargetToStrategy(strategy, "registration", 3);
    assert.equal(next.mode, strategy.mode);
    assert.deepEqual(next.guardrails, strategy.guardrails);
    assert.equal(next.preset?.presetId, "preset-1");
    assert.equal(next.preset?.presetVersion, 3);
  });

  it("a typed target promotes a seeded number to the operator's own", () => {
    const seeded = materialiseStrategy(preset(), {
      value: null,
      unit: "reg",
      budgetAmount: 100,
      materialisedAt: AT,
    });
    assert.equal(seeded.preset?.targetSource, "industry seed");
    const next = applyTargetToStrategy(seeded, "registration", 2.4);
    assert.equal(next.preset?.targetSource, "plan");
    assert.equal(next.preset?.targetValue, 2.4);
  });

  it("editing the target never re-versions or re-links the preset", () => {
    // The campaign owns its copy from materialisation on; a target edit must
    // not make it look like it picked up a newer preset.
    const next = applyTargetToStrategy(strategy, "registration", 9);
    assert.equal(next.preset?.materialisedAt, strategy.preset?.materialisedAt);
    assert.equal(next.preset?.presetVersion, strategy.preset?.presetVersion);
  });

  it("is idempotent — committing the same target twice is a no-op", () => {
    const once = applyTargetToStrategy(strategy, "registration", 3);
    const twice = applyTargetToStrategy(once, "registration", 3);
    assert.deepEqual(once, twice);
  });
});

describe("badge copy", () => {
  it("renders the version as v3, not 3", () => {
    assert.equal(presetVersionLabel(3), "v3");
  });

  it("labels a never-saved seed rather than calling it v0", () => {
    assert.equal(presetVersionLabel(0), "seed");
  });

  it("links to the client page only when the draft is client-linked", () => {
    assert.equal(presetEditHref("cl-1"), "/clients/cl-1?tab=optimisation");
    assert.equal(presetEditHref(undefined), null);
    assert.equal(presetEditHref(""), null);
  });
});

describe(`${STEP} — how the two views are wired`, () => {
  const source = readFileSync(STEP, "utf8");

  /** `assert.match` on a 50k-line file prints the file. This prints why. */
  function has(pattern: RegExp, why: string) {
    assert.ok(pattern.test(source), `${STEP} — ${why} (expected ${pattern})`);
  }

  it("branches on presetStepView rather than reaching into the strategy", () => {
    has(/presetStepView\(strategy\) === "preset"/, "no presetStepView branch");
  });

  it("keeps the full editor for drafts without a preset", () => {
    // Both views exist in the file; PR 7 deletes the editor, not this PR.
    has(/function PresetStrategyView/, "preset view missing");
    has(/MODE_OPTIONS/, "the full editor was removed too early");
  });

  it("does not regenerate rules on objective change when a preset is set", () => {
    // Regenerating would discard the client's policy and the target it was
    // scaled to, silently, on an objective change.
    has(
      /strategy\.mode === "benchmarks" && !strategy\.preset/,
      "objective-change regeneration is not guarded by the preset",
    );
  });

  it("shows the ⌁ preset badge, version and edit link", () => {
    has(/provenance="derived"/, "no ⌁ derived badge");
    has(/presetVersionLabel\(preset\.presetVersion\)/, "no version label");
    has(/presetEditHref\(clientId\)/, "no edit link to /clients");
  });

  it("marks a seeded target and a seeded ladder separately", () => {
    has(/targetSource === "industry seed"/, "seeded target not marked");
    has(/preset\?\.source === "industry seed"/, "seeded ladder not marked");
  });

  it("keeps the arm control per campaign — the preset arm is display only", () => {
    has(/<AutomationArmControl/, "the per-campaign arm control was dropped");
    has(
      /StatusDot status=\{preset\.defaultArm === "shadow"/,
      "the preset arm is not rendered as a dot",
    );
  });

  it("puts every word of explanation in an InfoTip, no standing sentences", () => {
    const view = source.slice(
      source.indexOf("function PresetStrategyView"),
      source.indexOf("export function OptimisationStrategy("),
    );
    assert.ok(view.length > 500, "preset view not found");
    assert.equal(/<p[\s>]/.test(view), false, "preset view uses a <p>");
    assert.equal(/CardDescription/.test(view), false, "preset view uses CardDescription");
  });
});
