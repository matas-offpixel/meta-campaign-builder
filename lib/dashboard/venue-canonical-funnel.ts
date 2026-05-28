/**
 * lib/dashboard/venue-canonical-funnel.ts
 *
 * Single source of truth for venue-scope funnel-pacing numbers.
 *
 * Built for PR-B of the funnel-pacing convergence arc (issue #467,
 * builds on #468 + #472). Both the Performance tab's `VenueStatsGrid`
 * (Reach / Clicks / LPV tiles) and the Funnel Pacing tab's bars read
 * their numerators from this struct. The page-level passes identical
 * inputs to both render branches so the surfaces literally cannot
 * disagree — there is no "second wiring decision".
 *
 * **Pure compute layer.** No DB / network / `server-only`. Tests run
 * directly on this file; the supabase-backed convenience wrapper lives
 * alongside `loadVenuePortalByCode` and reads the same fields the
 * `VenueFullReport` already consumes.
 *
 * **Sources of truth (per #467 design, locked by Matas):**
 *
 *   - Reach   → `event_code_lifetime_meta_cache.meta_reach`
 *               (unique-people cross-campaign dedup, never SUM)
 *   - Clicks  → `event_code_lifetime_meta_cache.meta_link_clicks`
 *               (lifetime cache for parity with Reach; rollup SUM
 *               also correct post-#472 but we prefer cache so a
 *               late writer can't drift the two surfaces)
 *   - LPV     → `event_code_lifetime_meta_cache.meta_landing_page_views`
 *               (migration 099, PR-A of #467)
 *   - Purchases → SUM(`events.tickets_sold`) across the venue's events.
 *               Matches Performance Summary's headline count. NOT
 *               `tier_channel_sales` (tier-breakdown SUM, diverges by ~9%
 *               on Edinburgh) and NOT `event_daily_rollups.meta_purchases`
 *               (Meta attribution claim, not ticketing fact).
 *   - Spend   → SUM(`event_daily_rollups.ad_spend_allocated` ??
 *               `event_daily_rollups.ad_spend`, +`ad_spend_presale`).
 *               Per-fixture allocator handles the venue split.
 *   - Capacity → SUM(`events.capacity`) across the venue's events.
 *
 * **Targets (capacity-derived per 14/50/5 benchmarks):**
 *
 *   - Reach target     = capacity / (0.14 × 0.5 × 0.05)  ≈ capacity × 285.71
 *   - Clicks target    = capacity / (0.5 × 0.05)         = capacity × 40
 *   - LPV target       = capacity / 0.05                 = capacity × 20
 *   - Purchases target = capacity × 1
 *
 *   Multipliers are derived from the benchmark rates (not hard-coded)
 *   so changing the rates here automatically retargets every stage.
 *   Edinburgh capacity 5,475 → reach target = 1,564,286 (rounded).
 *
 * **Status (conversion-rate-vs-benchmark):**
 *
 *   - Reach     ON_TRACK when (clicks / reach)     ≥ 14% benchmark
 *   - Clicks    ON_TRACK when (lpv / clicks)       ≥ 50% benchmark
 *   - LPV       ON_TRACK when (purchases / lpv)    ≥  5% benchmark
 *   - Purchases ON_TRACK by default (the funnel is the gating signal).
 *               The backward-read `underPacing` flag is surfaced as a
 *               SEPARATE warning banner in the BackwardReadCard so
 *               the Purchases bar doesn't double-count the funnel
 *               health signal. Edinburgh case: 64% of capacity, all
 *               three upstream stages at benchmark → ON_TRACK.
 *
 *   The previous % -of-target status (`< 80% red, < 100% amber,
 *   ≥ 100% green`) is replaced for the venue scope — pacing-pct of
 *   capacity-× -286 is not actionable; conversion-rate-vs-benchmark
 *   tells you which funnel stage is the bottleneck.
 */

import type { DailyRollupRow } from "../db/client-portal-server.ts";
import type { EventCodeLifetimeMetaCacheRow } from "../db/event-code-lifetime-meta-cache.ts";

