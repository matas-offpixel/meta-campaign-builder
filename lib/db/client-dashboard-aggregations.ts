/**
 * lib/db/client-dashboard-aggregations.ts
 *
 * Pure aggregation helpers for the client-wide dashboard surface
 * rendered by `/share/client/[token]` (external) and
 * `/clients/[id]/dashboard` (internal).
 *
 * Separated from `client-portal-server.ts` so the arithmetic is
 * unit-testable without Supabase / Next.js plumbing. No I/O here —
 * every helper takes pre-loaded row arrays and returns totals.
 *
 * Reconciliation rule: the topline totals must equal the sum of the
 * per-venue-group totals. Both flow through identical arithmetic
 * fed by the same underlying row arrays; any divergence is a bug.
 */
import type { DailyRollupRow } from "./client-portal-server";

/** Minimal event shape the aggregators need — a subset of PortalEvent. */
export interface AggregatableEvent {
  id: string;
  event_code: string | null;
  event_date: string | null;
  capacity: number | null;
  prereg_spend: number | null;
  tickets_sold: number | null;
  latest_snapshot: {
    tickets_sold: number | null;
    revenue: number | null;
  } | null;
}

/** One `additional_spend_entries` row; only `event_id` + `amount` used. */
export interface AdditionalSpendRow {
  event_id: string;
  amount: number | null;
}

export interface ClientWideTotals {
  /** Distinct venue groups after (event_code, event_date) grouping. */
  venueGroups: number;
  /** Number of individual events (children across groups). */
  events: number;
  /** Sum of capacities; null when every event's capacity is null. */
  capacity: number | null;
  /** Sum of `event_daily_rollups.ad_spend` across all events. */
  adSpend: number;
  /** Sum of `additional_spend_entries.amount` across all events. */
  additionalSpend: number;
  /**
   * Sum of `events.prereg_spend` across all events. Surfaced in the
   * sub-line as "Pre-reg: £P".
   */
  preregSpend: number;
  /**
   * Total marketing spend = adSpend + additionalSpend + preregSpend.
   * ROAS denominator stays `adSpend` (paid-media-driven) per the
   * brief; this figure is the operator-facing "Total Spend" stat.
   */
  totalSpend: number;
  /**
   * Tickets sold — prefers `latest_snapshot.tickets_sold` then
   * `events.tickets_sold` then 0 per event. Matches the per-card
   * rollup the portal already shows.
   */
  ticketsSold: number;
  /**
   * Ticket revenue — sum of `latest_snapshot.revenue` across events
   * that have a snapshot with a non-null revenue. `null` when no
   * event has reported revenue yet so the UI can render "—" rather
   * than an implied £0.
   */
  ticketRevenue: number | null;
  /** ticketRevenue / adSpend. `null` when either input is unusable. */
  roas: number | null;
  /** totalSpend / ticketsSold. `null` when tickets sold is 0. */
  cpt: number | null;
  /**
   * ticketsSold / capacity, expressed as a 0..100 percentage.
   * `null` when capacity is null or zero so the UI can say "no
   * capacity configured yet" instead of a meaningless %.
   */
  sellThroughPct: number | null;
}

/**
 * Compute the client-wide topline totals. Pure.
 *
 * The `events` array should already exclude synthetic rows (e.g.
 * WC26-LONDON-ONSALE shared-campaign placeholders). The caller can
 * pass `londonOnsaleSpend` to include the shared-campaign spend in
 * `adSpend` / `totalSpend` when the client uses that model.
 */
export function aggregateClientWideTotals(
  events: AggregatableEvent[],
  dailyRollups: DailyRollupRow[],
  additionalSpend: AdditionalSpendRow[],
  extraAdSpend = 0,
): ClientWideTotals {
  const eventIds = new Set(events.map((e) => e.id));

  // Sum across allowed events only — guards against stray rows that
  // belong to a different client slipping into the arrays.
  let adSpend = 0;
  for (const r of dailyRollups) {
    if (!eventIds.has(r.event_id)) continue;
    if (r.ad_spend != null) adSpend += r.ad_spend;
  }
  adSpend += extraAdSpend;

  let additional = 0;
  for (const a of additionalSpend) {
    if (!eventIds.has(a.event_id)) continue;
    if (a.amount != null) additional += a.amount;
  }

  let prereg = 0;
  let ticketsSold = 0;
  let capacity = 0;
  let capacityAnyNonNull = false;
  let revenue = 0;
  let hasRevenue = false;
  const groupKeys = new Set<string>();
  for (const ev of events) {
    prereg += ev.prereg_spend ?? 0;
    ticketsSold +=
      ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
    if (ev.capacity != null) {
      capacity += ev.capacity;
      capacityAnyNonNull = true;
    }
    const r = ev.latest_snapshot?.revenue;
    if (r != null) {
      hasRevenue = true;
      revenue += r;
    }
    const gk = groupKey(ev);
    groupKeys.add(gk);
  }

  const totalSpend = adSpend + additional + prereg;
  const ticketRevenue = hasRevenue ? revenue : null;
  const roas =
    ticketRevenue != null && adSpend > 0 ? ticketRevenue / adSpend : null;
  const cpt = ticketsSold > 0 && totalSpend > 0 ? totalSpend / ticketsSold : null;
  const capacityOut = capacityAnyNonNull ? capacity : null;
  const sellThroughPct =
    capacityOut != null && capacityOut > 0
      ? (ticketsSold / capacityOut) * 100
      : null;

  return {
    venueGroups: groupKeys.size,
    events: events.length,
    capacity: capacityOut,
    adSpend,
    additionalSpend: additional,
    preregSpend: prereg,
    totalSpend,
    ticketsSold,
    ticketRevenue,
    roas,
    cpt,
    sellThroughPct,
  };
}

