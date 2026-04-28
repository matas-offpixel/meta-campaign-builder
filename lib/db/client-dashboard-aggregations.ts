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
  /**
   * Human-readable name — "Croatia vs Ghana", "WC26 Last 32 Leeds",
   * etc. Used by `sortEventsGroupStageFirst` for knockout detection
   * and by the venue table for row labels. Null is tolerated for
   * minimal fixtures / legacy rows but the sort just keeps such
   * rows in their input order.
   */
  name?: string | null;
  event_code: string | null;
  event_date: string | null;
  capacity: number | null;
  prereg_spend: number | null;
  tickets_sold: number | null;
  /**
   * Paid-media budget target for this event (events.budget_marketing).
   * Optional on the interface so legacy callers that didn't pass it
   * keep compiling; the aggregator treats absent as `null` (exclude
   * from the sum). Feeds the client topline's "Total Marketing
   * Budget" card.
   */
  budget_marketing?: number | null;
  latest_snapshot: {
    tickets_sold: number | null;
    revenue: number | null;
  } | null;
}

/** One `additional_spend_entries` row; only `event_id` + `amount` used. */
export interface AdditionalSpendRow {
  event_id: string;
  amount: number | null;
  scope?: "event" | "venue";
  venue_event_code?: string | null;
}

/**
 * Lifetime allocation totals for one event — sum of the three
 * allocation columns across every rollup day. Populated when at
 * least one rollup row for the event has `ad_spend_allocated`
 * non-null (i.e. the allocator has run for this venue).
 */
export interface EventAllocationLifetime {
  /** Opponent-matched spend for this event, lifetime. */
  specific: number;
  /** This event's share of the venue-wide generic pool, lifetime. */
  genericShare: number;
  /** specific + genericShare — what the venue card's Ad Spend
   *  column renders when allocation is available. */
  allocated: number;
  /**
   * This event's share of the venue's presale-campaign spend,
   * lifetime. Powers the PRE-REG column when the allocator has
   * run for this (event, day). Zero when the venue ran no
   * presale campaigns — distinct from NULL in the underlying
   * column, which means "allocator hasn't touched this row
   * yet". Callers treat zero the same as "no presale"; they use
   * the `daysCoveredPresale` flag below if they need to tell the
   * two apart.
   */
  presale: number;
  /** Number of rollup days that contributed non-null allocation.
   *  Used as a "has any allocation" flag by the venue table. */
  daysCovered: number;
  /** Number of rollup days that contributed a non-null presale
   *  value — lets callers tell "allocator ran, no presale" from
   *  "allocator hasn't run yet" at the event granularity. */
  daysCoveredPresale: number;
}

/**
 * Aggregate the per-event allocated spend columns out of the slim
 * rollup rows the portal loader exposes. Returns one entry per
 * event that has ANY non-null allocation row — events with only
 * null columns (either unallocated venues or pre-PR-D2 rows)
 * don't show up so callers can treat an absent key as "fall back
 * to the pre-allocation split model".
 */
