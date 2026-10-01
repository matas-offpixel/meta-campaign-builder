/**
 * lib/meta/budget-launch.ts
 *
 * Last gate before a campaign or an attach-mode ad set is posted.
 * The builder can emit lifetime_budget: 0 when a daily draft is flipped
 * to Lifetime and the rows were never converted. That used to pass this
 * gate, create the campaign, and then throw on every ad set.
 *
 * No `@/` imports — `node --test` loads it directly.
 */

export const CBO_CAMPAIGN_HAS_NO_BUDGET =
  "Campaign level (CBO) has no budget. Set it on the Budget step. Nothing was sent to Meta.";

export interface LaunchBudgetAdSetPayload {
  name?: string;
  daily_budget?: number;
  lifetime_budget?: number;
  bid_strategy?: string;
  end_time?: number;
}

/** A Graph budget of 0, "0", or absent is not a budget. */
export function positiveBudgetMinor(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Ad set budget shape for attach_campaign. The live target decides.
 * A positive campaign budget means the new ad sets are budget-less.
 * Otherwise the draft's budget type is sent at ad set level, and the
 * draft's own budget level is ignored.
 */
export function budgetScheduleForAttach<T extends { budgetLevel: "ad_set" | "campaign" }>(
  draft: T,
  target: { daily_budget?: unknown; lifetime_budget?: unknown },
): T {
  const targetIsCbo =
    positiveBudgetMinor(target.daily_budget) != null ||
    positiveBudgetMinor(target.lifetime_budget) != null;
  return { ...draft, budgetLevel: targetIsCbo ? "campaign" : "ad_set" };
}

function adSetLabel(row: LaunchBudgetAdSetPayload, index: number): string {
  const name = row.name?.trim();
  return name ? name : `Ad set ${index + 1}`;
}

function carriesBudget(value: unknown): boolean {
  return value != null;
}

function carriesBidStrategy(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

export function refuseSilentDailyLaunch(input: {
  budgetType?: "daily" | "lifetime";
  budgetLevel?: "ad_set" | "campaign";
  campaign: { daily_budget?: number; lifetime_budget?: number };
  adSets: LaunchBudgetAdSetPayload[];
}): string | null {
  const level = input.budgetLevel ?? "ad_set";
  const type = input.budgetType ?? "daily";

  if (level === "campaign") {
    const hasBudget =
      (input.campaign.daily_budget != null && input.campaign.daily_budget > 0) ||
      (input.campaign.lifetime_budget != null && input.campaign.lifetime_budget > 0);
    if (!hasBudget) return CBO_CAMPAIGN_HAS_NO_BUDGET;
    for (let i = 0; i < input.adSets.length; i++) {
      const row = input.adSets[i]!;
      if (
        carriesBudget(row.daily_budget) ||
        carriesBudget(row.lifetime_budget) ||
        carriesBidStrategy(row.bid_strategy)
      ) {
        return `Ad set "${adSetLabel(row, i)}" still carries its own budget under Campaign level (CBO). Clear it on the Budget step. Nothing was sent to Meta.`;
      }
    }
    return null;
  }

  if (type === "lifetime") {
    for (let i = 0; i < input.adSets.length; i++) {
      const row = input.adSets[i]!;
      const name = adSetLabel(row, i);
      if (!(typeof row.lifetime_budget === "number" && row.lifetime_budget > 0)) {
        return `Ad set "${name}" has no lifetime budget. Set it on the Budget step. Nothing was sent to Meta.`;
      }
      if (!(typeof row.end_time === "number" && row.end_time > 0)) {
        return `Ad set "${name}" has no end date. Set an end date on the Budget step. Nothing was sent to Meta.`;
      }
    }
    return null;
  }

  if (type === "daily" && level === "ad_set") {
    for (let i = 0; i < input.adSets.length; i++) {
      const row = input.adSets[i]!;
      if (!(typeof row.daily_budget === "number" && row.daily_budget > 0)) {
        return `Ad set "${adSetLabel(row, i)}" has no daily budget. Set it on the Budget step. Nothing was sent to Meta.`;
      }
    }
  }

  return null;
}

const REVIEW_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMajor(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  return amount.toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

function formatEndLabel(endDate: string | undefined): string | null {
  if (!endDate || !/^\d{4}-\d{2}-\d{2}/.test(endDate)) return null;
  const parsed = new Date(`${endDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCDate()} ${REVIEW_MONTHS[parsed.getUTCMonth()]}`;
}

/** One line on Review, directly above Launch. */
export function describeLaunchBudget(input: {
  budgetLevel: "ad_set" | "campaign";
  budgetType: "daily" | "lifetime";
  budgetAmount: number;
  currency: string;
  enabledAdSetCount: number;
  endDate?: string;
}): string {
  const level = input.budgetLevel === "campaign" ? "Campaign level (CBO)" : "Ad set level";
  const kind = input.budgetType === "lifetime" ? "Lifetime" : "Daily";
  const amount = `${input.currency} ${formatMajor(input.budgetAmount)}`;
  const perDay = input.budgetType === "daily" ? "/day" : "";
  const across =
    input.budgetLevel === "ad_set"
      ? ` across ${input.enabledAdSetCount} ad set${input.enabledAdSetCount === 1 ? "" : "s"}`
      : "";
  const endLabel = input.budgetType === "lifetime" ? formatEndLabel(input.endDate) : null;
  const ends = endLabel ? ` · ends ${endLabel}` : "";
  return `${level} · ${kind} · ${amount}${perDay}${across}${ends}`;
}
