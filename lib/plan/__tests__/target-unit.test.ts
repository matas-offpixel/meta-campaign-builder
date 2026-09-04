import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OBJECTIVE_METRIC_PRIORITY } from "../../optimisation-rules.ts";
import {
  defaultUnitForObjective,
  isPlanTargetUnit,
  ladderMetricForTargetUnit,
  objectiveForTargetUnit,
  optimisationGoalForTargetUnit,
  PLAN_TARGET_UNIT_TABLE,
  PLAN_TARGET_UNITS,
  targetUnitSpec,
  UNIT_LESS_OPTIMISATION_GOALS,
} from "../target-unit.ts";
import type { CampaignObjective, OptimisationGoal, RuleMetric } from "../../types.ts";

/**
 * Every `OptimisationGoal` in lib/types.ts. Kept as a literal list so
 * adding a goal to the union without deciding whether it has a target unit
 * fails here rather than silently at materialise time.
 */
const ALL_OPTIMISATION_GOALS: OptimisationGoal[] = [
  "conversions",
  "value",
  "complete_registration",
  "landing_page_views",
  "link_clicks",
  "reach",
  "impressions",
  "post_engagement",
  "video_views",
];

const ALL_RULE_METRICS: RuleMetric[] = [
  "cpr",
  "cpc",
  "cpa",
  "roas",
  "cpm",
  "lpv_cost",
  "ctr",
];

describe("PLAN_TARGET_UNIT_TABLE — one table, one direction", () => {
  it("has an entry for every unit and no orphans", () => {
    assert.equal(PLAN_TARGET_UNITS.length, 5);
    assert.deepEqual(
      [...PLAN_TARGET_UNITS].sort(),
      Object.keys(PLAN_TARGET_UNIT_TABLE).sort(),
    );
    for (const unit of PLAN_TARGET_UNITS) {
      assert.equal(targetUnitSpec(unit).unit, unit);
    }
  });

  it("maps each unit to the objective, goal and metric the brief names", () => {
    const expected: Record<
      string,
      { objective: CampaignObjective; goal: OptimisationGoal; implied: string }
    > = {
      reg: { objective: "registration", goal: "complete_registration", implied: "cpr" },
      click: { objective: "traffic", goal: "link_clicks", implied: "cpc" },
      lpv: { objective: "traffic", goal: "landing_page_views", implied: "lpv_cost" },
      purchase: { objective: "purchase", goal: "conversions", implied: "cpa" },
      view: { objective: "awareness", goal: "video_views", implied: "cpv" },
    };
    for (const unit of PLAN_TARGET_UNITS) {
      const spec = targetUnitSpec(unit);
      assert.equal(spec.objective, expected[unit].objective, unit);
      assert.equal(spec.optimisationGoal, expected[unit].goal, unit);
      assert.equal(spec.impliedMetricKey, expected[unit].implied, unit);
    }
  });

  it("every ladder metric is a real RuleMetric the evaluator can read", () => {
    for (const unit of PLAN_TARGET_UNITS) {
      assert.ok(
        ALL_RULE_METRICS.includes(ladderMetricForTargetUnit(unit)),
        `${unit} ladder metric is not a RuleMetric`,
      );
    }
  });

  it("only `view` has an implied metric key that is not a RuleMetric", () => {
    // `cpv` is the brief's vocabulary but has no `RuleMetric` member and no
    // resolver in lib/optimisation/live-metric.ts, so the awareness ladder
    // runs on cpm. Documented deviation — see the spec comment.
    const diverging = PLAN_TARGET_UNITS.filter(
      (u) => targetUnitSpec(u).impliedMetricKey !== targetUnitSpec(u).ladderMetric,
    );
    assert.deepEqual(diverging, ["view"]);
    assert.equal(ladderMetricForTargetUnit("view"), "cpm");
  });

  it("each unit's ladder metric is its objective's primary metric", () => {
    for (const unit of PLAN_TARGET_UNITS) {
      const spec = targetUnitSpec(unit);
      // `click` is the exception by design: traffic's primary is lpv_cost,
      // but a per-click target must be evaluated on cpc, not on LPV cost.
      if (unit === "click") {
        assert.equal(spec.ladderMetric, "cpc");
        continue;
      }
      assert.equal(
        spec.ladderMetric,
        OBJECTIVE_METRIC_PRIORITY[spec.objective].primary,
        unit,
      );
    }
  });
});

describe("OptimisationGoal exhaustiveness", () => {
  it("every goal is either reachable from a unit or explicitly unit-less", () => {
    const reachable = new Set(
      PLAN_TARGET_UNITS.map((u) => optimisationGoalForTargetUnit(u)),
    );
    for (const goal of ALL_OPTIMISATION_GOALS) {
      const classified =
        reachable.has(goal) ||
        Object.prototype.hasOwnProperty.call(UNIT_LESS_OPTIMISATION_GOALS, goal);
      assert.ok(classified, `${goal} is neither reachable from a unit nor unit-less`);
    }
  });

  it("the unit-less list is exactly reach / impressions / post_engagement / value", () => {
    assert.deepEqual(Object.keys(UNIT_LESS_OPTIMISATION_GOALS).sort(), [
      "impressions",
      "post_engagement",
      "reach",
      "value",
    ]);
    // Each carries a reason, not just a name.
    for (const [goal, reason] of Object.entries(UNIT_LESS_OPTIMISATION_GOALS)) {
      assert.ok(reason.length > 20, `${goal} has no stated reason`);
    }
  });

  it("no goal is both reachable and unit-less", () => {
    for (const unit of PLAN_TARGET_UNITS) {
      const goal = optimisationGoalForTargetUnit(unit);
      assert.ok(
        !Object.prototype.hasOwnProperty.call(UNIT_LESS_OPTIMISATION_GOALS, goal),
        `${goal} is claimed both ways`,
      );
    }
  });

  it("units and unit-less goals together cover the whole union", () => {
    const covered = new Set([
      ...PLAN_TARGET_UNITS.map((u) => optimisationGoalForTargetUnit(u)),
      ...Object.keys(UNIT_LESS_OPTIMISATION_GOALS),
    ]);
    assert.equal(covered.size, ALL_OPTIMISATION_GOALS.length);
  });
});

describe("reverse lookup for the client preset card", () => {
  it("traffic resolves to lpv, its primary metric, not click", () => {
    assert.equal(defaultUnitForObjective("traffic"), "lpv");
  });

  it("resolves the single-unit objectives", () => {
    assert.equal(defaultUnitForObjective("registration"), "reg");
    assert.equal(defaultUnitForObjective("purchase"), "purchase");
    assert.equal(defaultUnitForObjective("awareness"), "view");
  });

  it("engagement has no unit — the five units do not cover it", () => {
    // Not a bug: nothing in the brief's unit list prices an engagement, so
    // the preset card labels that ladder by metric instead.
    assert.equal(defaultUnitForObjective("engagement"), null);
  });

  it("round-trips every unit's objective back to a unit of that objective", () => {
    for (const unit of PLAN_TARGET_UNITS) {
      const back = defaultUnitForObjective(objectiveForTargetUnit(unit));
      assert.ok(back);
      assert.equal(objectiveForTargetUnit(back), objectiveForTargetUnit(unit), unit);
    }
  });
});

describe("isPlanTargetUnit", () => {
  it("accepts the five units and rejects everything else", () => {
    for (const unit of PLAN_TARGET_UNITS) assert.ok(isPlanTargetUnit(unit));
    for (const bad of ["", "REG", "registration", "cpr", null, undefined, 3, {}]) {
      assert.equal(isPlanTargetUnit(bad), false, String(bad));
    }
  });
});
