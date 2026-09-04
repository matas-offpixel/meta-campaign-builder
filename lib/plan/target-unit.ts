/**
 * lib/plan/target-unit.ts
 *
 * The one table that turns zone D's target unit into everything downstream
 * needs: the CampaignObjective (which picks the optimisation ladder), the
 * OptimisationGoal (which Meta optimises the ad set for), and the RuleMetric
 * the ladder bands are expressed in.
 *
 * This is the whole reason the canvas can drop the "Campaign Objective" and
 * "Optimisation Goal" fields: `◎ £1.20 / reg` already says both.
 *
 * One table, one direction. Nothing here reverses a metric back into a unit —
 * two units (`click` and `lpv`) share the `traffic` objective, so that
 * direction is not a function.
 *
 * No `@/` imports so `node --test` can resolve this module directly.
 */

import type {
  CampaignObjective,
  OptimisationGoal,
  PlanTargetUnit,
  RuleMetric,
} from "../types.ts";

/** Zone D's unit vocabulary. Matches `campaign_plans.target_unit` (migration 165). */
export type { PlanTargetUnit };

export const PLAN_TARGET_UNITS: readonly PlanTargetUnit[] = [
  "reg",
  "click",
  "lpv",
  "purchase",
  "view",
];

export interface PlanTargetUnitSpec {
  unit: PlanTargetUnit;
  /** Rendered after the target value on the canvas: `£1.20 / reg`. */
  label: string;
  /** Picks the ladder — `generateRulesForObjective` / `OBJECTIVE_METRIC_PRIORITY` key on this. */
  objective: CampaignObjective;
  /** What the Meta ad set optimises for. */
  optimisationGoal: OptimisationGoal;
  /**
   * The metric key this unit implies, in the redesign brief's own vocabulary.
   * `cpv` is deliberately present here and deliberately NOT a `RuleMetric` —
   * see `ladderMetric` below.
   */
  impliedMetricKey: "cpr" | "cpc" | "lpv_cost" | "cpa" | "cpv";
  /**
   * The metric the threshold ladder is actually evaluated on.
   *
   * Equals `impliedMetricKey` for four of the five units. For `view` it does
   * not: `cpv` has no `RuleMetric` member and `lib/optimisation/live-metric.ts`
   * cannot resolve one, so a video-view target's ladder runs on `cpm` — the
   * awareness primary — rather than inventing a metric the evaluator cannot
   * read. Adding `cpv` to `RuleMetric` means teaching the evaluator to fetch
   * and divide video plays, which is an evaluate.ts change and out of scope
   * for this PR (§6 untouched).
   */
  ladderMetric: RuleMetric;
}

export const PLAN_TARGET_UNIT_TABLE: Record<PlanTargetUnit, PlanTargetUnitSpec> = {
  reg: {
    unit: "reg",
    label: "reg",
    objective: "registration",
    optimisationGoal: "complete_registration",
    impliedMetricKey: "cpr",
    ladderMetric: "cpr",
  },
  click: {
    unit: "click",
    label: "click",
    objective: "traffic",
    optimisationGoal: "link_clicks",
    impliedMetricKey: "cpc",
    ladderMetric: "cpc",
  },
  lpv: {
    unit: "lpv",
    label: "lpv",
    objective: "traffic",
    optimisationGoal: "landing_page_views",
    impliedMetricKey: "lpv_cost",
    ladderMetric: "lpv_cost",
  },
  purchase: {
    unit: "purchase",
    label: "purchase",
    objective: "purchase",
    optimisationGoal: "conversions",
    impliedMetricKey: "cpa",
    ladderMetric: "cpa",
  },
  view: {
    unit: "view",
    label: "view",
    objective: "awareness",
    optimisationGoal: "video_views",
    impliedMetricKey: "cpv",
    ladderMetric: "cpm",
  },
};

/**
 * `OptimisationGoal`s no target unit reaches, with the reason. A goal is
 * unit-less when it has no per-unit cost an operator would set a target in:
 * you do not buy "one impression" at a price the ladder can act on.
 *
 * Exhaustiveness over `OptimisationGoal` is enforced by a test — a new goal
 * must be either reachable from a unit above or listed here.
 */
export const UNIT_LESS_OPTIMISATION_GOALS: Record<string, string> = {
  reach: "Reach is a de-duplicated people count, not a purchasable unit — awareness targets use cpm via the `view` unit.",
  impressions: "Impressions are priced per thousand (cpm), never per one.",
  post_engagement: "Engagement mixes reactions, comments, shares and clicks — no single unit to price.",
  value: "Value optimises for revenue, so the target is a ROAS ratio, not a cost per unit.",
};

/** Zone D segmented-control glyphs — distinguish the five units at a glance. */
export const PLAN_TARGET_UNIT_GLYPH: Record<PlanTargetUnit, string> = {
  reg: "⊕",
  click: "↗",
  lpv: "▢",
  purchase: "◆",
  view: "◉",
};

export function targetUnitSpec(unit: PlanTargetUnit): PlanTargetUnitSpec {
  return PLAN_TARGET_UNIT_TABLE[unit];
}

export function isPlanTargetUnit(value: unknown): value is PlanTargetUnit {
  return (
    typeof value === "string" &&
    (PLAN_TARGET_UNITS as readonly string[]).includes(value)
  );
}

/** The ladder key for a unit — what `resolvePreset` needs to pick a preset. */
export function objectiveForTargetUnit(unit: PlanTargetUnit): CampaignObjective {
  return PLAN_TARGET_UNIT_TABLE[unit].objective;
}

export function optimisationGoalForTargetUnit(
  unit: PlanTargetUnit,
): OptimisationGoal {
  return PLAN_TARGET_UNIT_TABLE[unit].optimisationGoal;
}

export function ladderMetricForTargetUnit(unit: PlanTargetUnit): RuleMetric {
  return PLAN_TARGET_UNIT_TABLE[unit].ladderMetric;
}

/**
 * First unit whose objective matches, for the reverse direction the UI needs
 * when a client preset exists but no plan target does (the `/clients/[id]`
 * card labels its ladder `/ reg`, not `/ registration`).
 *
 * `traffic` has two units; `lpv` wins because it is the traffic objective's
 * primary metric in `OBJECTIVE_METRIC_PRIORITY`.
 */
export function defaultUnitForObjective(
  objective: CampaignObjective,
): PlanTargetUnit | null {
  if (objective === "traffic") return "lpv";
  const found = PLAN_TARGET_UNITS.find(
    (u) => PLAN_TARGET_UNIT_TABLE[u].objective === objective,
  );
  return found ?? null;
}
