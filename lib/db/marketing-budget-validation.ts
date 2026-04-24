/**
 * Cross-field rule: paid media (plan or event) must not exceed total
 * marketing budget. Used by updateEventRow, updatePlan, and resync.
 */

export const PAID_MEDIA_EXCEEDS_TOTAL_MARKETING =
  "Paid media budget cannot exceed total marketing budget.";

/**
 * @param paidMedia — canonical paid cap: `ad_plans.total_budget` when a
 *   plan exists, else `events.budget_marketing`.
 * @param totalMarketing — `events.total_marketing_budget` (null = no cap / legacy single-card mode).
 */
export function assertPaidMediaWithinTotalMarketing(
  paidMedia: number | null | undefined,
  totalMarketing: number | null | undefined,
): void {
  const t = totalMarketing;
  const p = paidMedia;
  if (t == null || t <= 0) return;
  if (p == null || p <= 0) return;
  if (p > t) {
    throw new Error(PAID_MEDIA_EXCEEDS_TOTAL_MARKETING);
  }
}

/**
 * Additional marketing allocation = total marketing − paid media (plan
 * total_budget when a plan exists, else events.budget_marketing). Null
 * when no total marketing cap (legacy single-card mode).
 */
export function computeAdditionalMarketingAllocation(
  totalMarketing: number | null | undefined,
  plan: { total_budget: number | null } | null,
  eventBudgetMarketing: number | null | undefined,
): number | null {
  if (totalMarketing == null) return null;
  const paid =
    plan != null
      ? (plan.total_budget ?? eventBudgetMarketing ?? 0)
      : (eventBudgetMarketing ?? 0);
  return totalMarketing - paid;
}