/**
 * Industry benchmark conversion rates for an event-marketing funnel
 * (4theFans dataset, locked by Matas for issue #467).
 *
 * Capacity multipliers are derived inline below from these rates so
 * any future change to a rate retargets every stage automatically.
 *
 * Benchmark CPC of £0.12 × 40 clicks/ticket = £4.80 benchmark CPT,
 * matching the existing `FALLBACK_FUNNEL_TARGETS.bofu_target_cpa: 4`
 * within rounding.
 */
export const FUNNEL_BENCHMARKS = {
  reachToClick: 0.14,
  clickToLpv: 0.5,
  lpvToTicket: 0.05,
  benchmarkCostPerTicket: 4.8,
} as const;

/** Reach needed per 1 ticket at benchmark = 1 / (0.14 × 0.5 × 0.05) ≈ 285.71. */
export const REACH_PER_TICKET_BENCHMARK =
  1 /
  (FUNNEL_BENCHMARKS.reachToClick *
    FUNNEL_BENCHMARKS.clickToLpv *
    FUNNEL_BENCHMARKS.lpvToTicket);

/** Clicks needed per 1 ticket at benchmark = 1 / (0.5 × 0.05) = 40. */
export const CLICKS_PER_TICKET_BENCHMARK =
  1 / (FUNNEL_BENCHMARKS.clickToLpv * FUNNEL_BENCHMARKS.lpvToTicket);

/** LPV needed per 1 ticket at benchmark = 1 / 0.05 = 20. */
export const LPV_PER_TICKET_BENCHMARK = 1 / FUNNEL_BENCHMARKS.lpvToTicket;

export type StageKey = "reach" | "clicks" | "lpv" | "purchases";
export type StageStatus = "on_track" | "off_track" | "unknown";
export type MetricSource =
  | "lifetime_cache"
  | "cache_miss"
  | "tier_channel_sales"
  | "events_table"
  | "rollups";

export interface VenueCanonicalFunnelStage {
  key: StageKey;
  label: string;
  description: string;
  metricLabel: string;
  /** Numerator. `null` only for `reach`/`clicks`/`lpv` on cache miss. */
  actual: number | null;
  /** Denominator. Always a number (capacity × multiplier). */
  target: number;
  /** `actual / target` as a percentage in `[0, +inf)`. `null` on actual=null. */
  pacingPct: number | null;
  /**
   * Conversion rate from THIS stage to the NEXT (e.g. for `reach`,
   * `clicks/reach`). The benchmark for the same edge lives in
   * `conversionBenchmark`. For `purchases` (the terminal stage) both
   * are `null` — its status comes from the backward read instead.
   */
  conversionRate: number | null;
  conversionBenchmark: number | null;
  status: StageStatus;
}

export interface VenueCanonicalFunnelSlidingScale {
  /** Extra tickets needed to reach capacity (capacity - sold). 0 when sold ≥ capacity. */
  extraTicketsToCapacity: number;
  /** Industry benchmark cost-per-ticket. */
  benchmarkCostPerTicket: number;
  /** Event's actual CPT so far. `null` when no purchases or no spend. */
  liveCostPerTicket: number | null;
  /** `extraTicketsToCapacity × benchmarkCostPerTicket`. */
  additionalSpendAtBenchmark: number;
  /** `extraTicketsToCapacity × liveCostPerTicket`. `null` when live CPT unknown. */
  additionalSpendAtLiveConversion: number | null;
}

export interface VenueCanonicalFunnelBackwardRead {
  /** Days from `today` (UTC) to `eventDate`. `null` when no event_date or event passed. */
  daysToEvent: number | null;
  /** `max(capacity - ticketsSold, 0)`. */
  ticketsRemaining: number;
  /** Tickets-per-day required from today to sell out by event_date. `null` when daysToEvent ≤ 0. */
  requiredDailyPace: number | null;
  /** Average daily tickets over the last 14 days from the rollup window. `null` when no rollup data. */
  achievedDailyPace: number | null;
  /** True when achievedDailyPace < 80% of requiredDailyPace AND both are known. */
  underPacing: boolean;
}

