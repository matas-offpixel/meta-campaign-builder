/**
 * lib/google-search/budget.ts
 *
 * What each Google Search campaign spends per day, and where that number
 * came from. Pure and client-safe: the wizard, `validateGoogleSearchPlan`
 * and the push writer (`lib/google-ads/campaign-writer.ts`) all read it,
 * so the figure on Review is the figure push sends.
 *
 * Per campaign, first match wins:
 *   1. `campaign.daily_budget` > 0
 *   2. `campaign.monthly_budget` > 0, ÷ 30
 *   3. the plan daily budget split evenly across the campaigns that will
 *      serve (not marked Paused in the sheet), floored to the penny. A
 *      sheet-paused campaign gets the same share so it never falls to (4);
 *      it is not counted in the spend total because it does not serve.
 *   4. £5/day. Review hard-blocks any campaign that reaches this.
 *
 * Plan daily budget = `total_budget` ÷ inclusive days of `date_range`,
 * rounded to 2dp. `plan.daily_budget` (migration 188) stores the same
 * figure; the derived value wins whenever both inputs are present.
 */

import { sheetMarksCampaignPaused } from "../google-ads/push-status.ts";
import type {
  GoogleSearchCampaignNode,
  GoogleSearchDateRange,
  GoogleSearchPlanTree,
} from "./types.ts";

export const FALLBACK_DAILY_BUDGET_POUNDS = 5;
/** Google's effective daily-budget floor for GBP accounts. */
export const MIN_DAILY_BUDGET_MICROS = 1_000_000;
/** Review blocks when planned spend exceeds the plan total by more than this. */
export const PLAN_OVERSPEND_TOLERANCE = 0.1;

export type CampaignBudgetSource =
  | "campaign_daily"
  | "campaign_monthly"
  | "plan_split"
  | "fallback";

export interface ResolvedCampaignBudget {
  campaignId: string;
  campaignName: string;
  /** Pounds per day before the Google floor. */
  pounds: number;
  /** What push sends as `campaignBudget.amountMicros`. */
  micros: number;
  source: CampaignBudgetSource;
  /** False when the sheet marks the campaign Paused. */
  serves: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function inclusiveDays(range: GoogleSearchDateRange | null | undefined): number | null {
  if (!range) return null;
  const since = (range.since ?? "").trim();
  const until = (range.until ?? "").trim();
  if (!ISO_DATE.test(since) || !ISO_DATE.test(until)) return null;
  const start = Date.parse(`${since}T00:00:00Z`);
  const end = Date.parse(`${until}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / DAY_MS) + 1;
}

export function derivePlanDailyBudget(
  totalBudget: number | string | null | undefined,
  range: GoogleSearchDateRange | null | undefined,
): number | null {
  const total = positiveAmount(totalBudget);
  if (total == null) return null;
  const days = inclusiveDays(range);
  if (!days) return null;
  return Math.round((total / days) * 100) / 100;
}

export function effectivePlanDailyBudget(
  plan: Pick<GoogleSearchPlanTree["plan"], "total_budget" | "date_range" | "daily_budget">,
): number | null {
  return derivePlanDailyBudget(plan.total_budget, plan.date_range) ?? positiveAmount(plan.daily_budget);
}

export function poundsToMicros(pounds: number): number {
  return Math.round(pounds * 1_000_000);
}

/** `numeric` columns can arrive from PostgREST as strings ("6.00"). */
export function positiveAmount(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function floorToPenny(pounds: number): number {
  return Math.floor(pounds * 100 + 1e-9) / 100;
}

function campaignServes(campaign: Pick<GoogleSearchCampaignNode, "name" | "bid_adjustments">): boolean {
  return !sheetMarksCampaignPaused(campaign.name, campaign.bid_adjustments);
}

export function resolveCampaignDailyBudgets(
  tree: Pick<GoogleSearchPlanTree, "plan" | "campaigns">,
): ResolvedCampaignBudget[] {
  const planDaily = effectivePlanDailyBudget(tree.plan);
  const serving = tree.campaigns.filter(campaignServes).length;
  const shareOf = serving > 0 ? serving : tree.campaigns.length;
  const share = planDaily != null && shareOf > 0 ? floorToPenny(planDaily / shareOf) : null;

  return tree.campaigns.map((campaign) => {
    const daily = positiveAmount(campaign.daily_budget);
    const monthly = positiveAmount(campaign.monthly_budget);
    let pounds: number;
    let source: CampaignBudgetSource;
    if (daily != null) {
      pounds = daily;
      source = "campaign_daily";
    } else if (monthly != null) {
      pounds = monthly / 30;
      source = "campaign_monthly";
    } else if (share != null && share > 0) {
      pounds = share;
      source = "plan_split";
    } else {
      pounds = FALLBACK_DAILY_BUDGET_POUNDS;
      source = "fallback";
    }
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      pounds,
      micros: Math.max(MIN_DAILY_BUDGET_MICROS, poundsToMicros(pounds)),
      source,
      serves: campaignServes(campaign),
    };
  });
}

/** Σ daily budgets push sends for the campaigns that serve, in pounds. Null with no campaigns. */
export function plannedDailySpend(tree: Pick<GoogleSearchPlanTree, "plan" | "campaigns">): number | null {
  if (tree.campaigns.length === 0) return null;
  const perDay = resolveCampaignDailyBudgets(tree)
    .filter((b) => b.serves)
    .reduce((sum, b) => sum + b.micros / 1_000_000, 0);
  return Math.round(perDay * 100) / 100;
}

/** Total the serving campaigns would spend over the plan window. Null without a window. */
export function plannedCampaignSpend(
  tree: Pick<GoogleSearchPlanTree, "plan" | "campaigns">,
): { spend: number; days: number } | null {
  const days = inclusiveDays(tree.plan.date_range);
  if (!days) return null;
  const perDay = plannedDailySpend(tree) ?? 0;
  return { spend: Math.round(perDay * days * 100) / 100, days };
}

export function formatPounds(value: number): string {
  return `£${value.toFixed(2)}`;
}
