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
 * APPLIED write (`applied_at`) or, in shadow, the last CHANGE decision
 * (`scale_up` / `scale_down` / `pause`). A maintain / skip / insufficient
 * / metric_unavailable row must not start or extend the cooldown.
 */

import type {
  BudgetGuardrails,
  CeilingBehaviour,
  OptimisationRule,
  RuleMetric,
  RuleTimeWindow,
} from "@/lib/types";
import {
  effectiveCooldownHours,
  MIN_CONVERSION_RESULT_COUNT,
} from "./evaluate-windows.ts";

export type AutomationAction =
  | "scale_up"
  | "scale_down"
  | "pause"
  | "maintain"
  | "skip_dormant"
  | "skip_recent_touch"
  | "skip_no_rules"
  | "metric_unavailable"
  /**
   * Conversion metric has data but the result count is below the
   * minimum-evidence threshold. Named rather than silently maintaining so
   * the operator can see exactly how far the ad set is from actionability.
   * See `MIN_CONVERSION_RESULT_COUNT` in evaluate-windows.ts.
   */
  | "insufficient_conversions";

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
  /**
   * Raw result count from Meta's `actions` field over the same window.
   * Present for conversion-style metrics (cpr, cpa) where the insight row
   * has `actionCountByType` entries. Null for direct-field metrics (cpc,
   * cpm, ctr) — the minimum-evidence check is skipped when this is null.
   */
  resultCount: number | null;
}