/**
 * Spend vs budget reconciliation (PR-C of issue #467).
 *
 * All inputs flow through `VenueCanonicalFunnelInput.allocatedBudget`
 * (SUM of `events[].budget_marketing`) and the existing `dailyRollups`
 * and backward-read fields — no new DB queries.
 *
 * `requiredPerDayState` drives display copy on the `requiredPerDay`
 * field instead of making the component switch on multiple nulls:
 *   - `"ok"`           → render `requiredPerDay`
 *   - `"event_passed"` → "Event passed"
 *   - `"sold_out"`     → "Sold out"
 *   - `"no_tickets_yet"` → "—" (awaiting first purchase / no live CPT)
 *   - `"no_event_date"` → "—" (no eventDate supplied)
 */
export interface VenueSpendReconciliation {
  /**
   * Allocated-only spend: `SUM(ad_spend_allocated ?? 0) + SUM(ad_spend_presale ?? 0)`.
   * No COALESCE fallback to raw `ad_spend` — matches Performance Summary's
   * "Paid media spent" tile. Unallocated dates (allocator stall) contribute £0.
   */
  spent: number;
  /** SUM of `events[].budget_marketing` via `aggregateSharedVenueBudget`. `null` when none set. */
  allocated: number | null;
  /** `allocated - spent`. `null` when `allocated` is null. */
  remaining: number | null;
  /** Earliest rollup date where allocated spend > 0. `null` when no spend yet. */
  firstSpendDate: string | null;
  /** Days from `firstSpendDate` to today. `null` when no spend yet. */
  daysSinceFirstSpend: number | null;
  /** `spent / daysSinceFirstSpend`. `null` when no spend. */
  spentPerDay: number | null;
  /**
   * Live CPT = `spent / ticketsSold` (where ticketsSold = `events.tickets_sold` SUM,
   * matching Performance Summary). `null` when no tickets sold yet.
   */
  liveCostPerTicket: number | null;
  /**
   * `(ticketsRemaining × liveCostPerTicket) / daysToEvent`.
   * `null` in all suppressed states (see `requiredPerDayState`).
   */
  requiredPerDay: number | null;
  /** Same value as `requiredPerDay`. Semantic alias — Matas locked single figure. */
  suggestedDaily: number | null;
  /** Why `requiredPerDay` is null (or "ok" when it is a number). */
  requiredPerDayState:
    | "ok"
    | "event_passed"
    | "sold_out"
    | "no_tickets_yet"
    | "no_event_date";
  /**
   * Budget sufficiency signal. `null` when `allocated` is null or
   * `requiredPerDay` is null (suppressed states).
   *
   * `"additional_needed"` when `requiredPerDay × daysToEvent > remaining`.
   * `"pace_covered"` when remaining budget covers the required spend.
   */
  warning: "additional_needed" | "pace_covered" | null;
  /**
   * Amount by which required spend exceeds remaining budget.
   * `null` when warning ≠ "additional_needed" or required total unknown.
   * Positive means over budget; used for the "additional budget needed by £X" copy.
   */
  warningAmount: number | null;
}

/**
 * One calendar day of allocated spend, for the Daily Spend Tracker.
 */
export interface DailySpendPoint {
  /** Calendar day `YYYY-MM-DD` (UTC). */
  date: string;
  /** `ad_spend_allocated + ad_spend_presale` summed across the venue's events for the day. */
  spent: number;
}

export interface VenueCanonicalFunnel {
  metrics: {
    reach: number | null;
    clicks: number | null;
    landingPageViews: number | null;
    purchases: number;
    spend: number;
    capacity: number;
  };
  /**
   * The four funnel stages in display order (Reach → Clicks → LPV →
   * Purchases). Per-stage targets are capacity-derived, status is
   * conversion-rate-vs-benchmark.
   */
  stages: VenueCanonicalFunnelStage[];
  slidingScale: VenueCanonicalFunnelSlidingScale;
  backwardRead: VenueCanonicalFunnelBackwardRead;
  /** Spend vs allocated budget reconciliation. */
  spendReconciliation: VenueSpendReconciliation;
  /**
   * Per-day allocated spend over the trailing window (default 14 days,
   * ascending by date), derived from the same `dailyRollups` already
   * passed in — `ad_spend_allocated + ad_spend_presale` per calendar
   * day. Powers the Daily Spend Tracker mini-bar chart on the Funnel
   * Pacing tab. This is the ONE new derived field added by the visual
   * overhaul PR; it introduces no new query (the rollups are already
   * fetched for the spend SUM).
   */
  dailySpendSeries: DailySpendPoint[];
  /**
   * Provenance — which source each numerator was drawn from. Surfaces
   * use this for tooltips and for the "cache_miss" hard-fail state on
   * Reach / Clicks / LPV.
   */
  sources: {
    reach: MetricSource;
    clicks: MetricSource;
    landingPageViews: MetricSource;
    purchases: MetricSource;
    spend: MetricSource;
  };
}

