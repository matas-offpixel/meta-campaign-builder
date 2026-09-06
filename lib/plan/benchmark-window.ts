/**
 * G34 — the benchmark view's window, named once. Costs per signup are
 * read before general sale; costs per ticket are read to the last
 * ticket entry (brief §2 — Junction 2's tickets stop Mon 20 Apr on
 * every run, so spend past that day never divides by them).
 */
export const PLAN_BENCHMARK_WINDOW = {
  perSignup: "before-general-sale",
  perTicket: "to-last-ticket-entry",
} as const;

export type PlanBenchmarkWindow = (typeof PLAN_BENCHMARK_WINDOW)[keyof typeof PLAN_BENCHMARK_WINDOW];

export const PLAN_BENCHMARK_PHASE_LABEL: Record<PlanBenchmarkWindow, string> = {
  "before-general-sale": "before general sale",
  "to-last-ticket-entry": "to the last ticket entry",
};

export type DailyCostRow = {
  day: string;
  spend: number;
  tickets?: number;
  signups?: number;
};

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
  let lastIdx = -1;
  for (let i = 0; i < days.length; i += 1) {
    if ((days[i]?.tickets ?? 0) > 0) lastIdx = i;
  }
  if (lastIdx < 0) {
    return { spend: 0, tickets: 0, perTicket: null, lastTicketDay: null };
  }
  const sliced = days.slice(0, lastIdx + 1);
  const spend = sliced.reduce((sum, row) => sum + row.spend, 0);
  const tickets = sliced.reduce((sum, row) => sum + (row.tickets ?? 0), 0);
  return {
    spend,
    tickets,
    perTicket: tickets > 0 ? spend / tickets : null,
    lastTicketDay: sliced[lastIdx]?.day ?? null,
  };
}

/**
 * Per-signup read: keep days strictly before general sale.
 * `generalSaleDay` is inclusive of the sale day only when the sale
 * is the first instant of that day; callers pass the last in-window day.
 */
export function windowedPerSignupRead(
  days: DailyCostRow[],
  generalSaleDay: string | null,
): { spend: number; signups: number; perSignup: number | null } {
  const sliced = generalSaleDay
    ? days.filter((row) => row.day < generalSaleDay)
    : days;
  const spend = sliced.reduce((sum, row) => sum + row.spend, 0);
  const signups = sliced.reduce((sum, row) => sum + (row.signups ?? 0), 0);
  return {
    spend,
    signups,
    perSignup: signups > 0 ? spend / signups : null,
  };
}
