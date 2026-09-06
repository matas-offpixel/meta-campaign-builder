/**
 * G34 / canon §2.2 D — the benchmark view's window, named once.
 *
 *   signup · click · lpv · lead  — days strictly before general sale
 *                                 (whole run when general_sale_at is null)
 *   purchase                     — days on or after general sale
 *                                 (whole run when null)
 *   ticket                       — through the last ticket day
 *   view                         — whole run; result is meta_reach ÷ 1000
 *
 * The view's WHERE must mirror PLAN_BENCHMARK_WINDOW_FOR_UNIT.
 */

export const PLAN_BENCHMARK_WINDOW = {
  beforeGeneralSale: "before-general-sale",
  onOrAfterGeneralSale: "on-or-after-general-sale",
  toLastTicketEntry: "to-last-ticket-entry",
  wholeRun: "whole-run",
  /** Alias — signup · click · lpv · lead */
  perSignup: "before-general-sale",
  /** Alias — ticket */
  perTicket: "to-last-ticket-entry",
} as const;

export type PlanBenchmarkWindow =
  (typeof PLAN_BENCHMARK_WINDOW)[keyof typeof PLAN_BENCHMARK_WINDOW];

export type PlanBenchmarkWindowUnit =
  | "signup"
  | "click"
  | "lpv"
  | "lead"
  | "purchase"
  | "ticket"
  | "view";

export const PLAN_BENCHMARK_WINDOW_FOR_UNIT: Record<
  PlanBenchmarkWindowUnit,
  PlanBenchmarkWindow
> = {
  signup: PLAN_BENCHMARK_WINDOW.beforeGeneralSale,
  click: PLAN_BENCHMARK_WINDOW.beforeGeneralSale,
  lpv: PLAN_BENCHMARK_WINDOW.beforeGeneralSale,
  lead: PLAN_BENCHMARK_WINDOW.beforeGeneralSale,
  purchase: PLAN_BENCHMARK_WINDOW.onOrAfterGeneralSale,
  ticket: PLAN_BENCHMARK_WINDOW.toLastTicketEntry,
  view: PLAN_BENCHMARK_WINDOW.wholeRun,
};

export const PLAN_BENCHMARK_PHASE_LABEL: Record<PlanBenchmarkWindow, string> = {
  "before-general-sale": "before general sale",
  "on-or-after-general-sale": "on or after general sale",
  "to-last-ticket-entry": "to the last ticket entry",
  "whole-run": "the whole run",
};

export type DailyCostRow = {
  day: string;
  spend: number;
  tickets?: number;
  signups?: number;
  purchases?: number;
  clicks?: number;
  lpv?: number;
  leads?: number;
  reach?: number;
};

function resultsForUnit(row: DailyCostRow, unit: PlanBenchmarkWindowUnit): number {
  if (unit === "ticket") return row.tickets ?? 0;
  if (unit === "signup") return row.signups ?? 0;
  if (unit === "purchase") return row.purchases ?? 0;
  if (unit === "click") return row.clicks ?? 0;
  if (unit === "lpv") return row.lpv ?? 0;
  if (unit === "lead") return row.leads ?? 0;
  return row.reach ?? 0;
}

function daysInWindow(
  days: DailyCostRow[],
  unit: PlanBenchmarkWindowUnit,
  generalSaleDay: string | null,
): DailyCostRow[] {
  const window = PLAN_BENCHMARK_WINDOW_FOR_UNIT[unit];
  if (window === PLAN_BENCHMARK_WINDOW.wholeRun) return days;
  if (window === PLAN_BENCHMARK_WINDOW.toLastTicketEntry) {
    let lastIdx = -1;
    for (let i = 0; i < days.length; i += 1) {
      if ((days[i]?.tickets ?? 0) > 0) lastIdx = i;
    }
    return lastIdx < 0 ? [] : days.slice(0, lastIdx + 1);
  }
  if (!generalSaleDay) return days;
  if (window === PLAN_BENCHMARK_WINDOW.onOrAfterGeneralSale) {
    return days.filter((row) => row.day >= generalSaleDay);
  }
  return days.filter((row) => row.day < generalSaleDay);
}

/**
 * The one windowed read. Tests pin each unit through this function so
 * the view's WHERE cannot drift from PLAN_BENCHMARK_WINDOW_FOR_UNIT.
 */
export function windowedBenchmarkRead(
  unit: PlanBenchmarkWindowUnit,
  days: DailyCostRow[],
  generalSaleDay: string | null,
): {
  window: PlanBenchmarkWindow;
  spend: number;
  results: number;
  cost: number | null;
} {
  const sliced = daysInWindow(days, unit, generalSaleDay);
  const spend = sliced.reduce((sum, row) => sum + row.spend, 0);
  const raw = sliced.reduce((sum, row) => sum + resultsForUnit(row, unit), 0);
  const results = unit === "view" ? raw / 1000 : raw;
  return {
    window: PLAN_BENCHMARK_WINDOW_FOR_UNIT[unit],
    spend,
    results,
    cost: results > 0 ? spend / results : null,
  };
}

/**
 * Per-ticket read: keep spend and tickets only through the last day
 * that has a ticket entry. Spend after day N is ignored.
 */
export function windowedPerTicketRead(days: DailyCostRow[]): {
  spend: number;
  tickets: number;
  perTicket: number | null;
  lastTicketDay: string | null;
} {
  const sliced = daysInWindow(days, "ticket", null);
  const spend = sliced.reduce((sum, row) => sum + row.spend, 0);
  const tickets = sliced.reduce((sum, row) => sum + (row.tickets ?? 0), 0);
  return {
    spend,
    tickets,
    perTicket: tickets > 0 ? spend / tickets : null,
    lastTicketDay: sliced.at(-1)?.day ?? null,
  };
}

/**
 * Per-signup read: keep days strictly before general sale.
 */
export function windowedPerSignupRead(
  days: DailyCostRow[],
  generalSaleDay: string | null,
): { spend: number; signups: number; perSignup: number | null } {
  const read = windowedBenchmarkRead("signup", days, generalSaleDay);
  return { spend: read.spend, signups: read.results, perSignup: read.cost };
}