export interface VenueCanonicalFunnelInput {
  /** SUM of `events.capacity` across the venue's fixtures. */
  capacity: number;
  /**
   * SUM of `events.tickets_sold` across the venue's events.
   * Matches Performance Summary's headline ticket count so CPT and
   * Required-per-day agree between the two surfaces.
   * (Not `tier_channel_sales`, which diverges ~9% on Edinburgh.)
   */
  ticketsSold: number;
  /**
   * Lifetime cache row for this `(client_id, event_code)`. `null` when
   * the cache has not yet been populated — Reach / Clicks / LPV
   * surface as `null` (the cache-miss state, per #418 audit
   * deliverable #4).
   */
  lifetimeCacheRow: EventCodeLifetimeMetaCacheRow | null;
  /**
   * Daily rollup rows scoped to the venue's events. Used for spend
   * SUM (allocator-aware) and for the recent-window pace average in
   * the backward read. NOT used for Reach / Clicks / LPV — those
   * come from the lifetime cache.
   */
  dailyRollups: ReadonlyArray<DailyRollupRow>;
  /**
   * Earliest upcoming `event_date` (or latest past one when all
   * fixtures are past). Drives `daysToEvent` in the backward read.
   * `null` permitted — backward read reports `null` for derived
   * fields when missing.
   */
  eventDate: string | null;
  /**
   * SUM of `events[].budget_marketing` across the venue's fixtures.
   * `null` when no budget has been set — spend reconciliation renders
   * in spend-only mode (allocated / remaining / warning suppressed).
   */
  allocatedBudget?: number | null;
  /**
   * Override for the rolling pace window. Defaults to 14 days.
   * Tests pin to specific windows.
   */
  paceWindowDays?: number;
  /** Override "today" for deterministic tests. Defaults to `new Date()`. */
  today?: Date;
}

