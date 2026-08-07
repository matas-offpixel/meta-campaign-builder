/**
 * lib/optimisation/evaluate.ts
 *
 * Pure decision function for task #120 (Optimisation Strategy automation
 * loop), PR A — dry-run evaluator. Takes a rule set, guardrails, the current
 * budget, and a live metric reading, and returns exactly what the automation
 * WOULD do. No Meta calls, no Supabase calls, no side effects — every branch
 * is unit-testable with plain fixtures (see `__tests__/evaluate.test.ts`).
 *
 * PR B will call this SAME function before issuing the real Meta budget
 * update — this module is the one place the scale/pause decision logic
 * lives, so shadow-mode recommendations and eventual live actions can never
 * drift apart.
 *
 * Scope note: only the ad set's PRIMARY rule/metric is evaluated (matching
 * `OBJECTIVE_METRIC_PRIORITY[objective].primary` in `lib/optimisation-rules.ts`).
 * Secondary rules (e.g. the ROAS guardrail rule set on `purchase` objective
 * campaigns) are out of scope for PR A — the cron never resolves a secondary
 * live metric to feed in. Flagged as a PR B follow-up.
 *
 * Guardrail scope note: only `hardBudgetCeiling`, `maxExpansionPercent`, and
 * `ceilingBehaviour` are applied here, per the PR A spec. `maxSingleAdSetBudget`
 * / `maxSingleAdSetBudgetType` / `maxDailyIncreasePercent` already exist on
 * `BudgetGuardrails` (Step 6 UI lets the operator configure them) but are NOT
 * yet wired into this evaluator — a real gap the operator should know about
 * before enabling PR B, called out in the session log. `cooldownHours` IS
 * used (as the recent-touch window, see below).
 */

import type {
  BudgetGuardrails,
  CeilingBehaviour,
  OptimisationRule,
  RuleMetric,
  RuleTimeWindow,
} from "@/lib/types";

export type AutomationAction =
  | "scale_up"
  | "scale_down"
  | "pause"
  | "maintain"
  | "skip_dormant"
  | "skip_recent_touch";

export type GuardrailNote = "hit_hard_ceiling" | "capped_by_max_expansion" | null;

export interface LiveMetricReading {
  name: RuleMetric;
  value: number;
  window: RuleTimeWindow;
}

export interface EvaluateAdSetInput {
  /** Full rule list from `draft.optimisationStrategy.rules` — only the enabled rule matching `liveMetric.name` is used. */
  rules: OptimisationRule[];
  guardrails: BudgetGuardrails;
  /** Current Meta `daily_budget`, in minor units (pence for GBP). */
  currentBudgetPence: number;
  liveMetric: LiveMetricReading;
  /** Most recent `applied_at` (or `decided_at`, in PR A) from the audit log — null if never touched. */
  lastTouchedAt: Date | null;
  /** Impressions over the SAME window as `liveMetric` — 0 means the ad set is dormant. */
  impressions: number;
  /** Injectable for deterministic tests; defaults to `new Date()`. */
  now?: Date;
}

export interface EvaluateAdSetResult {
  action: AutomationAction;
  deltaPercent: number | null;
  budgetAfterPence: number;
  ruleMatched: string | null;
  guardrailNote: GuardrailNote;
  reason: string;
}

/** Default recent-touch cooldown when `guardrails.cooldownHours` is unset — matches the cron's own 24h loop-prevention window. */
const DEFAULT_COOLDOWN_HOURS = 24;

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60);
}

function thresholdMatches(
  threshold: OptimisationRule["thresholds"][number],
  value: number,
): boolean {
  switch (threshold.operator) {
    case "below":
      return value < threshold.value;
    case "above":
      return value > threshold.value;
    case "between":
      return (
        threshold.valueTo !== undefined &&
        value >= threshold.value &&
        value <= threshold.valueTo
      );
    default:
      return false;
  }
}

/** Round to the nearest whole pence — Meta rejects fractional minor units. */
function round(pence: number): number {
  return Math.round(pence);
}

