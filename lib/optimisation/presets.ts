/**
 * lib/optimisation/presets.ts
 *
 * Client × objective optimisation presets — the 13 of 14 Optimisation
 * Strategy fields that are client policy, not per-campaign decisions
 * (campaign creator redesign §1 row 2, §5 row 5). The 14th, the target,
 * stays on the campaign and lives on the canvas in zone D.
 *
 * Two things happen here and nowhere else:
 *
 *   resolvePreset()      pick the preset for a client × objective, falling
 *                        back to `generateRulesForObjective` benchmarks
 *                        labelled "industry seed".
 *   materialiseStrategy() turn (preset, target) into the concrete
 *                        `OptimisationStrategySettings` a campaign draft
 *                        carries.
 *
 * WHY MATERIALISE RATHER THAN READ THROUGH
 * ─────────────────────────────────────────
 * `lib/optimisation/evaluate.ts` and `lib/optimisation/tick-runner.ts` do
 * NOT import this module — a grep-guard test enforces that. The preset is
 * baked into `campaign_drafts.draft_json->optimisationStrategy` once, at
 * draft creation / plan prepare, and the tick reads the campaign exactly as
 * it does today (§6 untouched).
 *
 * The consequence is deliberate: editing a preset cannot retroactively
 * change what a published campaign is doing. A published campaign's ladder
 * is the ladder it launched with, and `preset.presetVersion` records which
 * version that was. Drafts get an explicit "apply preset to N drafts"
 * action — never an automatic rewrite.
 *
 * IDEMPOTENCE
 * ───────────
 * `materialiseStrategy` is deterministic: same preset + same target →
 * deep-equal strategy, ids included. Rule and threshold ids are derived
 * from the preset id, version and metric rather than `crypto.randomUUID()`,
 * so re-materialising a draft does not churn its autosave payload.
 * `materialisedAt` is an explicit input for the same reason.
 *
 * Pure. No Supabase, no fetch, no env. The DB layer is
 * `lib/db/optimisation-presets.ts`.
 */

import { EVENT_FUNNEL_SEED_LABEL } from "../dashboard/event-funnel.ts";
import {
  formatThresholdValue,
  generateRulesForObjective,
  METRIC_LABELS,
  OBJECTIVE_METRIC_PRIORITY,
  roundThresholdValue,
} from "../optimisation-rules.ts";
import {
  defaultUnitForObjective,
  ladderMetricForTargetUnit,
  type PlanTargetUnit,
} from "../plan/target-unit.ts";
import { defaultWindowForMetric } from "./evaluate-windows.ts";
import type {
  BudgetGuardrails,
  CampaignObjective,
  CeilingBehaviour,
  OptimisationPresetProvenance,
  OptimisationRule,
  OptimisationStrategyMode,
  OptimisationStrategySettings,
  OptimisationThreshold,
  RuleAction,
  RuleMetric,
  RulePriority,
  RuleTimeWindow,
} from "../types.ts";

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * The arm a preset may suggest. `live` is absent on purpose: live writes
 * stay behind the per-campaign gate (`optimisation_automation_live` +
 * `ENABLE_OPTIMISATION_WRITES`). A client preset can never arm real spend.
 */
export type PresetArm = "off" | "shadow";

export type OptimisationPresetSource = OptimisationPresetProvenance["source"];

/** Same wording the funnel card uses for a seeded, not-yet-learned value. */
export const OPTIMISATION_PRESET_SEED_LABEL = EVENT_FUNNEL_SEED_LABEL;

/**
 * One band of the ladder, expressed as a MULTIPLIER of the campaign target
 * rather than an absolute currency value. `0.65` on a £1.20 / reg target
 * means £0.78. Storing multipliers is what lets one preset serve every
 * campaign the client runs at that objective, whatever its target.
 */
export interface PresetThreshold {
  operator: "below" | "between" | "above";
  multiplier: number;
  multiplierTo?: number;
  action: RuleAction;
  /** Budget change percent. Omitted / 0 on a maintain band; absent on pause. */
  actionValue?: number;
}

