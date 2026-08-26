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
 * Guardrail scope (PR B): `hardBudgetCeiling`, `maxExpansionPercent`,
 * `ceilingBehaviour`, `maxSingleAdSetBudget` / `maxSingleAdSetBudgetType`,
 * and `maxDailyIncreasePercent` are all applied here. The last two were
 * configurable in the Step 6 UI but unread until live writes shipped —
 * they clamp `budgetAfterPence` the same way the existing ceilings do
 * (tightest cap binds; ties favour hard ceiling, then expansion, then
 * single-ad-set, then daily-increase). `cooldownHours` remains the
 * recent-touch window. Callers must pass `lastTouchedAt` from the last
 * APPLIED write (`applied_at`) so a shadow row cannot start the cooldown.
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
  | "skip_recent_touch"
  | "metric_unavailable";

export type GuardrailNote =
  | "hit_hard_ceiling"
  | "capped_by_max_expansion"
  | "capped_by_max_single_adset_budget"
  | "capped_by_max_daily_increase"
  | "budget_changed_underfoot"
  | null;

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
  /**
   * Most recent touch used for `cooldownHours`. PR B: prefer
   * `max(applied_at) where applied=true`, falling back to `decided_at`
   * only when the ad set has never been written — see
   * {@link resolveLastTouchedAt}. Null if never touched.
   */
  lastTouchedAt: Date | null;
  /** Impressions over the SAME window as `liveMetric` — 0 means the ad set is dormant. */
  impressions: number;
  /**
   * Sum of applied positive `action_delta` percents for this ad set in
   * the rolling 24h window (`applied=true`). Used with
   * `guardrails.maxDailyIncreasePercent`. Defaults to 0.
   */
  appliedIncreasePercentLast24h?: number;
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
export const DEFAULT_COOLDOWN_HOURS = 24;

/**
 * Cooldown clock for {@link EvaluateAdSetInput.lastTouchedAt}.
 * Prefer the last successful Meta write; fall back to the last decision
 * row only when the ad set has never been written. A shadow-only
 * `decided_at` must not be treated as an applied write — callers that
 * are about to write should pass `lastDecidedAt = null` so a shadow
 * recommendation cannot start the write cooldown.
 */
export function resolveLastTouchedAt(
  lastAppliedAt: Date | null,
  lastDecidedAt: Date | null,
): Date | null {
  return lastAppliedAt ?? lastDecidedAt;
}

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
  const { effectiveCapPence, bindingNote } = resolveScaleUpCap(
    guardrails,
    currentBudgetPence,
    input.appliedIncreasePercentLast24h ?? 0,
  );

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

interface ScaleUpCap {
  effectiveCapPence: number;
  bindingNote: Exclude<GuardrailNote, null>;
}

/**
 * Tightest of the configured scale-up ceilings. Tie-break order (first
 * listed wins when pence values are equal): hard ceiling → expansion →
 * max single ad set → max daily increase.
 */
export function resolveScaleUpCap(
  guardrails: BudgetGuardrails,
  currentBudgetPence: number,
  appliedIncreasePercentLast24h: number,
): ScaleUpCap {
  const hardCeilingPence = round(guardrails.hardBudgetCeiling * 100);
  const baseCampaignBudgetPence = round(guardrails.baseCampaignBudget * 100);
  const expansionCeilingPence = round(
    baseCampaignBudgetPence * (1 + guardrails.maxExpansionPercent / 100),
  );

  const caps: Array<{ pence: number; note: Exclude<GuardrailNote, null> }> = [
    { pence: hardCeilingPence, note: "hit_hard_ceiling" },
    { pence: expansionCeilingPence, note: "capped_by_max_expansion" },
  ];

  if (guardrails.maxSingleAdSetBudget != null) {
    const type = guardrails.maxSingleAdSetBudgetType ?? "fixed";
    const pence =
      type === "percent"
        ? round((baseCampaignBudgetPence * guardrails.maxSingleAdSetBudget) / 100)
        : round(guardrails.maxSingleAdSetBudget * 100);
    caps.push({ pence, note: "capped_by_max_single_adset_budget" });
  }

  if (guardrails.maxDailyIncreasePercent != null) {
    const remaining = guardrails.maxDailyIncreasePercent - appliedIncreasePercentLast24h;
    const maxAfterPence =
      remaining <= 0
        ? currentBudgetPence
        : round(currentBudgetPence * (1 + remaining / 100));
    caps.push({ pence: maxAfterPence, note: "capped_by_max_daily_increase" });
  }

  const effectiveCapPence = Math.min(...caps.map((c) => c.pence));
  const binding = caps.find((c) => c.pence === effectiveCapPence);
  return {
    effectiveCapPence,
    bindingNote: binding?.note ?? "hit_hard_ceiling",
  };
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
  const capLabel =
    guardrailNote === "hit_hard_ceiling"
      ? "hard budget ceiling"
      : guardrailNote === "capped_by_max_expansion"
        ? "max expansion cap"
        : guardrailNote === "capped_by_max_single_adset_budget"
          ? "max single-ad-set budget"
          : "max daily increase cap";

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
