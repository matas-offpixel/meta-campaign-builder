/**
 * Campaign-daily ceiling for the optimisation tick.
 *
 * Denominator is `computeCampaignBudgetPlan.plannedTotalPence` — the same
 * figure `/api/cron/budget-pacing-check` already alerts against (sum of
 * enabled draft ad-set dailies × scheduled days). `ad_plans.total_budget`
 * is the event's paid-media pot (one row, several phases/channels) and is
 * the wrong object for this Meta campaign.
 *
 * A campaign ceiling is a SUM constraint. It is not a per-ad-set cap —
 * that is what `maxSingleAdSetBudget` is for. ABO applies this as
 * headroom that decrements within the run. CBO applies it to the
 * campaign's own daily_budget.
 */

import type { BudgetGuardrails } from "../types.ts";
import { computeCampaignBudgetPlan, type CampaignBudgetPlan } from "../budget-pacing/plan.ts";

export const BASE_AD_SET_BUDGET_KEYS = ["baseAdSetBudget", "baseCampaignBudget"] as const;

export function readBaseAdSetBudget(guardrails: BudgetGuardrails): number {
  const record = guardrails as unknown as Record<string, unknown>;
  for (const key of BASE_AD_SET_BUDGET_KEYS) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return raw;
    }
  }
  return 0;
}

export type CampaignCeilingResolution =
  | { kind: "inactive" }
  | { kind: "absent"; note: "campaign_ceiling_absent" }
  | { kind: "unreadable"; note: "campaign_ceiling_unreadable" }
  | { kind: "active"; dailyCeilingPence: number; source: "derived" | "typed" };

export function remainingDailyAllowancePence(
  plannedTotalPence: number,
  spentPence: number,
  daysRemaining: number,
): number {
  const days = Math.max(daysRemaining, 1);
  return Math.max(0, Math.round((plannedTotalPence - spentPence) / days));
}

export function resolveCampaignCeiling(input: {
  guardrails: BudgetGuardrails;
  plan: CampaignBudgetPlan | null | "unreadable";
  spentPence: number | "unreadable";
}): CampaignCeilingResolution {
  const scope = input.guardrails.budgetCeilingScope ?? "ad_set";
  if (scope === "ad_set") return { kind: "inactive" };

  const source = input.guardrails.campaignDailyCeilingSource ?? "derived";
  if (source === "typed") {
    const typed = input.guardrails.campaignDailyCeiling;
    if (typed == null || !Number.isFinite(typed) || typed <= 0) {
      return { kind: "absent", note: "campaign_ceiling_absent" };
    }
    return {
      kind: "active",
      dailyCeilingPence: Math.round(typed * 100),
      source: "typed",
    };
  }

  if (input.plan === "unreadable" || input.spentPence === "unreadable") {
    return { kind: "unreadable", note: "campaign_ceiling_unreadable" };
  }
  if (input.plan == null) {
    return { kind: "absent", note: "campaign_ceiling_absent" };
  }
  if (!Number.isFinite(input.spentPence)) {
    return { kind: "unreadable", note: "campaign_ceiling_unreadable" };
  }

  return {
    kind: "active",
    dailyCeilingPence: remainingDailyAllowancePence(
      input.plan.plannedTotalPence,
      input.spentPence,
      input.plan.daysRemaining,
    ),
    source: "derived",
  };
}

export function planFromDraftFields(
  enabledDailyBudgetsMajor: number[] | undefined,
  startDate: string | undefined,
  endDate: string | undefined,
  now: Date,
): CampaignBudgetPlan | null {
  if (!enabledDailyBudgetsMajor || !startDate || !endDate) return null;
  return computeCampaignBudgetPlan({
    enabledDailyBudgetsMajor,
    startDate,
    endDate,
    now,
  });
}

export interface HeadroomDecision {
  actionRecommended: string;
  actionDelta: number | null;
  budgetBeforePence: number;
  budgetAfterPence: number;
  guardrailNote: string | null;
  reasonText: string;
}

/**
 * ABO only. Campaign ceiling is headroom against the live daily total,
 * not a per-ad-set cap. CBO applies the ceiling inside evaluate.ts.
 */
export function applyCampaignHeadroom<T extends HeadroomDecision>(
  decision: T,
  resolution: CampaignCeilingResolution,
  headroomPence: number | null,
): { decision: T; usedPence: number } {
  if (resolution.kind === "inactive") {
    return { decision, usedPence: 0 };
  }

  if (resolution.kind === "absent" || resolution.kind === "unreadable") {
    if (decision.guardrailNote != null) return { decision, usedPence: 0 };
    const clause =
      resolution.kind === "absent"
        ? "Campaign ceiling absent — no campaign-daily cap applied."
        : "Campaign ceiling unreadable — no campaign-daily cap applied.";
    return {
      decision: {
        ...decision,
        guardrailNote: resolution.note,
        reasonText: `${decision.reasonText} ${clause}`,
      },
      usedPence: 0,
    };
  }

  if (decision.actionRecommended !== "scale_up") {
    return { decision, usedPence: 0 };
  }

  const want = decision.budgetAfterPence - decision.budgetBeforePence;
  const room = headroomPence ?? 0;
  if (want <= 0) return { decision, usedPence: 0 };

  if (room <= 0) {
    return {
      decision: {
        ...decision,
        actionRecommended: "maintain",
        actionDelta: null,
        budgetAfterPence: decision.budgetBeforePence,
        guardrailNote: "capped_by_campaign_ceiling",
        reasonText: `${decision.reasonText} Campaign daily headroom exhausted — capped_by_campaign_ceiling.`,
      },
      usedPence: 0,
    };
  }

  if (want <= room) {
    return { decision, usedPence: want };
  }

  return {
    decision: {
      ...decision,
      budgetAfterPence: decision.budgetBeforePence + room,
      guardrailNote: "capped_by_campaign_ceiling",
      reasonText:
        `${decision.reasonText} Clamped to remaining campaign daily headroom ` +
        `${room}p — capped_by_campaign_ceiling.`,
    },
    usedPence: room,
  };
}

/** Cheapest primary metric first. Nulls last. Arrival order is not a decision. */
export function compareCheapestMetricFirst(
  a: number | null | undefined,
  b: number | null | undefined,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}
