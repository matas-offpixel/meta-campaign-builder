/**
 * lib/dashboard/funnel-projection.ts
 *
 * Pure projection layer for the interactive Funnel Pacing chart
 * (PR-D of the convergence arc, issue #467). Consumes values already
 * computed by `buildVenueCanonicalFunnel` — NO DB / network / Supabase /
 * Meta calls, no re-derivation of source-of-truth numbers. The host
 * component passes canonical-funnel fields straight in.
 *
 * Three forward projections, each a straight ray in (time, tickets) and
 * (spend, tickets) space:
 *
 *   - Current pace   — spend at the actual `spentPerDay`, convert at the
 *                      live CPT. Where the campaign is actually headed by
 *                      event date. May fall short of, or overshoot,
 *                      capacity.
 *   - Required pace  — the daily spend that, at the live CPT, sells out
 *                      exactly on event date. Ticket trajectory lands on
 *                      capacity at day D by construction.
 *   - Suggested      — the daily spend that, at the BENCHMARK CPT, sells
 *                      out exactly on event date. Same ticket trajectory
 *                      as Required (→ capacity at D); the two diverge only
 *                      in £/day (and therefore on the spend axis). The gap
 *                      between Required and Suggested daily spend is the
 *                      efficiency delta vs benchmark — the "inefficiency
 *                      tax" when live CPT > benchmark CPT, an efficiency
 *                      bonus when it's below (Edinburgh's case).
 *
 * Required & Suggested share an identical ticket-vs-time line (both reach
 * capacity at event date). They are visually distinct on the SPEND axis,
 * where they extend to different cumulative-spend endpoints, and in the
 * tooltip/figcaption where their £/day differ. Current pace is the line
 * that diverges on the time axis.
 */

/** Evenly-spaced sample count along the [today, eventDate] window. */
const SAMPLE_COUNT = 40;

export type ProjectionXAxis = "time" | "spend";

export type ProjectionLineKey = "current" | "required" | "suggested";

export interface FunnelProjectionInput {
  capacity: number;
  /** events.tickets_sold SUM — canonical. */
  ticketsSold: number;
  /** Allocated-only spend to date. */
  spent: number;
  /** SUM(budget_marketing) via aggregateSharedVenueBudget. `null` when unset. */
  allocated: number | null;
  /** spent / daysSinceFirstSpend. `null` when no spend yet. */
  spentPerDay: number | null;
  /** spent / ticketsSold. `null` when no purchases yet. */
  liveCostPerTicket: number | null;
  /** Industry benchmark CPT (£4.80). */
  benchmarkCostPerTicket: number;
  /** Days from today to event date. `null`/≤0 → projection unavailable. */
  daysToEvent: number | null;
  /** Days since first spend. 0/`null` → campaign not yet live. */
  daysSinceFirstSpend: number | null;
  /** ISO event date for labels. `null` → derived as today + daysToEvent. */
  eventDate: string | null;
  /** From canonical spendReconciliation — surfaced as the banner. */
  warning: "additional_needed" | "pace_covered" | null;
  warningAmount: number | null;
  /** Override "today" for deterministic tests. */
  today?: Date;
}

export interface ProjectionPoint {
  /** Day offset from today (0 = today, D = event date). */
  day: number;
  /** Cumulative £ spent at this point. */
  spend: number;
  /** Cumulative tickets sold at this point (uncapped — may exceed capacity). */
  tickets: number;
}

export interface ProjectionLine {
  key: ProjectionLineKey;
  label: string;
  /** Daily £ spend defining this ray. `null` when not derivable. */
  dailySpend: number | null;
  /** Cost-per-ticket used to convert spend → tickets. */
  costPerTicket: number;
  /** Sample points spanning [today, eventDate]. */
  points: ProjectionPoint[];
  /** Tickets at event date (uncapped). */
  endpointTickets: number;
  /** Cumulative spend at event date. */
  endpointSpend: number;
  /** True when the ray reaches capacity at or before event date. */
  reachesCapacity: boolean;
}

export interface SelloutMarker {
  /** Day at which Current pace hits capacity. `null` when never within window. */
  day: number | null;
  /** Cumulative spend at that crossing. `null` when no crossing. */
  spend: number | null;
  /** ISO date of the crossing. `null` when no crossing. */
  date: string | null;
}

export interface FunnelProjection {
  /** False when daysToEvent is null/≤0 — caller renders "event passed". */
  available: boolean;
  /** False when campaign not yet live (no spend / no live CPT). */
  campaignLive: boolean;
  capacity: number;
  ticketsSold: number;
  ticketsRemaining: number;
  spent: number;
  allocated: number | null;
  /** ≥1 when available. */
  daysToEvent: number;
  /** ISO event date (resolved). */
  eventDate: string | null;
  /** Current / Required / Suggested, in render order. Current omitted pre-launch. */
  lines: ProjectionLine[];
  /** Sellout crossing for the Current pace line. */
  sellout: SelloutMarker;
  /** Event-date marker x-position on the SPEND axis (= total spend to sell out). */
  requiredTotalSpend: number | null;
  /** Live £/day to sell out by event date. `null` when no live CPT. */
  requiredPerDay: number | null;
  /** Benchmark £/day to sell out by event date. */
  suggestedDaily: number | null;
  warning: "additional_needed" | "pace_covered" | null;
  warningAmount: number | null;
}