/**
 * Grouping key used to count venue groups in the topline. Mirrors
 * `lib/dashboard/rollout-grouping.ts`'s `groupKey` so the counts the
 * topline shows ("N venues") match the card count rendered below.
 */
function groupKey(ev: {
  id: string;
  event_code: string | null;
  event_date: string | null;
}): string {
  if (!ev.event_code) return `__solo__::${ev.id}`;
  return `${ev.event_code}::${ev.event_date ?? ""}`;
}

export interface VenueGroupTotals {
  adSpend: number;
  additionalSpend: number;
  preregSpend: number;
  totalSpend: number;
  ticketsSold: number;
  capacity: number | null;
  ticketRevenue: number | null;
  roas: number | null;
  cpt: number | null;
  sellThroughPct: number | null;
  /**
   * Score used to pick which groups to auto-expand on first render.
   * Higher = more "active". Current heuristic: ad spend + recency
   * bonus. Deterministic so SSR + CSR don't disagree.
   */
  activityScore: number;
}

/**
 * Per-venue-group aggregation. Expects `events` to be the children
 * of one group (shared event_code + event_date), already filtered by
 * the caller. Pure — filters rollup / additional-spend arrays by the
 * group's event ids.
 *
 * `todayIso` lets the caller inject a clock for the recency bonus in
 * `activityScore` so the function stays deterministic under test.
 */
export function aggregateVenueGroupTotals(
  events: AggregatableEvent[],
  dailyRollups: DailyRollupRow[],
  additionalSpend: AdditionalSpendRow[],
  todayIso: string,
): VenueGroupTotals {
  const eventIds = new Set(events.map((e) => e.id));

  let adSpend = 0;
  for (const r of dailyRollups) {
    if (!eventIds.has(r.event_id)) continue;
    if (r.ad_spend != null) adSpend += r.ad_spend;
  }

  let additional = 0;
  for (const a of additionalSpend) {
    if (!eventIds.has(a.event_id)) continue;
    if (a.amount != null) additional += a.amount;
  }

  let prereg = 0;
  let ticketsSold = 0;
  let capacity = 0;
  let capacityAnyNonNull = false;
  let revenue = 0;
  let hasRevenue = false;
  for (const ev of events) {
    prereg += ev.prereg_spend ?? 0;
    ticketsSold += ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
    if (ev.capacity != null) {
      capacity += ev.capacity;
      capacityAnyNonNull = true;
    }
    const r = ev.latest_snapshot?.revenue;
    if (r != null) {
      hasRevenue = true;
      revenue += r;
    }
  }

  const totalSpend = adSpend + additional + prereg;
  const ticketRevenue = hasRevenue ? revenue : null;
  const roas =
    ticketRevenue != null && adSpend > 0 ? ticketRevenue / adSpend : null;
  const cpt = ticketsSold > 0 && totalSpend > 0 ? totalSpend / ticketsSold : null;
  const capacityOut = capacityAnyNonNull ? capacity : null;
  const sellThroughPct =
    capacityOut != null && capacityOut > 0
      ? (ticketsSold / capacityOut) * 100
      : null;

  // Activity score: heuristic for auto-expanding the "most active"
  // cards. Weights:
  //   - ad_spend (direct signal of "money is flowing here")
  //   - recency bonus (past-dated events score lower; upcoming or
  //     very recent score higher) clipped to a 60-day window
  //
  // Deterministic for a given todayIso, so SSR can compute this the
  // same way the client would.
  let recencyBonus = 0;
  const firstDate = firstEventDate(events);
  if (firstDate) {
    const daysAway = daysBetween(firstDate, todayIso);
    if (Number.isFinite(daysAway)) {
      // Peak score at |daysAway|=0 (happening today), decaying out
      // to 0 at ±60 days. Past events decay the same way, which is
      // fine — an event that ended last week is still "more active"
      // than one from six months ago.
      const normalized = 1 - Math.min(Math.abs(daysAway), 60) / 60;
      // Scale the bonus so a busy upcoming event can outrank a past
      // event with a similar ad_spend. Value picked empirically.
      recencyBonus = normalized * 500;
    }
  }

  const activityScore = adSpend + additional + recencyBonus;

  return {
    adSpend,
    additionalSpend: additional,
    preregSpend: prereg,
    totalSpend,
    ticketsSold,
    capacity: capacityOut,
    ticketRevenue,
    roas,
    cpt,
    sellThroughPct,
    activityScore,
  };
}

function firstEventDate(events: AggregatableEvent[]): string | null {
  for (const ev of events) {
    if (ev.event_date) return ev.event_date;
  }
  return null;
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return NaN;
  return (da - db) / 86_400_000;
}
