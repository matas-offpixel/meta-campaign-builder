/**
 * lib/meta/budget-launch.ts
 *
 * Last gate before a campaign we create is posted. The wizard can say
 * Lifetime or Campaign Level while an older builder still emits a daily
 * ad-set budget. This refuses that payload before any Graph POST.
 *
 * No `@/` imports — `node --test` loads it directly.
 */

export const LIFETIME_WOULD_LAUNCH_DAILY =
  "This draft is set to a lifetime budget, but the launch would send a daily budget. Nothing was sent to Meta.";

export const CBO_CAMPAIGN_HAS_NO_BUDGET =
  "This draft is set to Campaign Level (CBO), but the campaign would be created with no budget. Nothing was sent to Meta.";

export function refuseSilentDailyLaunch(input: {
  budgetType?: "daily" | "lifetime";
  budgetLevel?: "ad_set" | "campaign";
  campaign: { daily_budget?: number; lifetime_budget?: number };
  adSets: { daily_budget?: number }[];
}): string | null {
  if (input.budgetType === "lifetime") {
    const wouldSendDaily = input.adSets.some(
      (row) => row.daily_budget != null,
    );
    if (wouldSendDaily) return LIFETIME_WOULD_LAUNCH_DAILY;
  }

  if (input.budgetLevel === "campaign") {
    const hasBudget =
      (input.campaign.daily_budget != null && input.campaign.daily_budget > 0) ||
      (input.campaign.lifetime_budget != null && input.campaign.lifetime_budget > 0);
    if (!hasBudget) return CBO_CAMPAIGN_HAS_NO_BUDGET;
  }

  return null;
}