export interface PresetRule {
  metric: RuleMetric;
  timeWindow: RuleTimeWindow;
  enabled: boolean;
  name: string;
  priority?: RulePriority;
  /**
   * The metric's own benchmark, used as the target when the plan carries
   * none and as the denominator when a real campaign's absolute bands were
   * re-expressed as multipliers by the backfill.
   */
  benchmarkTarget: number | null;
  thresholds: PresetThreshold[];
}

/**
 * Guardrails minus the two that are derived from the campaign budget.
 * `baseCampaignBudget` is the campaign's daily budget and
 * `hardBudgetCeiling` is that budget expanded by `maxExpansionPercent` —
 * neither can be stored on a preset without going stale the first time a
 * campaign runs at a different budget.
 */
export interface PresetGuardrails {
  maxExpansionPercent: number;
  ceilingBehaviour: CeilingBehaviour;
  maxSingleAdSetBudget?: number;
  maxSingleAdSetBudgetType?: "fixed" | "percent";
  maxDailyIncreasePercent?: number;
  cooldownHours?: number;
}

export interface ClientOptimisationPreset {
  id: string;
  clientId: string;
  objective: CampaignObjective;
  version: number;
  defaultArm: PresetArm;
  mode: OptimisationStrategyMode;
  rules: PresetRule[];
  guardrails: PresetGuardrails;
  updatedAt: string | null;
}

export interface ResolvedPreset {
  preset: ClientOptimisationPreset;
  source: OptimisationPresetSource;
  /** Set when `source` is `"industry seed"` — the badge copy. */
  seedLabel: string | null;
}

export interface MaterialiseTarget {
  /** `campaign_plans.target_value`. Null → fall back to the rule's `benchmarkTarget`. */
  value: number | null;
  /** `campaign_plans.target_unit`. Null → derived from the preset objective. */
  unit: PlanTargetUnit | null;
  /** Campaign daily budget — the guardrail base and ceiling are derived from it. */
  budgetAmount: number;
  /** Explicit so materialise stays deterministic. */
  materialisedAt: string;
}

// ─── Default ladders ──────────────────────────────────────────────────────

/**
 * The multipliers `regenerateThresholdsFromTarget` uses for cost metrics,
 * lifted out so a seeded preset reproduces today's ladder exactly. The
 * guard test in `__tests__/presets.test.ts` asserts materialising these
 * equals `regenerateThresholdsFromTarget` band for band.
 */
export const DEFAULT_COST_LADDER: readonly PresetThreshold[] = [
  { operator: "below", multiplier: 0.4, action: "increase_budget", actionValue: 30 },
  { operator: "between", multiplier: 0.4, multiplierTo: 0.65, action: "increase_budget", actionValue: 15 },
  { operator: "between", multiplier: 0.65, multiplierTo: 1.25, action: "maintain", actionValue: 0 },
  { operator: "between", multiplier: 1.25, multiplierTo: 1.75, action: "decrease_budget", actionValue: 25 },
  { operator: "above", multiplier: 1.75, action: "pause" },
];

/** Same, for ROAS — higher is better, so the bands fan out downwards. */
export const DEFAULT_INVERSE_LADDER: readonly PresetThreshold[] = [
  { operator: "above", multiplier: 1.8, action: "increase_budget", actionValue: 30 },
  { operator: "between", multiplier: 1.3, multiplierTo: 1.8, action: "increase_budget", actionValue: 15 },
  { operator: "between", multiplier: 0.7, multiplierTo: 1.3, action: "maintain", actionValue: 0 },
  { operator: "below", multiplier: 0.7, action: "decrease_budget", actionValue: 30 },
  { operator: "below", multiplier: 0.4, action: "pause" },
];

export const DEFAULT_PRESET_GUARDRAILS: PresetGuardrails = {
  maxExpansionPercent: 100,
  ceilingBehaviour: "stop",
};

export function isInverseMetric(metric: RuleMetric): boolean {
  return metric === "roas";
}