export function evaluateAdSet(input: EvaluateAdSetInput): EvaluateAdSetResult {
  const now = input.now ?? new Date();
  const { rules, guardrails, currentBudgetPence, liveMetric, lastTouchedAt, impressions } = input;

  // ── Dormant filter — 0 impressions means there's no signal to act on ────
  if (impressions <= 0) {
    return {
      action: "skip_dormant",
      deltaPercent: null,
      budgetAfterPence: currentBudgetPence,
      ruleMatched: null,
      guardrailNote: null,
      reason: `0 impressions in the ${liveMetric.window} window — dormant ad set, no metric signal to act on.`,
    };
  }

  // ── Recent-touch guard — mirrors the loop-prevention the cron itself
  // applies via the audit log's 24h decided_at lookback (see
  // lib/optimisation/tick-runner.ts); kept here too so this function is a
  // complete, independently-testable decision unit and PR B (which may feed
  // a Meta-sourced "last budget update" timestamp instead of our own audit
  // log) doesn't need new logic. ────────────────────────────────────────────
  const cooldownHours = guardrails.cooldownHours ?? DEFAULT_COOLDOWN_HOURS;
  if (lastTouchedAt && hoursBetween(now, lastTouchedAt) < cooldownHours) {
    return {
      action: "skip_recent_touch",
      deltaPercent: null,
      budgetAfterPence: currentBudgetPence,
      ruleMatched: null,
      guardrailNote: null,
      reason: `Touched ${hoursBetween(now, lastTouchedAt).toFixed(1)}h ago — inside the ${cooldownHours}h cooldown window.`,
    };
  }

  // ── Find the enabled rule for this metric, then its first matching band ──
  const rule = rules.find((r) => r.enabled && r.metric === liveMetric.name);
  if (!rule) {
    return {
      action: "maintain",
      deltaPercent: null,
      budgetAfterPence: currentBudgetPence,
      ruleMatched: null,
      guardrailNote: null,
      reason: `No enabled rule configured for metric "${liveMetric.name}" — maintaining budget.`,
    };
  }

  const threshold = rule.thresholds.find((t) => thresholdMatches(t, liveMetric.value));
  if (!threshold) {
    return {
      action: "maintain",
      deltaPercent: null,
      budgetAfterPence: currentBudgetPence,
      ruleMatched: null,
      guardrailNote: null,
      reason: `${liveMetric.name}=${liveMetric.value} matched no threshold band in rule "${rule.name}" — maintaining budget.`,
    };
  }

  // ── Translate the matched band into a raw (pre-guardrail) proposal ──────
  if (threshold.action === "pause") {
    return {
      action: "pause",
      deltaPercent: null,
      budgetAfterPence: currentBudgetPence,
      ruleMatched: threshold.label,
      guardrailNote: null,
      reason: `${liveMetric.name}=${liveMetric.value} matched "${threshold.label}" → pause.`,
    };
  }

  const rawDeltaPercent =
    threshold.action === "increase_budget"
      ? (threshold.actionValue ?? 0)
      : -(threshold.actionValue ?? 0);

  if (rawDeltaPercent === 0) {
    return {
      action: "maintain",
      deltaPercent: 0,
      budgetAfterPence: currentBudgetPence,
      ruleMatched: threshold.label,
      guardrailNote: null,
      reason: `${liveMetric.name}=${liveMetric.value} matched "${threshold.label}" → maintain.`,
    };
  }

  if (rawDeltaPercent < 0) {
    // Scaling down never hits an upper ceiling — guardrails below only cap increases.
    const proposedPence = round(currentBudgetPence * (1 + rawDeltaPercent / 100));
    return {
      action: "scale_down",
      deltaPercent: rawDeltaPercent,
      budgetAfterPence: Math.max(proposedPence, 0),
      ruleMatched: threshold.label,
      guardrailNote: null,
      reason: `${liveMetric.name}=${liveMetric.value} matched "${threshold.label}" → scale_down ${rawDeltaPercent}%.`,
    };
  }

  // ── rawDeltaPercent > 0 (increase_budget) — apply the scale-up guardrails ─
  const rawProposedPence = round(currentBudgetPence * (1 + rawDeltaPercent / 100));

  const hardCeilingPence = round(guardrails.hardBudgetCeiling * 100);
  const baseCampaignBudgetPence = round(guardrails.baseCampaignBudget * 100);
  const expansionCeilingPence = round(
    baseCampaignBudgetPence * (1 + guardrails.maxExpansionPercent / 100),
  );

  // Two independent caps — whichever is tighter binds. Ties favour the
  // explicit hard ceiling as the reported reason (it's the operator's
  // absolute stop, expansionPercent is derived from it in the Step 6 UI).
  const effectiveCapPence = Math.min(hardCeilingPence, expansionCeilingPence);
  const bindingNote: GuardrailNote =
    effectiveCapPence === hardCeilingPence ? "hit_hard_ceiling" : "capped_by_max_expansion";

  if (rawProposedPence <= effectiveCapPence) {
    return {
      action: "scale_up",
      deltaPercent: rawDeltaPercent,
      budgetAfterPence: rawProposedPence,
      ruleMatched: threshold.label,
      guardrailNote: null,
      reason: `${liveMetric.name}=${liveMetric.value} matched "${threshold.label}" → scale_up +${rawDeltaPercent}%.`,
    };
  }

  // ── At/above the ceiling — apply the operator's chosen ceilingBehaviour ──
  return applyCeilingBehaviour(
    guardrails.ceilingBehaviour,
    threshold.label,
    rawDeltaPercent,
    currentBudgetPence,
    effectiveCapPence,
    bindingNote,
    liveMetric,
  );
}

function applyCeilingBehaviour(
  behaviour: CeilingBehaviour,
  ruleLabel: string,
  rawDeltaPercent: number,
  currentBudgetPence: number,
  effectiveCapPence: number,
  guardrailNote: GuardrailNote,
  liveMetric: LiveMetricReading,
): EvaluateAdSetResult {
  const capLabel = guardrailNote === "hit_hard_ceiling" ? "hard budget ceiling" : "max expansion cap";

  switch (behaviour) {
    case "partial":
      return {
        action: "scale_up",
        deltaPercent: rawDeltaPercent,
        budgetAfterPence: effectiveCapPence,
        ruleMatched: ruleLabel,
        guardrailNote,
        reason: `${liveMetric.name}=${liveMetric.value} matched "${ruleLabel}" → scale_up +${rawDeltaPercent}%, clamped to the ${capLabel}.`,
      };
    case "pause_scaling":
      return {
        action: "pause",
        deltaPercent: null,
        budgetAfterPence: currentBudgetPence,
        ruleMatched: ruleLabel,
        guardrailNote,
        reason: `${liveMetric.name}=${liveMetric.value} matched "${ruleLabel}" but hit the ${capLabel} — ceilingBehaviour=pause_scaling → pause.`,
      };
    case "stop":
    default:
      return {
        action: "maintain",
        deltaPercent: null,
        budgetAfterPence: currentBudgetPence,
        ruleMatched: ruleLabel,
        guardrailNote,
        reason: `${liveMetric.name}=${liveMetric.value} matched "${ruleLabel}" but hit the ${capLabel} — ceilingBehaviour=stop → maintain.`,
      };
  }
}
