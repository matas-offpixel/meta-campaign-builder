/**
 * One read model for the Armed tab, the event campaign list, and
 * post-launch target/cap edits. The loop still decides in evaluate.ts;
 * this file only names what already happened and what the operator
 * is about to change.
 */

import { regenerateThresholdsFromTarget } from "../optimisation-rules.ts";
import type {
  BudgetGuardrails,
  CampaignObjective,
  OptimisationRule,
  OptimisationStrategySettings,
} from "../types.ts";
import type { ArmedImpact } from "./armed-impact.ts";
import { armFromFlags, type AutomationArm, type DecisionRowView } from "./automation-ui.ts";

export type ArmedLastDecision = {
  at: string;
  action: string;
  reasonText: string;
  dryRun: boolean;
  applied: boolean;
};

export type ArmedLastWrite = {
  at: string;
  action: string;
  fromPence: number | null;
  toPence: number | null;
  reasonText: string;
};

export type ArmedCampaignControls = {
  objective: CampaignObjective;
  currency: string;
  campaignTargetValue: number | null;
  useOverride: boolean;
  primaryMetric: string | null;
  primaryMetricWindow: string | null;
  guardrails: BudgetGuardrails;
  baseCampaignBudget: number;
  hardBudgetCeiling: number;
};

export type ArmedCampaignRow = {
  id: string;
  name: string;
  status: string;
  ownerUserId: string;
  ownerLabel: string;
  canWrite: boolean;
  arm: AutomationArm;
  eventId: string | null;
  eventLabel: string | null;
  eventWarning: string | null;
  lastDecision: ArmedLastDecision | null;
  lastWrite: ArmedLastWrite | null;
  controls: ArmedCampaignControls;
  nextTickAt: string;
  impact: ArmedImpact;
  describeLine: string | null;
};

const EVENT_ID_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidArmedEventIdError extends Error {
  constructor(eventId: string) {
    super("eventId must be a uuid");
    this.name = "InvalidArmedEventIdError";
    void eventId;
  }
}

export function isArmedEventId(eventId: string): boolean {
  return EVENT_ID_UUID.test(eventId);
}

export function assertArmedEventId(eventId: string): void {
  if (!isArmedEventId(eventId)) {
    throw new InvalidArmedEventIdError(eventId);
  }
}

export function armedLoadErrorStatus(err: unknown): 400 | 500 {
  return err instanceof InvalidArmedEventIdError ? 400 : 500;
}

export type PostLaunchControlsPatch = {
  campaignTargetValue?: number;
  useOverride?: boolean;
  regenerateFromTarget?: boolean;
  guardrails?: Partial<BudgetGuardrails>;
};

/** Cron every 4 hours on the hour, UTC (`vercel.json` optimisation-tick). */
export function nextOptimisationTickAt(now: Date = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const hour = now.getUTCHours();
  const nextHour = Math.floor(hour / 4) * 4 + 4;
  if (nextHour >= 24) {
    return new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0));
  }
  return new Date(Date.UTC(year, month, day, nextHour, 0, 0, 0));
}

export function lastDecisionFromRows(
  rows: readonly DecisionRowView[],
): ArmedLastDecision | null {
  const first = rows[0];
  if (!first) return null;
  return {
    at: first.decidedAt,
    action: first.action,
    reasonText: first.reasonText,
    dryRun: first.dryRun,
    applied: first.applied,
  };
}

export function lastWriteFromRows(
  rows: readonly DecisionRowView[],
): ArmedLastWrite | null {
  const write = rows.find((row) => row.applied);
  if (!write) return null;
  return {
    at: write.decidedAt,
    action: write.action,
    fromPence: write.budgetBeforePence,
    toPence: write.budgetAfterPence,
    reasonText: write.reasonText,
  };
}

export function formatActingLine(
  arm: AutomationArm,
  lastDecision: ArmedLastDecision | null,
  lastWrite: ArmedLastWrite | null,
  now: Date = new Date(),
): string {
  const armLabel = arm === "live" ? "Live" : arm === "shadow" ? "Shadow" : "Off";
  if (!lastDecision) return `${armLabel} · no tick yet`;
  const decisionBit = `last decision ${formatRelative(lastDecision.at, now)}`;
  const actionBit = lastDecision.action;
  if (!lastWrite) return `${armLabel} · ${decisionBit} · ${actionBit}`;
  return `${armLabel} · ${decisionBit} · ${actionBit} · last write ${formatWriteWhen(lastWrite.at, now)}`;
}