export interface EvaluateAdSetInput {
  /** Full rule list from `draft.optimisationStrategy.rules` — only the enabled rule matching `liveMetric.name` is used. */
  rules: OptimisationRule[];
  guardrails: BudgetGuardrails;
  /** Current Meta `daily_budget`, in minor units (pence for GBP). */
  currentBudgetPence: number;
  liveMetric: LiveMetricReading;
  /**
   * Most recent CHANGE used for `cooldownHours`. Prefer
   * `max(applied_at) where applied=true`, falling back to the last
   * `scale_up` / `scale_down` / `pause` `decided_at` — see
   * {@link resolveLastTouchedAt} / {@link lastChangeDecidedAt}.
   * Null if never changed.
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
  /** Noun in skip/maintain copy. CBO path uses "campaign". */
  subjectNoun?: "ad set" | "campaign";
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

/** Actions that would change budget — only these start or extend cooldown. */
export const BUDGET_CHANGE_ACTIONS = ["scale_up", "scale_down", "pause"] as const;

export function isBudgetChangeAction(action: string): boolean {
  return (BUDGET_CHANGE_ACTIONS as readonly string[]).includes(action);
}

/**
 * Latest `decidedAt` among change actions only. maintain / skip_* /
 * insufficient_conversions / metric_unavailable never start cooldown.
 */
export function lastChangeDecidedAt(
  rows: ReadonlyArray<{ action: string; decidedAt: Date }>,
): Date | null {
  let latest: Date | null = null;
  for (const row of rows) {
    if (!isBudgetChangeAction(row.action)) continue;
    if (!latest || row.decidedAt.getTime() > latest.getTime()) latest = row.decidedAt;
  }
  return latest;
}

/** mode=none or zero enabled rules — one campaign-level skip, no ad-set rows. */
export function hasEnabledRules(strategy: {
  mode: string;
  rules: ReadonlyArray<{ enabled: boolean }>;
}): boolean {
  if (strategy.mode === "none") return false;
  return strategy.rules.some((rule) => rule.enabled);
}

export function skipNoRulesReason(mode: string): string {
  return mode === "none"
    ? "Optimisation mode is none — skip_no_rules, no per-ad-set evaluation."
    : "No enabled rules configured — skip_no_rules, no per-ad-set evaluation.";
}

export function isMaintainThreshold(threshold: {
  action: string;
  actionValue?: number;
}): boolean {
  if (threshold.action === "maintain") return true;
  return (
    (threshold.action === "decrease_budget" || threshold.action === "increase_budget") &&
    (threshold.actionValue ?? 0) === 0
  );
}

/**
 * Cooldown clock for {@link EvaluateAdSetInput.lastTouchedAt}.
 * Prefer the last successful Meta write; fall back to the last CHANGE
 * decision only when the ad set has never been written. Live callers
 * pass `lastChangeDecidedAt = null` so a shadow recommendation cannot
 * start the write cooldown.
 */
export function resolveLastTouchedAt(
  lastAppliedAt: Date | null,
  lastChangeDecidedAtValue: Date | null,
): Date | null {
  return lastAppliedAt ?? lastChangeDecidedAtValue;
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

/** Campaign-level path: same ceilings, but the ad-set-only cap does not bind. */
export function campaignGuardrails(guardrails: BudgetGuardrails): BudgetGuardrails {
  return {
    ...guardrails,
    maxSingleAdSetBudget: undefined,
    maxSingleAdSetBudgetType: undefined,
  };
}

/**
 * CBO / campaign-daily evaluation. Decision logic is still
 * {@link evaluateAdSet}; this only drops the ad-set-only cap and labels
 * the subject as a campaign.
 */
export function evaluateCampaign(input: EvaluateAdSetInput): EvaluateAdSetResult {
  return evaluateAdSet({
    ...input,
    guardrails: campaignGuardrails(input.guardrails),
    subjectNoun: "campaign",
  });
}

export const LIFETIME_BUDGET_SKIP_REASON =
  "Campaign uses a lifetime_budget — daily-percentage rules cannot scale a lifetime budget.";

export function lifetimeAdSetSkipReason(adsetName: string): string {
  return `Ad set "${adsetName}" uses a lifetime_budget — daily-percentage rules cannot scale a lifetime budget.`;
}

export function unsupportedNoDailyBudgetReason(adsetName: string): string {
  return `Ad set "${adsetName}" has no daily_budget and the campaign is not using campaign-level daily budget — skipping.`;
}

export function cboMetricUnavailableReason(
  primaryMetric: string,
  window: RuleTimeWindow,
  campaignName: string,
): string {
  return `No ${primaryMetric} data in the ${window} window yet for campaign "${campaignName}" — metric_unavailable, not a guessed rate.`;
}

export function evaluateAdSet(input: EvaluateAdSetInput): EvaluateAdSetResult {
  const now = input.now ?? new Date();
  const { rules, guardrails, currentBudgetPence, liveMetric, lastTouchedAt, impressions } = input;
  const noun = input.subjectNoun ?? "ad set";

  // ── Dormant filter — 0 impressions means there's no signal to act on ────
  if (impressions <= 0) {
    return {
      action: "skip_dormant",
      deltaPercent: null,
      budgetAfterPence: currentBudgetPence,
      ruleMatched: null,
      guardrailNote: null,
      reason: `0 impressions in the ${liveMetric.window} window — dormant ${noun}, no metric signal to act on.`,
    };
  }

  // ── Recent-touch guard — mirrors the loop-prevention the cron itself
  // applies via the audit log's 24h decided_at lookback (see
  // lib/optimisation/tick-runner.ts); kept here too so this function is a
  // complete, independently-testable decision unit and PR B (which may feed
  // a Meta-sourced "last budget update" timestamp instead of our own audit
  // log) doesn't need new logic. ────────────────────────────────────────────
  //
  // Cooldown ≥ window: a budget change made D days ago is still inside the
  // measured period when the evaluation window is 7d. Using a shorter
  // cooldown would stack changes whose effects haven't yet washed out of the
  // metric. `effectiveCooldownHours` enforces max(configured, windowHours).
  const cooldownHours = effectiveCooldownHours(liveMetric.window, guardrails.cooldownHours);
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

  // ── Minimum-evidence guard — conversion metrics only ─────────────────────
  // `resultCount` is null for direct-field metrics (cpm, cpc, ctr) where
  // there is no countable event, so the check is skipped for those.
  // For conversion metrics: a rate derived from 1–4 conversions has too
  // wide a confidence interval to act on. Record the count in reason_text
  // so the operator can see how close the ad set is to the threshold —
  // "4/5 conversions" is actionable context, "maintaining budget" is not.
  if (
    liveMetric.resultCount !== null &&
    liveMetric.resultCount < MIN_CONVERSION_RESULT_COUNT
  ) {
    return {
      action: "insufficient_conversions",
      deltaPercent: null,
      budgetAfterPence: currentBudgetPence,
      ruleMatched: null,
      guardrailNote: null,
      reason: `${liveMetric.resultCount}/${MIN_CONVERSION_RESULT_COUNT} conversions in the ${liveMetric.window} window for ${noun} — insufficient evidence, no budget change.`,
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
  if (isMaintainThreshold(threshold)) {
    return {
      action: "maintain",
      deltaPercent: 0,
      budgetAfterPence: currentBudgetPence,
      ruleMatched: threshold.label,
      guardrailNote: null,
      reason: `${liveMetric.name}=${liveMetric.value} matched "${threshold.label}" → maintain.`,
    };
  }

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
