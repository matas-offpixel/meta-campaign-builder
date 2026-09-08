/**
 * Reconcile ad-plan money against campaign-plan phases.
 *
 * `campaign_plans.total_daily_budget` is a daily figure. A phase total is
 * always daily × inclusive days. `unallocated` is signed: positive means
 * budget not yet split, negative means phases over-committed. Neither is
 * an error; this helper does not clamp.
 *
 * The canvas reads these three facts as plain lines (campaign / this
 * phase / unallocated). This helper stays the only arithmetic.
 */

import { scheduledDayCount } from "./budget-split.ts";

function pence(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

function fromPence(value: number): number {
  return value / 100;
}

export function phaseWindowTotal(
  totalDailyBudget: number,
  startDate: string | null,
  endDate: string | null,
): number | null {
  const days = scheduledDayCount(startDate, endDate);
  if (days == null) return null;
  return fromPence(pence(totalDailyBudget) * days);
}

export function reconcileCampaignPlanPhases(input: {
  campaignTotal: number;
  phases: ReadonlyArray<{
    totalDailyBudget: number;
    startDate: string | null;
    endDate: string | null;
  }>;
}): {
  campaignTotal: number;
  allocated: number;
  unallocated: number;
  phaseTotals: Array<number | null>;
} {
  const phaseTotals = input.phases.map((phase) =>
    phaseWindowTotal(phase.totalDailyBudget, phase.startDate, phase.endDate),
  );
  const allocatedPence = phaseTotals.reduce(
    (sum: number, total) => sum + pence(total ?? 0),
    0,
  );
  const campaignPence = pence(input.campaignTotal);
  return {
    campaignTotal: input.campaignTotal,
    allocated: fromPence(allocatedPence),
    unallocated: fromPence(campaignPence - allocatedPence),
    phaseTotals,
  };
}