function formatRelative(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const mins = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (Math.abs(mins) < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return formatWriteWhen(iso, now);
}

function formatWriteWhen(iso: string, _now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function armFromDraftFlags(enabled: boolean, live: boolean): AutomationArm {
  return armFromFlags(enabled, live);
}

export function primaryRuleIndex(
  strategy: Pick<OptimisationStrategySettings, "rules">,
): number {
  const exact = strategy.rules.findIndex((rule) => rule.priority === "primary" && rule.enabled);
  if (exact >= 0) return exact;
  const enabled = strategy.rules.findIndex((rule) => rule.enabled);
  if (enabled >= 0) return enabled;
  return strategy.rules.length > 0 ? 0 : -1;
}

/**
 * Set the campaign target. Does not touch threshold bands.
 * Regenerating is a separate click — mid-flight target edits are one decision.
 */
export function setCampaignTarget(
  strategy: OptimisationStrategySettings,
  value: number,
): OptimisationStrategySettings {
  const idx = primaryRuleIndex(strategy);
  if (idx < 0 || !Number.isFinite(value)) return strategy;
  const rules = strategy.rules.map((rule, i) =>
    i === idx
      ? { ...rule, campaignTargetValue: value, useOverride: true }
      : rule,
  );
  return { ...strategy, rules };
}

export function regeneratePrimaryFromTarget(
  strategy: OptimisationStrategySettings,
): OptimisationStrategySettings {
  const idx = primaryRuleIndex(strategy);
  if (idx < 0) return strategy;
  const rule = strategy.rules[idx];
  const target = rule.campaignTargetValue ?? rule.accountBenchmarkValue;
  if (target == null || !(target > 0)) return strategy;
  const rules = strategy.rules.map((row, i) =>
    i === idx
      ? { ...row, thresholds: regenerateThresholdsFromTarget(row.metric, target) }
      : row,
  );
  return { ...strategy, rules };
}

export function applyPostLaunchControls(
  strategy: OptimisationStrategySettings,
  patch: PostLaunchControlsPatch,
): OptimisationStrategySettings {
  if (definedPauseFloorBudget(patch.guardrails)) {
    throw new Error("pauseFloorBudget is not settable from these surfaces");
  }
  let next: OptimisationStrategySettings = {
    ...strategy,
    guardrails: patch.guardrails
      ? { ...strategy.guardrails, ...stripPauseFloor(patch.guardrails) }
      : strategy.guardrails,
  };
  if (patch.campaignTargetValue != null) {
    next = setCampaignTarget(next, patch.campaignTargetValue);
  } else if (patch.useOverride != null) {
    const idx = primaryRuleIndex(next);
    if (idx >= 0) {
      const rules = next.rules.map((rule, i) =>
        i === idx ? { ...rule, useOverride: patch.useOverride } : rule,
      );
      next = { ...next, rules };
    }
  }
  if (patch.regenerateFromTarget) {
    next = regeneratePrimaryFromTarget(next);
  }
  return next;
}

function stripPauseFloor(guardrails: Partial<BudgetGuardrails>): Partial<BudgetGuardrails> {
  const next = { ...guardrails };
  delete (next as { pauseFloorBudget?: unknown }).pauseFloorBudget;
  return next;
}

/** True only when a value is set — a key with `undefined` is not a write. */
export function definedPauseFloorBudget(
  guardrails: Partial<BudgetGuardrails> | undefined,
): boolean {
  if (!guardrails) return false;
  return (guardrails as { pauseFloorBudget?: unknown }).pauseFloorBudget != null;
}

export function controlsFromStrategy(
  strategy: OptimisationStrategySettings,
  objective: CampaignObjective,
  currency: string,
): ArmedCampaignControls {
  const idx = primaryRuleIndex(strategy);
  const rule: OptimisationRule | undefined = idx >= 0 ? strategy.rules[idx] : undefined;
  const base =
    strategy.guardrails.baseAdSetBudget ||
    strategy.guardrails.baseCampaignBudget ||
    0;
  return {
    objective,
    currency,
    campaignTargetValue: rule?.campaignTargetValue ?? null,
    useOverride: rule?.useOverride === true,
    primaryMetric: rule?.metric ?? null,
    primaryMetricWindow: rule?.timeWindow ?? null,
    guardrails: strategy.guardrails,
    baseCampaignBudget: base,
    hardBudgetCeiling: strategy.guardrails.hardBudgetCeiling,
  };
}