/** Build the canonical funnel struct from already-loaded inputs. */
export function buildVenueCanonicalFunnel(
  input: VenueCanonicalFunnelInput,
): VenueCanonicalFunnel {
  const today = input.today ?? new Date();
  const cache = input.lifetimeCacheRow;
  const reach = cache?.meta_reach ?? null;
  const clicks = cache?.meta_link_clicks ?? null;
  const lpv = cache?.meta_landing_page_views ?? null;
  const purchases = Math.max(0, Math.floor(input.ticketsSold));
  const capacity = Math.max(0, Math.floor(input.capacity));

  const spend = sumVenueSpend(input.dailyRollups);

  const reachTarget = Math.round(capacity * REACH_PER_TICKET_BENCHMARK);
  const clicksTarget = Math.round(capacity * CLICKS_PER_TICKET_BENCHMARK);
  const lpvTarget = Math.round(capacity * LPV_PER_TICKET_BENCHMARK);
  const purchasesTarget = capacity;

  // Conversion rates between consecutive stages (out of THIS stage).
  // null when either side is null/0 — surface renders as "—".
  const reachToClickRate =
    reach != null && reach > 0 && clicks != null ? clicks / reach : null;
  const clickToLpvRate =
    clicks != null && clicks > 0 && lpv != null ? lpv / clicks : null;
  const lpvToTicketRate =
    lpv != null && lpv > 0 ? purchases / lpv : null;

  const backwardRead = computeBackwardRead(
    input.dailyRollups,
    today,
    input.eventDate,
    capacity,
    purchases,
    input.paceWindowDays ?? 14,
  );

  const stages: VenueCanonicalFunnelStage[] = [
    {
      key: "reach",
      label: "TOFU",
      description:
        "Top of Funnel — getting reach in front of new audiences.",
      metricLabel: "Reach",
      actual: reach,
      target: reachTarget,
      pacingPct: pacingPct(reach, reachTarget),
      conversionRate: reachToClickRate,
      conversionBenchmark: FUNNEL_BENCHMARKS.reachToClick,
      status: conversionStatus(reachToClickRate, FUNNEL_BENCHMARKS.reachToClick),
    },
    {
      key: "clicks",
      label: "MOFU",
      description:
        "Middle of Funnel — turning attention into qualified traffic.",
      metricLabel: "Clicks",
      actual: clicks,
      target: clicksTarget,
      pacingPct: pacingPct(clicks, clicksTarget),
      conversionRate: clickToLpvRate,
      conversionBenchmark: FUNNEL_BENCHMARKS.clickToLpv,
      status: conversionStatus(clickToLpvRate, FUNNEL_BENCHMARKS.clickToLpv),
    },
    {
      key: "lpv",
      label: "BOFU",
      description:
        "Bottom of Funnel — getting landing-page intent ready to convert.",
      metricLabel: "LPV",
      actual: lpv,
      target: lpvTarget,
      pacingPct: pacingPct(lpv, lpvTarget),
      conversionRate: lpvToTicketRate,
      conversionBenchmark: FUNNEL_BENCHMARKS.lpvToTicket,
      status: conversionStatus(lpvToTicketRate, FUNNEL_BENCHMARKS.lpvToTicket),
    },
    {
      key: "purchases",
      label: "Sale Outcome",
      description:
        "Final conversion — purchases against capacity, paced against event date.",
      metricLabel: "Purchases",
      actual: purchases,
      target: purchasesTarget,
      pacingPct: pacingPct(purchases, purchasesTarget),
      conversionRate: null,
      conversionBenchmark: null,
      status: purchaseStatus(backwardRead),
    },
  ];

  const liveCpt =
    purchases > 0 && spend > 0 ? spend / purchases : null;
  const extraTickets = Math.max(0, capacity - purchases);
  const slidingScale: VenueCanonicalFunnelSlidingScale = {
    extraTicketsToCapacity: extraTickets,
    benchmarkCostPerTicket: FUNNEL_BENCHMARKS.benchmarkCostPerTicket,
    liveCostPerTicket: liveCpt,
    additionalSpendAtBenchmark:
      extraTickets * FUNNEL_BENCHMARKS.benchmarkCostPerTicket,
    additionalSpendAtLiveConversion:
      liveCpt != null ? extraTickets * liveCpt : null,
  };

  const spendReconciliation = computeSpendReconciliation({
    dailyRollups: input.dailyRollups,
    allocatedBudget: input.allocatedBudget ?? null,
    ticketsSold: purchases,
    ticketsRemaining: backwardRead.ticketsRemaining,
    daysToEvent: backwardRead.daysToEvent,
    today,
  });

  const dailySpendSeries = computeDailySpendSeries(
    input.dailyRollups,
    today,
    input.paceWindowDays ?? 14,
  );

  return {
    metrics: {
      reach,
      clicks,
      landingPageViews: lpv,
      purchases,
      spend,
      capacity,
    },
    stages,
    slidingScale,
    backwardRead,
    spendReconciliation,
    dailySpendSeries,
    sources: {
      reach: cache && reach != null ? "lifetime_cache" : "cache_miss",
      clicks: cache && clicks != null ? "lifetime_cache" : "cache_miss",
      landingPageViews:
        cache && lpv != null ? "lifetime_cache" : "cache_miss",
      purchases: "events_table",
      spend: "rollups",
    },
  };
}

