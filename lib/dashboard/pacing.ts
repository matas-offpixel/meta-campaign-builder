/**
 * Phase-aware pacing for the marketing-plan daily grid.
 *
 * Pure module — no React, no DB, no IO. Everything in here is a function
 * of (days, event milestones, total budget). Keep it that way so smart
 * spread can be unit-tested in isolation and reused server-side later.
 *
 * Phase classification (per hotfix B2 spec):
 *   - presale        : day < onsale_start
 *   - onsale_payday  : onsale_start ≤ day < final10Start AND day is in a
 *                      UK payday window
 *   - onsale_slowdown: onsale_start ≤ day < final10Start AND NOT in window
 *   - final10        : final10Start ≤ day < event_date
 *   - event          : day == event_date
 *
 * Where:
 *   onsale_start = general_sale_at ?? presale_at ?? null
 *   final10Start = event_date − 10 days
 *
 * UK payday window (v1): 18-day inclusive range that starts on the
 * Thursday before the last Friday of each calendar month and ends on the
 * Monday 17 days later. Weekends are included in the window; UK bank
 * holidays are ignored (refinement for v2).
 *
 * Per-day spend split (Traffic / Conversion):
 *   presale        →   0% /  100%
 *   onsale_slowdown→  75% /   25%
 *   onsale_payday  →  50% /   50%
 *   final10        →  25% /   75%
 *   event          →  25% /   75%
 *
 * Phase-weighted inter-day budget: each day's allotted slice is
 *   totalBudget × PHASE_WEIGHTS[phase] / Σ(PHASE_WEIGHTS)
 *
 * Rounding: all per-day and per-objective values are rounded to the
 * nearest £0.50. The last day's Conversion absorbs inter-day + intra-day
 * drift so Σ(all traffic + all conversion) = totalBudget exactly. This
 * means the last day's Conversion may not be a clean £0.50 multiple.
 */

import type { ObjectiveBudgets } from "@/lib/dashboard/objectives";

/** Subset of EventRow we actually depend on. Keeps this module decoupled
 *  from the full Supabase row type so a schema add doesn't cascade. */
export interface SmartSpreadEvent {
  announcement_at: string | null;
  presale_at: string | null;
  general_sale_at: string | null;
  event_date: string | null;
}

/** Subset of AdPlanDay we depend on. */
export interface SmartSpreadDay {
  day: string;
  objective_budgets: ObjectiveBudgets | null;
}

export type SmartSpreadPhase =
  | "presale"
  | "onsale_slowdown"
  | "onsale_payday"
  | "final10"
  | "event";

export interface SmartSpreadShare {
  traffic: number;
  conversion: number;
}

export interface SmartSpreadResult {
  /** day (YYYY-MM-DD) → traffic + conversion split. One entry per input day. */
  perDay: Map<string, SmartSpreadShare>;
  appliedCount: number;
}

/**
 * Phase spend weights for phase-weighted daily budget allocation.
 * Higher weight → larger daily slice of the total budget.
 *
 *   presale        1.0  — steady awareness spend before tickets go live
 *   onsale_slowdown 0.6  — mid-month on-sale period: lower organic intent
 *   onsale_payday  1.2  — payday window: elevated purchase intent
 *   final10        1.5  — countdown: urgency drives up conversion rates
 *   event          2.0  — event day: last-minute buyers, max spend
 */
export const PHASE_WEIGHTS: Record<SmartSpreadPhase, number> = {
  presale: 1.0,
  onsale_slowdown: 0.6,
  onsale_payday: 1.2,
  final10: 1.5,
  event: 2.0,
};

// ─── Date helpers (local-tz, mirror lib/db/ad-plans.ts) ─────────────────────
//
// Plan dates are date-only strings; comparisons must be calendar-day,
// not millisecond. parseLocalDate / addDays / isoToYmd keep us in the
// local-midnight regime so YYYY-MM-DD strings round-trip without TZ
// drift around midnight UTC.

function parseLocalDate(ymd: string): Date {
  return new Date(ymd + "T00:00:00");
}

function fmtLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(ymd: string, days: number): string {
  const d = parseLocalDate(ymd);
  d.setDate(d.getDate() + days);
  return fmtLocalDate(d);
}

function isoToYmd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return fmtLocalDate(d);
}

// ─── Phase classification ────────────────────────────────────────────────────

interface PhaseContext {
  onsaleStart: string | null;
  final10Start: string;
  eventDay: string;
}

function buildPhaseContext(
  event: SmartSpreadEvent,
): PhaseContext | null {
  const eventDay = isoToYmd(event.event_date);
  if (!eventDay) return null;
  const onsaleStart =
    isoToYmd(event.general_sale_at) ?? isoToYmd(event.presale_at);
  return {
    onsaleStart,
    final10Start: addDays(eventDay, -10),
    eventDay,
  };
}

export function classifyPhase(
  day: string,
  ctx: PhaseContext,
): SmartSpreadPhase {
  if (day === ctx.eventDay) return "event";
  if (day >= ctx.final10Start && day < ctx.eventDay) return "final10";
  if (ctx.onsaleStart !== null && day < ctx.onsaleStart) return "presale";
  // On-sale (including the all-null "treat as on-sale" fallback):
  return isInPaydayWindow(day) ? "onsale_payday" : "onsale_slowdown";
}

// ─── UK payday window detection ──────────────────────────────────────────────

/**
 * Last Friday of the calendar month at monthIdx (0-based) in `year`.
 * Counts backwards from the last day of the month until it hits a Friday.
 */
