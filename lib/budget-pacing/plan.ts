/**
 * lib/budget-pacing/plan.ts
 *
 * "What did the operator actually plan to spend on this campaign" — the
 * denominator for task #121 Phase 2's `percentSpent` calculation.
 *
 * Deliberately NOT `CampaignDraft.budgetSchedule.budgetAmount`. That field
 * only carries the whole campaign's intended budget when
 * `budgetLevel === "campaign"` (Campaign Budget Optimisation) — but
 * `lib/meta/adset.ts`'s `buildAdSetPayload` unconditionally sets a
 * per-ad-set `daily_budget` at launch regardless of `budgetLevel`/
 * `budgetType`; CBO is not currently wired through to Meta at all. The
 * actual committed spend, for every real launched campaign today, is the
 * SUM of each enabled ad set's `budgetPerDay` (already the launch-time
 * ground truth per `adset.ts`) times the scheduled number of days — the
 * exact "Total Spend (Xd)" figure Step 5 of the wizard already shows the
 * operator (`components/steps/budget-schedule.tsx`'s `days`/`totalDaily`),
 * so the Slack alert's "planned budget" always matches what the operator
 * saw when they built the campaign.
 *
 * `scheduledDays` reuses that same UI's exact formula
 * (`Math.ceil((end-start)/dayMs)`, no `+1`) for consistency rather than
 * inventing a second "how many days is this campaign" convention.
 *
 * No `@/` imports — kept `node --test`-friendly.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CampaignBudgetPlan {
  /** Sum of enabled ad sets' daily budgets × scheduled days, in minor currency units (pence). */
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
  now: Date;
}

/**
 * Returns `null` when there's nothing sensible to alert against: no enabled
 * daily budget, or a missing/invalid/non-positive-length schedule. Callers
 * should skip the campaign entirely on `null` rather than treating it as a
 * zero-budget campaign (which would make every euro spent read as ∞%).
 */
export function computeCampaignBudgetPlan(input: CampaignBudgetPlanInput): CampaignBudgetPlan | null {
  const totalDailyMajor = input.enabledDailyBudgetsMajor.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
  if (totalDailyMajor <= 0) return null;
  if (!input.startDate || !input.endDate) return null;

  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const scheduledDays = Math.ceil((end.getTime() - start.getTime()) / DAY_MS);
  if (scheduledDays <= 0) return null;

  const plannedTotalPence = Math.round(totalDailyMajor * scheduledDays * 100);
  const daysRemaining = Math.floor((end.getTime() - input.now.getTime()) / DAY_MS);

  return { plannedTotalPence, scheduledDays, daysRemaining };
}