function addDaysIso(today: Date, days: number): string {
  const ms = today.getTime() + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function buildLine(
  key: ProjectionLineKey,
  label: string,
  dailySpend: number,
  costPerTicket: number,
  ticketsSold: number,
  spent: number,
  capacity: number,
  daysToEvent: number,
): ProjectionLine {
  const points: ProjectionPoint[] = [];
  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const day = (i / SAMPLE_COUNT) * daysToEvent;
    points.push({
      day,
      spend: spent + dailySpend * day,
      tickets: ticketsSold + (dailySpend * day) / costPerTicket,
    });
  }
  const endpointTickets = ticketsSold + (dailySpend * daysToEvent) / costPerTicket;
  const endpointSpend = spent + dailySpend * daysToEvent;
  return {
    key,
    label,
    dailySpend,
    costPerTicket,
    points,
    endpointTickets,
    endpointSpend,
    reachesCapacity: endpointTickets >= capacity - 1e-6,
  };
}

/**
 * Build the forward-projection model. Pure — deterministic given `today`.
 */
export function buildFunnelProjection(
  input: FunnelProjectionInput,
): FunnelProjection {
  const today = input.today ?? new Date();
  const capacity = Math.max(0, input.capacity);
  const ticketsSold = Math.max(0, input.ticketsSold);
  const ticketsRemaining = Math.max(0, capacity - ticketsSold);
  const spent = Math.max(0, input.spent);
  const liveCpt = input.liveCostPerTicket;
  const benchCpt = input.benchmarkCostPerTicket;
  const D = input.daysToEvent;

  // Event passed / no date / already sold out → nothing to project.
  if (D == null || D <= 0 || ticketsRemaining <= 0) {
    return {
      available: false,
      campaignLive: false,
      capacity,
      ticketsSold,
      ticketsRemaining,
      spent,
      allocated: input.allocated,
      daysToEvent: D ?? 0,
      eventDate: input.eventDate,
      lines: [],
      sellout: { day: null, spend: null, date: null },
      requiredTotalSpend: null,
      requiredPerDay: null,
      suggestedDaily: null,
      warning: input.warning,
      warningAmount: input.warningAmount,
    };
  }

  const eventDate = input.eventDate ?? addDaysIso(today, D);

  const campaignLive =
    (input.daysSinceFirstSpend ?? 0) > 0 &&
    input.spentPerDay != null &&
    input.spentPerDay > 0 &&
    liveCpt != null &&
    liveCpt > 0;

  const requiredPerDay =
    liveCpt != null && liveCpt > 0 ? (ticketsRemaining * liveCpt) / D : null;
  const suggestedDaily =
    benchCpt > 0 ? (ticketsRemaining * benchCpt) / D : null;

  const lines: ProjectionLine[] = [];

  // Current pace — actual spend rate × live CPT. Only when live.
  if (campaignLive && input.spentPerDay != null && liveCpt != null) {
    lines.push(
      buildLine(
        "current",
        "Current pace",
        input.spentPerDay,
        liveCpt,
        ticketsSold,
        spent,
        capacity,
        D,
      ),
    );
  }

  // Required pace — live CPT, sells out exactly on event date.
  if (requiredPerDay != null && liveCpt != null) {
    lines.push(
      buildLine(
        "required",
        "Required pace",
        requiredPerDay,
        liveCpt,
        ticketsSold,
        spent,
        capacity,
        D,
      ),
    );
  }

  // Suggested — benchmark CPT, sells out exactly on event date. This is
  // the only line available pre-launch (no live CPT yet).
  if (suggestedDaily != null) {
    lines.push(
      buildLine(
        "suggested",
        "Suggested (benchmark)",
        suggestedDaily,
        benchCpt,
        ticketsSold,
        spent,
        capacity,
        D,
      ),
    );
  }

  // Sellout crossing for the Current pace line.
  let sellout: SelloutMarker = { day: null, spend: null, date: null };
  if (campaignLive && input.spentPerDay != null && input.spentPerDay > 0 && liveCpt != null) {
    const daysToSellout = (ticketsRemaining * liveCpt) / input.spentPerDay;
    if (daysToSellout <= D + 1e-9) {
      sellout = {
        day: daysToSellout,
        spend: spent + input.spentPerDay * daysToSellout,
        date: addDaysIso(today, daysToSellout),
      };
    }
  }

  // Event-date marker x on the spend axis = spend needed to sell out by
  // event date. Prefer live CPT; fall back to benchmark pre-launch.
  const requiredTotalSpend =
    liveCpt != null && liveCpt > 0
      ? spent + ticketsRemaining * liveCpt
      : benchCpt > 0
        ? spent + ticketsRemaining * benchCpt
        : null;

  return {
    available: true,
    campaignLive,
    capacity,
    ticketsSold,
    ticketsRemaining,
    spent,
    allocated: input.allocated,
    daysToEvent: D,
    eventDate,
    lines,
    sellout,
    requiredTotalSpend,
    requiredPerDay,
    suggestedDaily,
    warning: input.warning,
    warningAmount: input.warningAmount,
  };
}