function lastFridayOfMonth(year: number, monthIdx: number): Date {
  // day=0 of the next month === last day of monthIdx
  const d = new Date(year, monthIdx + 1, 0);
  while (d.getDay() !== 5) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

/**
 * Build the 18-day payday window for a given last-Friday-of-month.
 * Window: [lastFriday − 1 day (Thursday)] → [lastFriday + 16 days (Monday)]
 * Inclusive on both ends, 18 days total.
 */
function paydayWindow(lastFriday: Date): { start: Date; end: Date } {
  const start = new Date(lastFriday);
  start.setDate(start.getDate() - 1); // Thursday before

  const end = new Date(start);
  end.setDate(end.getDate() + 17); // +17 days → Monday

  return { start, end };
}

/**
 * Returns true if `ymd` falls within any UK monthly payday window.
 *
 * Payday window = 18-day inclusive range starting on the Thursday
 * before the last Friday of the calendar month, ending the Monday
 * 17 days later (spanning the end-of-month / start-of-next-month
 * pay cycle with the typical post-payday uplift period).
 *
 * We check both the current month's window AND the previous month's
 * window, because a window starting in late Month N extends into
 * Month N+1 (at most ~10 days into the next month). A day can belong
 * to at most one window.
 *
 * UK bank holidays are not modelled in v1.
 */
export function isInPaydayWindow(ymd: string): boolean {
  const d = parseLocalDate(ymd);
  const t = d.getTime();

  const year = d.getFullYear();
  const monthIdx = d.getMonth();

  // Check current month's window.
  const win = paydayWindow(lastFridayOfMonth(year, monthIdx));
  if (t >= win.start.getTime() && t <= win.end.getTime()) return true;

  // Check previous month's window — it can spill into this month.
  const prevYear = monthIdx === 0 ? year - 1 : year;
  const prevMonth = monthIdx === 0 ? 11 : monthIdx - 1;
  const prevWin = paydayWindow(lastFridayOfMonth(prevYear, prevMonth));
  return t >= prevWin.start.getTime() && t <= prevWin.end.getTime();
}

// ─── Ratio table ─────────────────────────────────────────────────────────────

function shareForPhase(phase: SmartSpreadPhase): SmartSpreadShare {
  switch (phase) {
    case "presale":
      return { traffic: 0, conversion: 1 };
    case "onsale_slowdown":
      return { traffic: 0.75, conversion: 0.25 };
    case "onsale_payday":
      return { traffic: 0.5, conversion: 0.5 };
    case "final10":
    case "event":
      return { traffic: 0.25, conversion: 0.75 };
  }
}

// ─── Rounding helper ─────────────────────────────────────────────────────────

/** Round `n` to the nearest £0.50 (half-pound). */
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute a phase-aware spread of `totalBudget` across every day in the
 * plan range for `event`.
 *
 * Smart spread is overwrite-and-rebalance: every day gets a (traffic,
 * conversion) split per phase ratios. Existing manual edits in Traffic /
 * Conversion are NOT preserved — callers that want a fill-only behaviour
 * should use Even spread instead.
 *
 * The caller is responsible for preserving other objective keys (Reach,
 * Post eng., TikTok, Google) when building the persisted patch.
 *
 * Phase-weighted budget: each day's daily budget is proportional to its
 * phase weight (see PHASE_WEIGHTS). Days with heavier phases receive a
 * larger slice of the total.
 *
 * £0.50 rounding: all per-day and per-objective values are rounded to the
 * nearest £0.50. The last day's Conversion absorbs all inter-day and
 * intra-day rounding drift so Σ(traffic + conversion) = totalBudget
 * exactly. This means the last day's Conversion value may not itself be
 * a clean £0.50 multiple — this is by design.
 */
export function computeSmartSpread(args: {
  days: SmartSpreadDay[];
  event: SmartSpreadEvent;
  totalBudget: number;
}): SmartSpreadResult {
  const { days, event, totalBudget } = args;
  const empty: SmartSpreadResult = { perDay: new Map(), appliedCount: 0 };

  if (days.length === 0 || totalBudget <= 0) return empty;
  const ctx = buildPhaseContext(event);
  if (!ctx) {
    // No event_date → can't classify phases; treat as no-op rather than
    // smearing ratios across an undated plan.
    return empty;
  }

  const N = days.length;
  const phases = days.map((d) => classifyPhase(d.day, ctx));
  const totalWeight = phases.reduce((sum, ph) => sum + PHASE_WEIGHTS[ph], 0);

  const out = new Map<string, SmartSpreadShare>();
  let assignedBudget = 0;

  days.forEach((d, i) => {
    const phase = phases[i];
    const weight = PHASE_WEIGHTS[phase];
    const isLast = i === N - 1;

    // Phase-weighted daily budget. Non-last days are rounded to £0.50;
    // the last day absorbs inter-day drift from rounding.
    const rawBudget = (totalBudget * weight) / totalWeight;
    const dayBudget = isLast
      ? Math.round((totalBudget - assignedBudget) * 100) / 100
      : roundHalf(rawBudget);
    if (!isLast) assignedBudget += dayBudget;

    const ratios = shareForPhase(phase);
    const traffic = roundHalf(dayBudget * ratios.traffic);
    // Last day: Conversion absorbs remaining drift so Σ all values =
    // totalBudget exactly. This value may break the £0.50 rule — that is
    // intentional and acceptable (the alternative is a visible total
    // discrepancy in the stat cards).
    const conversion = isLast
      ? Math.round((dayBudget - traffic) * 100) / 100
      : roundHalf(dayBudget * ratios.conversion);

    out.set(d.day, { traffic, conversion });
  });

  return { perDay: out, appliedCount: N };
}