export function defaultLadderFor(metric: RuleMetric): readonly PresetThreshold[] {
  return isInverseMetric(metric) ? DEFAULT_INVERSE_LADDER : DEFAULT_COST_LADDER;
}

// ─── Converting real rules into preset rules ──────────────────────────────

/**
 * Re-express one campaign rule's absolute bands as multipliers of a target.
 *
 * Used by the industry seed (denominator = the account benchmark median)
 * and by `scripts/backfill-optimisation-presets.mjs` (denominator = the
 * campaign's own target, or its benchmark when it never set one). A rule
 * with no usable denominator keeps the default ladder rather than dividing
 * by zero — a preset with no bands would silently disarm the client.
 */
export function ruleToPresetRule(
  rule: OptimisationRule,
  targetOverride?: number | null,
): PresetRule {
  const denominator =
    targetOverride ??
    (rule.useOverride ? rule.campaignTargetValue : null) ??
    rule.accountBenchmarkValue ??
    null;

  const usable = denominator != null && denominator > 0;
  const thresholds: PresetThreshold[] = usable
    ? rule.thresholds.map((t) => thresholdToPresetThreshold(t, denominator))
    : [...defaultLadderFor(rule.metric)];

  return {
    metric: rule.metric,
    timeWindow: rule.timeWindow,
    enabled: rule.enabled,
    name: rule.name,
    priority: rule.priority,
    benchmarkTarget: usable ? denominator : null,
    thresholds,
  };
}

function thresholdToPresetThreshold(
  threshold: OptimisationThreshold,
  denominator: number,
): PresetThreshold {
  const out: PresetThreshold = {
    operator: threshold.operator,
    multiplier: roundMultiplier(threshold.value / denominator),
    action: threshold.action,
  };
  if (threshold.valueTo != null) {
    out.multiplierTo = roundMultiplier(threshold.valueTo / denominator);
  }
  if (threshold.action !== "pause") {
    out.actionValue = threshold.actionValue ?? 0;
  }
  return out;
}