function computeSpendReconciliation({
  dailyRollups,
  allocatedBudget,
  ticketsSold,
  ticketsRemaining,
  daysToEvent,
  today,
}: {
  dailyRollups: ReadonlyArray<DailyRollupRow>;
  allocatedBudget: number | null;
  /**
   * `events.tickets_sold` SUM — same source as Performance Summary's
   * headline ticket count. Used to compute live CPT so the two surfaces
   * agree on cost-per-ticket.
   */
  ticketsSold: number;
  ticketsRemaining: number;
  daysToEvent: number | null;
  today: Date;
}): VenueSpendReconciliation {
  const todayYmd = today.toISOString().slice(0, 10);
  const todayMs = Date.parse(`${todayYmd}T00:00:00Z`);

  // Spent = SUM(ad_spend_allocated) + SUM(ad_spend_presale). No COALESCE
  // fallback to raw ad_spend — raw is fanned-out across fixtures and
  // over-counts on unallocated dates (allocator stall). Matches Performance
  // Summary's "Paid media spent" tile exactly (source-of-truth contract,
  // PR #474 / #476).
  let spent = 0;
  let firstSpendDate: string | null = null;
  for (const row of dailyRollups) {
    const rowSpend =
      (row.ad_spend_allocated ?? 0) + (row.ad_spend_presale ?? 0);
    spent += rowSpend;
    if (!row.date || rowSpend <= 0) continue;
    if (firstSpendDate == null || row.date < firstSpendDate) {
      firstSpendDate = row.date;
    }
  }

  let daysSinceFirstSpend: number | null = null;
  let spentPerDay: number | null = null;
  if (firstSpendDate != null) {
    const firstMs = Date.parse(`${firstSpendDate}T00:00:00Z`);
    if (Number.isFinite(firstMs)) {
      const diff = Math.max(1, Math.round((todayMs - firstMs) / 86_400_000));
      daysSinceFirstSpend = diff;
      spentPerDay = spent / diff;
    }
  }

  // Live CPT uses the same spend basis (allocated-only) and same ticket
  // source (events.tickets_sold) as Performance Summary. Deriving it here
  // keeps the two figures consistent without relying on the caller to pass
  // a coherent pair.
  const liveCostPerTicket =
    ticketsSold > 0 && spent > 0 ? spent / ticketsSold : null;

  const allocated = allocatedBudget;
  const remaining = allocated != null ? allocated - spent : null;

  // Determine requiredPerDay and its display-state.
  let requiredPerDay: number | null = null;
  let requiredPerDayState: VenueSpendReconciliation["requiredPerDayState"] =
    "ok";

  if (daysToEvent == null) {
    requiredPerDayState = "no_event_date";
  } else if (daysToEvent <= 0) {
    requiredPerDayState = "event_passed";
  } else if (ticketsRemaining <= 0) {
    requiredPerDayState = "sold_out";
  } else if (liveCostPerTicket == null) {
    requiredPerDayState = "no_tickets_yet";
  } else {
    requiredPerDay = (ticketsRemaining * liveCostPerTicket) / daysToEvent;
    requiredPerDayState = "ok";
  }

  const suggestedDaily = requiredPerDay;

  // Budget sufficiency warning + overage amount.
  let warning: VenueSpendReconciliation["warning"] = null;
  let warningAmount: number | null = null;
  if (allocated != null && remaining != null && requiredPerDay != null && daysToEvent != null && daysToEvent > 0) {
    const totalRequired = requiredPerDay * daysToEvent;
    if (totalRequired > remaining) {
      warning = "additional_needed";
      warningAmount = totalRequired - remaining;
    } else {
      warning = "pace_covered";
    }
  }

  return {
    spent,
    allocated,
    remaining,
    firstSpendDate,
    daysSinceFirstSpend,
    spentPerDay,
    liveCostPerTicket,
    requiredPerDay,
    suggestedDaily,
    requiredPerDayState,
    warning,
    warningAmount,
  };
}

/**
 * Trailing per-day allocated spend window for the Daily Spend Tracker.
 *
 * Sums `ad_spend_allocated + ad_spend_presale` per calendar day across
 * the venue's events (multi-fixture venues have one rollup row per
 * event per day — they collapse onto the same date here), then returns
 * the last `windowDays` days ending today, ascending. Days with no
 * rollup row are omitted (the chart renders only days with data); the
 * caller pads the axis if a fixed N-bar width is wanted.
 */
function computeDailySpendSeries(
  rows: ReadonlyArray<DailyRollupRow>,
  today: Date,
  windowDays: number,
): DailySpendPoint[] {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (!row.date) continue;
    const spent = (row.ad_spend_allocated ?? 0) + (row.ad_spend_presale ?? 0);
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + spent);
  }
  const todayYmd = today.toISOString().slice(0, 10);
  const cutoffMs =
    Date.parse(`${todayYmd}T00:00:00Z`) - (windowDays - 1) * 86_400_000;
  const series: DailySpendPoint[] = [];
  for (const [date, spent] of byDate) {
    const ms = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(ms) || ms < cutoffMs) continue;
    series.push({ date, spent });
  }
  series.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return series;
}