export function aggregateAllocationByEvent(
  dailyRollups: DailyRollupRow[],
): Map<string, EventAllocationLifetime> {
  const out = new Map<string, EventAllocationLifetime>();
  for (const r of dailyRollups) {
    // Include rows where EITHER `ad_spend_allocated` OR
    // `ad_spend_presale` is non-null. Pre-PR-#120 rows only carried
    // the former; post-#120 a day with ONLY presale activity (no
    // on-sale ads live yet) still writes `ad_spend_presale` and
    // leaves `ad_spend_allocated` at zero. The aggregator needs
    // both branches so the PRE-REG column gets surfaced even for
    // pre-ticket-launch days.
    if (r.ad_spend_allocated == null && r.ad_spend_presale == null) {
      continue;
    }
    const existing = out.get(r.event_id) ?? {
      specific: 0,
      genericShare: 0,
      allocated: 0,
      presale: 0,
      daysCovered: 0,
      daysCoveredPresale: 0,
    };
    if (r.ad_spend_allocated != null) {
      existing.allocated += r.ad_spend_allocated;
      existing.specific += r.ad_spend_specific ?? 0;
      existing.genericShare += r.ad_spend_generic_share ?? 0;
      existing.daysCovered += 1;
    }
    if (r.ad_spend_presale != null) {
      existing.presale += r.ad_spend_presale;
      existing.daysCoveredPresale += 1;
    }
    out.set(r.event_id, existing);
  }
  return out;
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
   * Sum of `events.budget_marketing` across events with a non-null
   * budget. `null` when every event leaves the column unset so the
   * UI can render "—" instead of an implied £0 — distinguishes
   * "budget not configured" from "budget set to £0". Drives the
   * "Total Marketing Budget" topline card (PR 4).
   */
  marketingBudget: number | null;
  /**
   * Cumulative marketing cost to-date — paid media (adSpend +
   * preregSpend) plus every additional-spend row (event- AND
   * venue-scope). Differs from `totalSpend` only in naming today;
   * kept as a distinct field so the "Total Marketing Spend" topline
   * card reads from a clearly-named source even if `totalSpend`'s
   * semantics later diverge (e.g. excluding prereg).
   */
  marketingSpend: number;
  /**
   * Tickets sold — caller should pass events with
   * `ticket_sales_snapshots` already resolved into
   * `latest_snapshot.tickets_sold` / `tickets_sold`, then this sums
   * that display value. `events.tickets_sold` is only a fallback for
   * no-snapshot/manual-provider rows.
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
  const marketingSpend = totalSpend;
  const marketingBudget = aggregateSharedVenueBudget(events);
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
    marketingBudget,
    marketingSpend,
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

export interface VenueCampaignPerformance {
  paidMediaBudget: number | null;
  additionalSpend: number;
  totalMarketingBudget: number | null;
  paidMediaSpent: number;
  paidMediaRemaining: number | null;
  paidMediaUsedPct: number | null;
  dailyBudget: number | null;
  ticketsSold: number;
  capacity: number | null;
  sellThroughPct: number | null;
  costPerTicket: number | null;
  pacingTicketsPerDay: number | null;
  pacingSpendPerDay: number | null;
  earliestEventDate: string | null;
}

/**
 * WC26 venue budget rows are stored redundantly on every child match.
 * Treat `budget_marketing` as a venue-shared cap: one budget per
 * `event_code`, with solo/no-code events falling back to their own id.
 */
export function aggregateSharedVenueBudget(
  events: AggregatableEvent[],
): number | null {
  const byVenue = new Map<string, number>();
  for (const ev of events) {
    if (ev.budget_marketing == null) continue;
    const key = ev.event_code ? `code:${ev.event_code}` : `event:${ev.id}`;
    byVenue.set(key, Math.max(byVenue.get(key) ?? 0, ev.budget_marketing));
  }
  if (byVenue.size === 0) return null;
  let total = 0;
  for (const budget of byVenue.values()) total += budget;
  return total;
}

export function aggregateVenueCampaignPerformance(
  events: AggregatableEvent[],
  additionalSpend: AdditionalSpendRow[],
  dailyRollups: DailyRollupRow[],
  todayIso = new Date().toISOString().slice(0, 10),
  paidMediaSpentOverride?: number | null,
  dailyBudgetOverride?: number | null,
): VenueCampaignPerformance {
  const eventIds = new Set(events.map((e) => e.id));
  const eventCodes = new Set(
    events.map((e) => e.event_code).filter((c): c is string => Boolean(c)),
  );

  let tickets = 0;
  let capacity = 0;
  let hasCapacity = false;
  let earliestEventDate: string | null = null;

  for (const ev of events) {
    tickets += ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
    if (ev.capacity != null) {
      capacity += ev.capacity;
      hasCapacity = true;
    }
    if (
      ev.event_date &&
      isUpcomingOrToday(ev.event_date, todayIso) &&
      (!earliestEventDate || ev.event_date < earliestEventDate)
    ) {
      earliestEventDate = ev.event_date;
    }
  }

  let additional = 0;
  for (const row of additionalSpend) {
    if (row.amount == null) continue;
    const scope = row.scope ?? "event";
    if (scope === "venue") {
      if (row.venue_event_code && eventCodes.has(row.venue_event_code)) {
        additional += row.amount;
      }
    } else if (eventIds.has(row.event_id)) {
      additional += row.amount;
    }
  }

  let paidSpent = paidMediaSpentOverride ?? null;
  if (paidSpent == null) {
    paidSpent = 0;
    for (const row of dailyRollups) {
      if (!eventIds.has(row.event_id)) continue;
      const spend = row.ad_spend_allocated ?? row.ad_spend;
      if (spend != null) paidSpent += spend;
    }
  }

  const paidMediaBudget = aggregateSharedVenueBudget(events);
  const totalMarketingBudget =
    paidMediaBudget != null || additional > 0
      ? (paidMediaBudget ?? 0) + additional
      : null;
  const paidMediaRemaining =
    paidMediaBudget != null ? Math.max(0, paidMediaBudget - paidSpent) : null;
  const paidMediaUsedPct =
    paidMediaBudget != null && paidMediaBudget > 0
      ? (paidSpent / paidMediaBudget) * 100
      : null;
  const capacityOut = hasCapacity ? capacity : null;
  const sellThroughPct =
    capacityOut != null && capacityOut > 0 ? (tickets / capacityOut) * 100 : null;
  const costPerTicket = tickets > 0 && paidSpent > 0 ? paidSpent / tickets : null;
  const remainingTickets =
    capacityOut != null ? Math.max(0, capacityOut - tickets) : null;
  const daysUntil = daysUntilUpcomingDate(earliestEventDate, todayIso);
  const pacingTicketsPerDay =
    remainingTickets != null && remainingTickets > 0 && daysUntil != null
      ? Math.round(remainingTickets / Math.max(daysUntil, 1))
      : null;
  const pacingSpendPerDay =
    paidMediaRemaining != null && paidMediaRemaining > 0 && daysUntil != null
      ? Math.round(paidMediaRemaining / Math.max(daysUntil, 1))
      : null;

  return {
    paidMediaBudget,
    additionalSpend: additional,
    totalMarketingBudget,
    paidMediaSpent: paidSpent,
    paidMediaRemaining,
    paidMediaUsedPct,
    dailyBudget: dailyBudgetOverride ?? null,
    ticketsSold: tickets,
    capacity: capacityOut,
    sellThroughPct,
    costPerTicket,
    pacingTicketsPerDay,
    pacingSpendPerDay,
    earliestEventDate,
  };
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

function daysUntilDate(dateIso: string | null, todayIso: string): number | null {
  if (!dateIso) return null;
  const eventMs = Date.parse(`${dateIso}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(eventMs) || !Number.isFinite(todayMs)) return null;
  const days = Math.ceil((eventMs - todayMs) / 86_400_000);
  return days > 0 ? days : 1;
}

function isUpcomingOrToday(dateIso: string, todayIso: string): boolean {
  const eventMs = Date.parse(`${dateIso}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(eventMs) || !Number.isFinite(todayMs)) return false;
  return eventMs >= todayMs;
}

function daysUntilUpcomingDate(
  dateIso: string | null,
  todayIso: string,
): number | null {
  if (!dateIso) return null;
  const eventMs = Date.parse(`${dateIso}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(eventMs) || !Number.isFinite(todayMs)) return null;
  if (eventMs < todayMs) return null;
  return Math.max(1, Math.ceil((eventMs - todayMs) / 86_400_000));
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return NaN;
  return (da - db) / 86_400_000;
}

// ─── Week-over-week deltas ─────────────────────────────────────────────────

/**
 * One half of the WoW pair — either Tickets or CPT. Values are null
 * when the underlying window had no qualifying data (either no
 * rollup rows or zero tickets / spend, per the column's semantics).
 * The venue header renders "—" for any null half rather than
 * pretending the comparison is meaningful.
 */
export interface WoWDelta {
  /** Current edge value as of `todayIso`. */
  current: number | null;
  /** Prior edge value as of seven days before `todayIso`. */
  previous: number | null;
  /** `current - previous`; null when either side is null. */
  delta: number | null;
  /** `delta / previous * 100`; null when previous is 0 / null. */
  deltaPct: number | null;
}

export interface VenueWoWTotals {
  tickets: WoWDelta;
  /**
   * Cost-per-ticket — cumulative venue spend / cumulative venue
   * tickets now, compared with the same cumulative ratio seven days
   * ago. Nullable halves when either edge is missing or denominator
   * is zero, so the header shows "(—)" rather than an incremental
   * period value that disagrees with the expanded Total row.
   *
   * Intentionally ignores `additional_spend_entries` because the
   * additional-spend table isn't date-bucketed (it carries only an
   * event_id + amount today). Uses allocated rollup spend when
   * available so multi-event venue totals match the expanded table.
   */
  cpt: WoWDelta;
  /** ROAS — cumulative venue revenue / cumulative venue spend, current
   * edge vs seven-days-ago edge. */
  roas: WoWDelta;
}

const ZERO_DELTA: WoWDelta = {
  current: null,
  previous: null,
  delta: null,
  deltaPct: null,
};
const EMPTY_VENUE_WOW: VenueWoWTotals = {
  tickets: ZERO_DELTA,
  cpt: ZERO_DELTA,
  roas: ZERO_DELTA,
};

/**
 * Minimal weekly-snapshot row shape accepted by `aggregateVenueWoW`.
 * Matches `WeeklyTicketSnapshotRow` from `client-portal-server.ts`
 * but locally-typed so the aggregation helpers don't drag the
 * server types into the client bundle.
 */
export interface WeeklyTicketSnapshotLite {
  event_id: string;
  /** `YYYY-MM-DD` (UTC). */
  snapshot_at: string;
  /** Cumulative tickets sold as of this snapshot. */
  tickets_sold: number;
  /** Only used by the normalisation helper; the aggregator ignores
   *  source because weeklyTicketSnapshots are passed through
   *  `collapseWeekly`'s dominant-source pass upstream. */
  source?: string;
}

/**
 * Deterministic WoW (today vs 7 days ago) for a single venue group.
 *
 * ## Tickets
 *
 * Ticket counts are *cumulative* quantities — the number the client
 * sees ("Tickets: 1,091") is the running total, not a per-week
 * increment. Comparing two week-long *windows* of incremental daily
 * rollups (PR #119's original approach) produced two incremental
 * sums, which the parenthetical then read as "cumulative today vs
 * cumulative last week" and rendered negative deltas on events that
 * genuinely only grew (Leeds FA Cup SF showed -692 tickets when
 * sales had never dropped). The cumulative vs incremental mismatch
 * was the real bug.
 *
 * The aggregator now compares:
 *   - `current`  = sum of the latest ticket_sales_snapshots row in
 *                  the current window, falling back to the event's
 *                  resolved display tickets
 *   - `previous` = sum of each event's cumulative count 7 days ago,
 *                  preferring the weekly snapshot with
 *                  `snapshot_at` closest to and ≤ today-7, and
 *                  falling back to `current − Σ(daily rollup
 *                  tickets_sold in last 7 days)` when no weekly
 *                  snapshot is available before the window edge.
 *
 * Delta (`current − previous`) is therefore "tickets gained in the
 * last 7 days". A negative delta only renders when the data itself
 * regressed (a legitimate data-quality signal, not a UI bug).
 *
 * ## CPT
 *
 * CPT matches the expanded Total row semantics: current cumulative
 * spend / current cumulative tickets, versus the SAME current spend
 * divided by the previous ticket edge. That freezes spend at the
 * displayed Total row value so collapsed and expanded views agree.
 *
 * ROAS currently freezes both spend and revenue at the current edge,
 * matching the chosen "expanded view is canonical" rule. That means
 * its WoW delta is usually zero; if we want a more expressive ROAS
 * comparison later, it should be designed as a separate follow-up.
 *
 * ## Windowing
 *
 * `todayIso` is injected so SSR renders and tests don't drift with
 * wall-clock time. The current window is inclusive of `todayIso`
 * (i.e. last 7 days ending today); the prior window is the 7 days
 * before that.
 *
 * `weeklyTicketSnapshots` is optional for backwards compatibility —
 * callers that haven't threaded the table in fall back to the
 * rollup-derived previous cumulative. Tests at
 * `lib/db/__tests__/client-dashboard-aggregations.test.ts` cover
 * both code paths.
 */
export function aggregateVenueWoW(
  events: AggregatableEvent[],
  dailyRollups: DailyRollupRow[],
  todayIso: string,
  weeklyTicketSnapshots?: WeeklyTicketSnapshotLite[],
): VenueWoWTotals {
  const eventIds = new Set(events.map((e) => e.id));
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(todayMs) || eventIds.size === 0) {
    return EMPTY_VENUE_WOW;
  }
  const currStart = todayMs - 6 * 86_400_000;
  const windowEdgeMs = todayMs - 7 * 86_400_000;

  // ── Current cumulative tickets (main number source of truth). ──
  let currentCumulativeTickets = 0;
  let hasAnyCumulative = false;
  const currentTicketsByEvent = new Map<string, number>();
  const currentWindowTicketsByEvent = new Map<string, number>();
  for (const e of events) {
    const v =
      findLatestSnapshotInWindow(
        weeklyTicketSnapshots ?? [],
        e.id,
        windowEdgeMs,
        todayMs,
      ) ??
      e.latest_snapshot?.tickets_sold ??
      e.tickets_sold ??
      null;
    if (v != null) {
      currentCumulativeTickets += v;
      currentTicketsByEvent.set(e.id, v);
      hasAnyCumulative = true;
    }
  }

  // ── Daily rollup edges (spend/revenue cumulative + ticket fallback). ──
  let currentSpend = 0;
  let currentRevenue = 0;
  let currentRevenueRows = 0;

  for (const r of dailyRollups) {
    if (!eventIds.has(r.event_id)) continue;
    const ms = Date.parse(`${r.date}T00:00:00Z`);
    if (!Number.isFinite(ms)) continue;
    const spend = r.ad_spend_allocated ?? r.ad_spend;
    if (ms <= todayMs) {
      if (spend != null) {
        currentSpend += spend;
      }
      if (r.revenue != null) {
        currentRevenue += r.revenue;
        currentRevenueRows += 1;
      }
    }
    if (ms >= currStart && ms <= todayMs) {
      // Clamp negative rollup values — a legitimate per-day
      // increment is ≥0. A negative here means the rollup row
      // was written with contaminated data; summing it would
      // inflate the previous-cumulative estimate.
      if (r.tickets_sold != null) {
        const tickets = Math.max(0, r.tickets_sold);
        currentWindowTicketsByEvent.set(
          r.event_id,
          (currentWindowTicketsByEvent.get(r.event_id) ?? 0) + tickets,
        );
      }
    }
  }

  // ── Previous cumulative tickets. ──
  //
  // Preferred path: find each event's weekly snapshot at ≤ today-7
  // and sum across the group. Matches the operator's mental model
  // of "where were we last week".
  //
  // Fallback: current cumulative − rollup tickets summed over the
  // last 7 days. Works when the rollup column is well-behaved per-
  // day incremental; gracefully degrades to null when neither
  // source is usable so the parenthetical hides rather than
  // misleading.
  let previousCumulativeTickets: number | null = null;
  if (hasAnyCumulative) {
    let sum = 0;
    let allResolved = true;
    for (const e of events) {
      const current = currentTicketsByEvent.get(e.id);
      if (current == null) continue;
      const latestBefore =
        weeklyTicketSnapshots && weeklyTicketSnapshots.length > 0
          ? findLatestSnapshotAtOrBefore(weeklyTicketSnapshots, e.id, windowEdgeMs)
          : null;
      const fromRollups =
        latestBefore == null && currentWindowTicketsByEvent.has(e.id)
          ? Math.max(0, current - (currentWindowTicketsByEvent.get(e.id) ?? 0))
          : null;
      const previous = latestBefore ?? fromRollups ?? (current === 0 ? 0 : null);
      if (previous == null) {
        allResolved = false;
        break;
      }
      sum += previous;
    }
    if (allResolved) previousCumulativeTickets = sum;
  }

  // Monotonic guard: cumulative tickets don't regress in the real
  // world. When the derived `previous` exceeds `current`, something
  // upstream corrupted the rollup column (a cumulative value
  // written in where an incremental was expected, a source
  // switch mid-week, etc). Suppress the delta rather than render
  // a misleading negative. `console.warn` so the regression surfaces
  // in Vercel logs for operator diagnosis.
  if (
    previousCumulativeTickets != null &&
    previousCumulativeTickets > currentCumulativeTickets
  ) {
    console.warn(
      `[venue-wow] cumulative regression — current=${currentCumulativeTickets} ` +
        `previous=${previousCumulativeTickets} eventIds=${JSON.stringify(
          Array.from(eventIds),
        )} today=${todayIso} — suppressing delta`,
    );
    previousCumulativeTickets = null;
  }

  const hasDeltaBase =
    hasAnyCumulative && previousCumulativeTickets != null;
  const tickets: WoWDelta = buildHalf(
    hasAnyCumulative ? currentCumulativeTickets : null,
    previousCumulativeTickets,
    hasDeltaBase,
  );

  // ── Frozen-spend CPT / ROAS comparison. ──
  //
  // These must match the expanded Total row semantics: current spend
  // frozen across both ticket edges, not last-7-day incrementals and
  // not cumulative spend as-of the previous edge.
  const currCpt =
    currentCumulativeTickets > 0 && currentSpend > 0
      ? currentSpend / currentCumulativeTickets
      : null;
  const prevCpt =
    previousCumulativeTickets != null &&
    previousCumulativeTickets > 0 &&
    currentSpend > 0
      ? currentSpend / previousCumulativeTickets
      : null;
  const cpt: WoWDelta = buildHalf(
    currCpt,
    prevCpt,
    currCpt != null && prevCpt != null,
  );

  const currRoas =
    currentSpend > 0 && currentRevenueRows > 0
      ? currentRevenue / currentSpend
      : null;
  const prevRoas =
    currRoas != null
      ? currRoas
      : null;
  const roas: WoWDelta = buildHalf(
    currRoas,
    prevRoas,
    currRoas != null && prevRoas != null,
  );

  return { tickets, cpt, roas };
}

/**
 * Helper for `aggregateVenueWoW` — walks `weeklyTicketSnapshots`
 * for one event and returns the cumulative tickets count of the
 * latest snapshot at-or-before `windowEdgeMs`. Returns null when
 * no qualifying snapshot exists for that event.
 *
 * Expects the incoming snapshots to already be source-normalised
 * (see `collapseWeekly` / `collapseWeeklyNormalizedPerEvent`).
 * Mixing sources here would produce phantom regressions — the
 * upstream normalisation is the safer place to enforce single-
 * source consistency per event.
 */
function findLatestSnapshotAtOrBefore(
  rows: readonly WeeklyTicketSnapshotLite[],
  eventId: string,
  windowEdgeMs: number,
): number | null {
  let bestMs = -Infinity;
  let bestTickets: number | null = null;
  for (const r of rows) {
    if (r.event_id !== eventId) continue;
    const ms = Date.parse(`${r.snapshot_at}T00:00:00Z`);
    if (!Number.isFinite(ms)) continue;
    if (ms > windowEdgeMs) continue;
    if (ms > bestMs) {
      bestMs = ms;
      bestTickets = r.tickets_sold;
    }
  }
  return bestTickets;
}

function findLatestSnapshotInWindow(
  rows: readonly WeeklyTicketSnapshotLite[],
  eventId: string,
  startExclusiveMs: number,
  endInclusiveMs: number,
): number | null {
  let bestMs = -Infinity;
  let bestTickets: number | null = null;
  for (const r of rows) {
    if (r.event_id !== eventId) continue;
    const ms = Date.parse(`${r.snapshot_at}T00:00:00Z`);
    if (!Number.isFinite(ms)) continue;
    if (ms <= startExclusiveMs || ms > endInclusiveMs) continue;
    if (ms > bestMs) {
      bestMs = ms;
      bestTickets = r.tickets_sold;
    }
  }
  return bestTickets;
}

function buildHalf(
  current: number | null,
  previous: number | null,
  canCompare: boolean,
): WoWDelta {
  if (!canCompare || current == null || previous == null) {
    return { current, previous, delta: null, deltaPct: null };
  }
  const delta = current - previous;
  const deltaPct = previous !== 0 ? (delta / previous) * 100 : null;
  return { current, previous, delta, deltaPct };
}

// ─── Event ordering ────────────────────────────────────────────────────────

/**
 * Knockout-stage substrings matched case-insensitively against
 * `event.name`. Substring match (not word boundary) deliberately —
 * "Last 32", "last-32", "LAST32" all land on the same bucket.
 *
 * Order is irrelevant for the match; the first hit wins.
 */
const KNOCKOUT_MARKERS = [
  "last 32",
  "last 16",
  "round of 16",
  "quarter",
  "semi",
  "final",
  "knockout",
] as const;

/**
 * Normalise a name for knockout-stage detection. Lowercases +
 * collapses hyphens / underscores to spaces + flattens runs of
 * whitespace, so "Last-32", "LAST_32" and "Last  32" all match
 * the canonical "last 32" marker.
 */
function normaliseNameForStageMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the event name looks like a knockout-stage match.
 * Defensive against null / undefined names (minimal fixtures).
 * Exported so the sort comparator is testable in isolation.
 */
export function isKnockoutStage(name: string | null | undefined): boolean {
  if (!name) return false;
  const normalised = normaliseNameForStageMatch(name);
  return KNOCKOUT_MARKERS.some((m) => normalised.includes(m));
}

/**
 * Sort comparator key:
 *   1. Group stage first (0), knockout last (1)
 *   2. Within group stage → alphabetical by name (locale-aware
 *      en-GB, numeric so "Match 10" > "Match 2")
 *   3. Within knockout → ordering by the marker's position in
 *      `KNOCKOUT_MARKERS` (Last 32 → Last 16 → QF → SF → Final)
 *      so a card with all four stages reads as the bracket does
 *   4. Stable — equal keys fall back to the input index via `map/sort
 *      with explicit indices` in the wrapper below.
 */
function knockoutOrdinal(name: string | null | undefined): number {
  if (!name) return Number.POSITIVE_INFINITY;
  const normalised = normaliseNameForStageMatch(name);
  for (let i = 0; i < KNOCKOUT_MARKERS.length; i++) {
    if (normalised.includes(KNOCKOUT_MARKERS[i])) return i;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Sort events so group-stage matches come first (alphabetical by
 * name) and knockout-stage matches come last (ordered Last 32 → Last
 * 16 → QF → SF → Final). Pure, stable, null-tolerant.
 *
 * Used by `ClientPortalVenueTable` when laying out the rows inside
 * each venue card so every card reads the same way — the user-
 * reported bug was cards rendering "Last 32" sometimes on top and
 * sometimes at the bottom depending on string ordering / event id.
 *
 * Returns a new array — does not mutate the input.
 */
export function sortEventsGroupStageFirst<T extends AggregatableEvent>(
  events: readonly T[],
): T[] {
  // Decorate-sort-undecorate so the comparator can be cheap (no
  // repeated `.toLowerCase()`) and stability comes from carrying
  // the original index through.
  const decorated = events.map((ev, i) => ({
    ev,
    i,
    isKnockout: isKnockoutStage(ev.name),
    ko: knockoutOrdinal(ev.name),
  }));
  decorated.sort((a, b) => {
    if (a.isKnockout !== b.isKnockout) return a.isKnockout ? 1 : -1;
    if (a.isKnockout) {
      // Knockout bucket — bracket position drives order; equal
      // positions fall through to name / index for determinism.
      if (a.ko !== b.ko) return a.ko - b.ko;
    }
    // Group bucket + knockout tie-breaker: alphabetical by name.
    const an = a.ev.name ?? "";
    const bn = b.ev.name ?? "";
    const byName = an.localeCompare(bn, "en-GB", {
      numeric: true,
      sensitivity: "base",
    });
    if (byName !== 0) return byName;
    return a.i - b.i;
  });
  return decorated.map((d) => d.ev);
}
