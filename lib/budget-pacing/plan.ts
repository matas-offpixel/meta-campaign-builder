/**
 * lib/budget-pacing/plan.ts
 *
 * "What did the operator actually plan to spend on this campaign" — the
 * denominator for task #121 Phase 2's `percentSpent` calculation.
 *
 * Deliberately NOT `CampaignDraft.budgetSchedule.budgetAmount` on its own.
 * When the live campaign or its ad sets carry a positive `lifetime_budget`,
 * that total is the denominator directly — it is not multiplied by the
 * number of days. Meta returns `"0"` for the budget type that is not in
 * use; callers must omit those zeros (`liveLifetimeBudgetsMinor` only
 * contains values > 0). A campaign-level lifetime budget is one number.
 * Ad-set lifetime budgets are one number each, summed. Do not pass both.
 *
 * Otherwise the committed spend is the SUM of each enabled ad set's
 * `budgetPerDay` times the scheduled number of days — the "Total Spend
 * (Xd)" figure the wizard shows for a daily ad-set budget. Existing daily
 * drafts keep that denominator.
 *
 * `scheduledDays` reuses that same UI's exact formula
 * (`Math.ceil((end-start)/dayMs)`, no `+1`) for consistency rather than
 * inventing a second "how many days is this campaign" convention.
 *
 * No `@/` imports — kept `node --test`-friendly.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CampaignBudgetPlan {
  /**
   * Minor units (pence). A live lifetime budget when one was supplied;
   * otherwise the sum of enabled daily budgets × scheduled days.
   */
  plannedTotalPence: number;
  scheduledDays: number;
  /** Floored whole days from `now` to `endDate`. Zero or negative once the schedule has ended. */
  daysRemaining: number;
}

export interface CampaignBudgetPlanInput {
  /** `CampaignDraft.adSetSuggestions.filter(s => s.enabled).map(s => s.budgetPerDay)` — major currency units (£), matching `adset.ts`'s own unit assumption. */
  enabledDailyBudgetsMajor: number[];
  /** `CampaignDraft.budgetSchedule.startDate` — a date-only string, e.g. "2026-08-01". */
  startDate: string;
  /** `CampaignDraft.budgetSchedule.endDate`. */
  endDate: string;
  /**
   * Live Graph `lifetime_budget` values, minor units, already filtered to
   * amounts > 0. When this list sums to more than 0 it is the denominator
   * on its own. Absent or empty keeps the daily × days plan.
   */
  liveLifetimeBudgetsMinor?: number[];
  now: Date;
}

/**
 * Returns `null` when there's nothing sensible to alert against: no enabled
 * daily budget, or a missing/invalid/non-positive-length schedule. Callers
 * should skip the campaign entirely on `null` rather than treating it as a
 * zero-budget campaign (which would make every euro spent read as ∞%).
 */
export function computeCampaignBudgetPlan(input: CampaignBudgetPlanInput): CampaignBudgetPlan | null {
  if (!input.startDate || !input.endDate) return null;

  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const scheduledDays = Math.ceil((end.getTime() - start.getTime()) / DAY_MS);
  if (scheduledDays <= 0) return null;

  const daysRemaining = Math.floor((end.getTime() - input.now.getTime()) / DAY_MS);
  const lifetimeMinor = (input.liveLifetimeBudgetsMinor ?? []).reduce(
    (sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0),
    0,
  );
  if (lifetimeMinor > 0) {
    return { plannedTotalPence: Math.round(lifetimeMinor), scheduledDays, daysRemaining };
  }

  const totalDailyMajor = input.enabledDailyBudgetsMajor.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
  if (totalDailyMajor <= 0) return null;

  const plannedTotalPence = Math.round(totalDailyMajor * scheduledDays * 100);
  return { plannedTotalPence, scheduledDays, daysRemaining };
}