/** Four decimals — enough for a £0.20 band on a £38 target without float noise. */
function roundMultiplier(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

// ─── resolvePreset ────────────────────────────────────────────────────────

/**
 * Pick the preset for a client × objective.
 *
 * Pure, so the caller supplies whatever the DB returned. Pass the rows for
 * this client (any objective — this function picks) or `null` when there
 * are none; the fallback chain is:
 *
 *   1. a stored preset for exactly this client × objective  → "manual entry"
 *   2. `generateRulesForObjective` benchmarks                → "industry seed"
 *
 * There is deliberately no cross-objective fallback: a signup ladder
 * applied to a sales campaign is worse than the industry seed.
 */
export function resolvePreset(
  clientId: string,
  objective: CampaignObjective,
  stored: readonly ClientOptimisationPreset[] | null,
): ResolvedPreset {
  const match = (stored ?? []).find(
    (p) => p.clientId === clientId && p.objective === objective,
  );
  if (match) {
    return { preset: match, source: "manual entry", seedLabel: null };
  }
  return {
    preset: industrySeedPreset(clientId, objective),
    source: "industry seed",
    seedLabel: OPTIMISATION_PRESET_SEED_LABEL,
  };
}

/**
 * The zero-config preset: today's benchmark rules, re-expressed as
 * multipliers, with `version: 0` to mark "never saved by a human".
 *
 * The id is stable and namespaced rather than a uuid so a materialised
 * strategy shows plainly that no client policy existed yet.
 */
export function industrySeedPreset(
  clientId: string,
  objective: CampaignObjective,
): ClientOptimisationPreset {
  const rules = generateRulesForObjective(objective).map((r) =>
    ruleToPresetRule(r, r.accountBenchmarkValue ?? null),
  );
  return {
    id: industrySeedPresetId(objective),
    clientId,
    objective,
    version: 0,
    defaultArm: "off",
    mode: "benchmarks",
    rules,
    guardrails: { ...DEFAULT_PRESET_GUARDRAILS },
    updatedAt: null,
  };
}

export function industrySeedPresetId(objective: CampaignObjective): string {
  return `industry-seed:${objective}`;
}

export function isIndustrySeedPresetId(presetId: string): boolean {
  return presetId.startsWith("industry-seed:");
}

// ─── materialiseStrategy ──────────────────────────────────────────────────

/**
 * (preset, target) → the strategy a campaign draft carries.
 *
 * The target scales only the ladder it belongs to. A £18 / purchase target
 * rescales the CPA bands; the ROAS guardrail rule on the same preset keeps
 * its own benchmark, because a cost target says nothing about a return
 * ratio.
 */
export function materialiseStrategy(
  preset: ClientOptimisationPreset,
  target: MaterialiseTarget,
): OptimisationStrategySettings {
  const unit = target.unit ?? defaultUnitForObjective(preset.objective);
  const ladderMetric = unit
    ? ladderMetricForTargetUnit(unit)
    : OBJECTIVE_METRIC_PRIORITY[preset.objective].primary;

  const usableTarget = target.value != null && target.value > 0 ? target.value : null;

  const rules: OptimisationRule[] = preset.rules.map((rule) => {
    const effectiveTarget =
      rule.metric === ladderMetric && usableTarget != null
        ? usableTarget
        : rule.benchmarkTarget;
    return materialiseRule(preset, rule, effectiveTarget);
  });

  const provenance: OptimisationPresetProvenance = {
    presetId: preset.id,
    presetVersion: preset.version,
    materialisedAt: target.materialisedAt,
    // A seeded preset stays "industry seed" even when the operator typed a
    // target: the ladder shape is still the seed's, and that is what the
    // badge is claiming.
    source: isIndustrySeedPresetId(preset.id) ? "industry seed" : "manual entry",
    targetValue: usableTarget,
    targetUnit: unit,
    // No zone D value: the ladder was scaled from the preset's own
    // benchmark, so the number is a seed even when the shape is not.
    targetSource: usableTarget == null ? "industry seed" : "plan",
    defaultArm: preset.defaultArm,
  };

  return {
    mode: preset.mode,
    rules,
    guardrails: materialiseGuardrails(preset.guardrails, target.budgetAmount),
    preset: provenance,
  };
}

function materialiseRule(
  preset: ClientOptimisationPreset,
  rule: PresetRule,
  effectiveTarget: number | null,
): OptimisationRule {
  const ruleId = `${preset.id}:${preset.version}:${rule.metric}`;
  const thresholds =
    effectiveTarget != null && effectiveTarget > 0
      ? rule.thresholds.map((t, idx) =>
          materialiseThreshold(ruleId, idx, t, rule.metric, effectiveTarget),
        )
      : [];

  const out: OptimisationRule = {
    id: ruleId,
    // `rules` is jsonb, so a row written by hand can arrive nameless. The
    // metric label beats a blank heading on the decision row.
    name: rule.name || (METRIC_LABELS[rule.metric] ?? rule.metric),
    metric: rule.metric,
    // A preset saved before the per-metric windows landed can still carry a
    // 24h window on a conversion metric. Promote it the same way the tick
    // does, so a materialised draft is never narrower than the evaluator's
    // own floor (#875).
    timeWindow: widerWindow(rule.timeWindow, defaultWindowForMetric(rule.metric)),
    thresholds,
    enabled: rule.enabled,
    accountBenchmarkValue: rule.benchmarkTarget ?? undefined,
    useOverride: effectiveTarget != null && effectiveTarget !== rule.benchmarkTarget,
  };
  if (rule.priority) out.priority = rule.priority;
  if (effectiveTarget != null) out.campaignTargetValue = effectiveTarget;
  return out;
}

function widerWindow(a: RuleTimeWindow, b: RuleTimeWindow): RuleTimeWindow {
  const rank: Record<RuleTimeWindow, number> = { "24h": 0, "3d": 1, "7d": 2 };
  return rank[a] >= rank[b] ? a : b;
}

function materialiseThreshold(
  ruleId: string,
  idx: number,
  threshold: PresetThreshold,
  metric: RuleMetric,
  target: number,
): OptimisationThreshold {
  const value = roundThresholdValue(threshold.multiplier * target);
  const valueTo =
    threshold.multiplierTo != null
      ? roundThresholdValue(threshold.multiplierTo * target)
      : undefined;

  const out: OptimisationThreshold = {
    id: `${ruleId}:${idx}`,
    operator: threshold.operator,
    value,
    action: threshold.action,
    label: thresholdLabel(metric, threshold.operator, value, valueTo, threshold),
  };
  if (valueTo != null) out.valueTo = valueTo;
  if (threshold.action !== "pause") out.actionValue = threshold.actionValue ?? 0;
  return out;
}

/**
 * Band labels, in the same shape `regenerateThresholdsFromTarget` produces
 * so an operator sees the same sentence whether the ladder came from a
 * preset or from the wizard's regenerate button. The guard test in
 * `__tests__/presets.test.ts` keeps the two identical for the default ladder.
 */
function thresholdLabel(
  metric: RuleMetric,
  operator: PresetThreshold["operator"],
  value: number,
  valueTo: number | undefined,
  threshold: PresetThreshold,
): string {
  const label = METRIC_LABELS[metric] ?? metric;
  const pct = threshold.actionValue ?? 0;

  if (isInverseMetric(metric)) {
    if (threshold.action === "pause") return `${label} below ${value}× → pause`;
    if (operator === "above") return `${label} above ${value}× → scale aggressively (+${pct}%)`;
    if (operator === "below") return `${label} below ${value}× → reduce (-${pct}%)`;
    if (pct === 0) return `${label} ${value}–${valueTo}× → maintain`;
    return threshold.action === "increase_budget"
      ? `${label} ${value}–${valueTo}× → scale moderately (+${pct}%)`
      : `${label} ${value}–${valueTo}× → reduce (-${pct}%)`;
  }

  const sym = "£";
  const lo = `${sym}${formatThresholdValue(value)}`;
  const hi = valueTo != null ? `${sym}${formatThresholdValue(valueTo)}` : "";

  if (threshold.action === "pause") return `Above ${lo} ${label} → pause`;
  if (operator === "below") return `Below ${lo} ${label} → scale aggressively (+${pct}%)`;
  if (operator === "above") return `Above ${lo} ${label} → reduce (-${pct}%)`;
  if (pct === 0) return `${lo}–${hi} ${label} → maintain`;
  return threshold.action === "increase_budget"
    ? `${lo}–${hi} ${label} → scale moderately (+${pct}%)`
    : `${lo}–${hi} ${label} → reduce (-${pct}%)`;
}

export function materialiseGuardrails(
  guardrails: PresetGuardrails,
  budgetAmount: number,
): BudgetGuardrails {
  const base = budgetAmount > 0 ? budgetAmount : 0;
  const out: BudgetGuardrails = {
    baseCampaignBudget: base,
    maxExpansionPercent: guardrails.maxExpansionPercent,
    hardBudgetCeiling: Math.round(base * (1 + guardrails.maxExpansionPercent / 100)),
    ceilingBehaviour: guardrails.ceilingBehaviour,
  };
  if (guardrails.maxSingleAdSetBudget != null) {
    out.maxSingleAdSetBudget = guardrails.maxSingleAdSetBudget;
    out.maxSingleAdSetBudgetType = guardrails.maxSingleAdSetBudgetType ?? "fixed";
  }
  if (guardrails.maxDailyIncreasePercent != null) {
    out.maxDailyIncreasePercent = guardrails.maxDailyIncreasePercent;
  }
  if (guardrails.cooldownHours != null) {
    out.cooldownHours = guardrails.cooldownHours;
  }
  return out;
}

// ─── Read helpers for the UI ──────────────────────────────────────────────

/** The metric the target scales, for a preset with no plan target yet. */
export function presetLadderMetric(preset: ClientOptimisationPreset): RuleMetric {
  return OBJECTIVE_METRIC_PRIORITY[preset.objective].primary;
}

/** The rule the target scales — the one the `/clients/[id]` card leads with. */
export function presetPrimaryRule(
  preset: ClientOptimisationPreset,
): PresetRule | null {
  const metric = presetLadderMetric(preset);
  return preset.rules.find((r) => r.metric === metric) ?? preset.rules[0] ?? null;
}

/**
 * `⌁ preset · v3` — the badge the wizard and the canvas render. Version 0
 * reads `seed` rather than `v0`, because it was never saved by anyone.
 */
export function presetVersionLabel(version: number): string {
  return version <= 0 ? "seed" : `v${version}`;
}

/**
 * Which face wizard step 2 shows.
 *
 * `"preset"` — the 13 policy fields read-only, target editable.
 * `"editor"` — the full pre-preset editor, byte-for-byte as before.
 *
 * Absence of `strategy.preset` is the whole test, which is what keeps the
 * standalone wizard at parity while the canvas is built: a draft that never
 * went through plan prepare has no provenance and behaves exactly as it did.
 */
export function presetStepView(
  strategy: Pick<OptimisationStrategySettings, "preset">,
): "preset" | "editor" {
  return strategy.preset ? "preset" : "editor";
}

/** `⌁ preset · v3 · edit →` target. Null when the draft has no client. */
export function presetEditHref(clientId: string | null | undefined): string | null {
  return clientId ? `/clients/${clientId}?tab=optimisation` : null;
}

/**
 * Index of the rule the target scales — the objective's primary metric,
 * falling back to the first rule. `-1` when there are no rules.
 */
export function targetRuleIndex(
  strategy: Pick<OptimisationStrategySettings, "rules">,
  objective: CampaignObjective,
): number {
  const primary = OBJECTIVE_METRIC_PRIORITY[objective].primary;
  const exact = strategy.rules.findIndex((r) => r.metric === primary);
  if (exact >= 0) return exact;
  return strategy.rules.length > 0 ? 0 : -1;
}

/** The target currently in force, for the step's one editable field. */
export function currentTarget(
  strategy: Pick<OptimisationStrategySettings, "rules" | "preset">,
  objective: CampaignObjective,
): number | null {
  const idx = targetRuleIndex(strategy, objective);
  if (idx < 0) return null;
  const rule = strategy.rules[idx];
  return rule.campaignTargetValue ?? rule.accountBenchmarkValue ?? null;
}

/**
 * Rescale the ladder around a new target — the one edit wizard step 2 makes.
 *
 * Rebuilds bands from the multipliers the preset already materialised, so
 * a client who customised their ladder keeps that shape rather than being
 * silently reset to the default one (which is what calling
 * `regenerateThresholdsFromTarget` here would do).
 *
 * Returns the strategy unchanged when the target is unusable or unmoved, so
 * the caller can pass it straight to `onChange` without an equality check.
 */
export function applyTargetToStrategy(
  strategy: OptimisationStrategySettings,
  objective: CampaignObjective,
  target: number,
): OptimisationStrategySettings {
  const idx = targetRuleIndex(strategy, objective);
  if (idx < 0 || !Number.isFinite(target) || target <= 0) return strategy;

  const rule = strategy.rules[idx];
  const previous = rule.campaignTargetValue ?? rule.accountBenchmarkValue ?? null;
  if (previous === target) return strategy;

  const ladder: readonly PresetThreshold[] =
    previous != null && previous > 0
      ? rule.thresholds.map((t) => thresholdToPresetThreshold(t, previous))
      : defaultLadderFor(rule.metric);

  const rules = [...strategy.rules];
  rules[idx] = {
    ...rule,
    campaignTargetValue: target,
    useOverride: true,
    thresholds: ladder.map((t, i) =>
      materialiseThreshold(rule.id, i, t, rule.metric, target),
    ),
  };

  return {
    ...strategy,
    rules,
    // The number is now the operator's, whatever it was before. The preset
    // id, version and `materialisedAt` are untouched: editing the target is
    // not picking up a newer preset.
    preset: strategy.preset
      ? { ...strategy.preset, targetValue: target, targetSource: "plan" }
      : strategy.preset,
  };
}
