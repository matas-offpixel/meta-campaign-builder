import type {
  TikTokBudgetSchedule,
  TikTokCampaignDraft,
  TikTokOptimisation,
} from "../types/tiktok-draft.ts";
import { parseMoneyAmountInput } from "../additional-spend-parse.ts";

export interface SmartPlusDefaults {
  optimisation: TikTokOptimisation;
  budgetSchedule: TikTokBudgetSchedule;
  campaignSetup: TikTokCampaignDraft["campaignSetup"];
}

export function applySmartPlusDefaults(
  draft: TikTokCampaignDraft,
  now = new Date(),
): SmartPlusDefaults {
  const start = toDatetimeLocal(now);
  const end = toDatetimeLocal(addDays(now, 30));
  return {
    optimisation: {
      ...draft.optimisation,
      smartPlusEnabled: true,
      bidStrategy: "SMART_PLUS",
      pacing: "STANDARD",
    },
    campaignSetup: {
      ...draft.campaignSetup,
      bidStrategy: "SMART_PLUS",
    },
    budgetSchedule: {
      ...draft.budgetSchedule,
      budgetMode: "LIFETIME",
      automaticSchedule: true,
      scheduleStartAt: draft.budgetSchedule.scheduleStartAt ?? start,
      scheduleEndAt: draft.budgetSchedule.scheduleEndAt ?? end,
      lifetimeBudget:
        draft.budgetSchedule.budgetAmount ?? draft.budgetSchedule.lifetimeBudget,
      dailyBudget: null,
    },
  };
}

export function disableSmartPlus(
  draft: TikTokCampaignDraft,
): Pick<SmartPlusDefaults, "optimisation" | "budgetSchedule"> {
  return {
    optimisation: {
      ...draft.optimisation,
      smartPlusEnabled: false,
      bidStrategy: null,
    },
    budgetSchedule: {
      ...draft.budgetSchedule,
      automaticSchedule: false,
    },
  };
}

export function parseOptionalMoney(raw: string): number | null {
  if (!raw.trim()) return null;
  const parsed = parseMoneyAmountInput(raw);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

export function validateBudgetGuardrails(input: {
  budget: TikTokBudgetSchedule;
  optimisation: TikTokOptimisation;
}): string[] {
  const warnings: string[] = [];
  const amount = input.budget.budgetAmount;
  if (
    amount != null &&
    input.budget.budgetMode === "DAILY" &&
    input.optimisation.maxDailySpend != null &&
    amount > input.optimisation.maxDailySpend
  ) {
    warnings.push("Daily budget is above the max daily spend guardrail.");
  }
  if (
    amount != null &&
    input.budget.budgetMode === "LIFETIME" &&
    input.optimisation.maxLifetimeSpend != null &&
    amount > input.optimisation.maxLifetimeSpend
  ) {
    warnings.push("Lifetime budget is above the max lifetime spend guardrail.");
  }
  if (
    input.budget.scheduleStartAt &&
    input.budget.scheduleEndAt &&
    input.budget.scheduleEndAt <= input.budget.scheduleStartAt
  ) {
    warnings.push("Schedule end must be after schedule start.");
  }
  return warnings;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
