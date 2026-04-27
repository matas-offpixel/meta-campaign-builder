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
  /** Number of rollup days that contributed non-null allocation.
   *  Used as a "has any allocation" flag by the venue table. */
  daysCovered: number;
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
    if (r.ad_spend_allocated == null) continue;
    const existing = out.get(r.event_id) ?? {
      specific: 0,
      genericShare: 0,
      allocated: 0,
      daysCovered: 0,
    };
    existing.allocated += r.ad_spend_allocated;
    existing.specific += r.ad_spend_specific ?? 0;
    existing.genericShare += r.ad_spend_generic_share ?? 0;
    existing.daysCovered += 1;
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