function sumVenueSpend(rows: ReadonlyArray<DailyRollupRow>): number {
  let total = 0;
  for (const row of rows) {
    const allocated =
      row.ad_spend_allocated != null ? row.ad_spend_allocated : null;
    const presale = row.ad_spend_presale ?? 0;
    if (allocated != null) {
      total += allocated + presale;
    } else if (row.ad_spend != null) {
      total += row.ad_spend + presale;
    } else if (presale > 0) {
      total += presale;
    }
  }
  return total;
}

function pacingPct(actual: number | null, target: number): number | null {
  if (actual == null || target <= 0) return null;
  return (actual / target) * 100;
}

function conversionStatus(
  rate: number | null,
  benchmark: number,
): StageStatus {
  if (rate == null) return "unknown";
  return rate >= benchmark ? "on_track" : "off_track";
}

function purchaseStatus(
  _backward: VenueCanonicalFunnelBackwardRead,
): StageStatus {
  // Terminal stage: no downstream conversion rate. The pace check is
  // a separate signal (surfaced as the under-pacing banner on the
  // backward-read card) so the bar status reflects "is the funnel
  // converting?" — which is gated by the upstream stages. Default
  // ON_TRACK keeps the Edinburgh acceptance test aligned: all three
  // upstream stages at benchmark → Purchases ON_TRACK even when
  // sold/capacity is well under 100%.
  return "on_track";
}

function computeBackwardRead(
  rows: ReadonlyArray<DailyRollupRow>,
  today: Date,
  eventDate: string | null,
  capacity: number,
  ticketsSold: number,
  paceWindowDays: number,
): VenueCanonicalFunnelBackwardRead {
  const todayYmd = today.toISOString().slice(0, 10);
  const ticketsRemaining = Math.max(0, capacity - ticketsSold);

  let daysToEvent: number | null = null;
  if (eventDate) {
    const eventTime = Date.parse(`${eventDate}T00:00:00Z`);
    const todayTime = Date.parse(`${todayYmd}T00:00:00Z`);
    if (Number.isFinite(eventTime) && Number.isFinite(todayTime)) {
      const diffDays = Math.round((eventTime - todayTime) / 86_400_000);
      daysToEvent = diffDays;
    }
  }

  let requiredDailyPace: number | null = null;
  if (daysToEvent != null && daysToEvent > 0 && ticketsRemaining > 0) {
    requiredDailyPace = ticketsRemaining / daysToEvent;
  } else if (daysToEvent != null && daysToEvent > 0 && ticketsRemaining === 0) {
    requiredDailyPace = 0;
  }

  // Rolling N-day pace: sum tickets_sold across rollups whose date is
  // within the last `paceWindowDays` ending at `todayYmd`.
  const cutoffTime =
    Date.parse(`${todayYmd}T00:00:00Z`) - paceWindowDays * 86_400_000;
  let recentTickets = 0;
  let recentDaysWithData = 0;
  const datesSeen = new Set<string>();
  for (const row of rows) {
    if (!row.date) continue;
    const t = Date.parse(`${row.date}T00:00:00Z`);
    if (!Number.isFinite(t) || t < cutoffTime || t > Date.parse(`${todayYmd}T00:00:00Z`)) {
      continue;
    }
    recentTickets += row.tickets_sold ?? 0;
    if (!datesSeen.has(row.date)) {
      datesSeen.add(row.date);
      recentDaysWithData += 1;
    }
  }
  const achievedDailyPace =
    recentDaysWithData > 0 ? recentTickets / recentDaysWithData : null;

  const underPacing =
    requiredDailyPace != null &&
    requiredDailyPace > 0 &&
    achievedDailyPace != null &&
    achievedDailyPace < 0.8 * requiredDailyPace;

  return {
    daysToEvent,
    ticketsRemaining,
    requiredDailyPace,
    achievedDailyPace,
    underPacing,
  };
}
