/**
 * Phase-aware pacing for the marketing-plan daily grid.
 *
 * Pure module — no React, no DB, no IO. Everything in here is a function
 * of (days, event milestones, total budget). Keep it that way so smart
 * spread can be unit-tested in isolation and reused server-side later
 * (e.g. when we move plan generation behind an API route).
 *
 * Phase classification (per slice B spec):
 *   - presale  : day < onsale_start
 *   - onsale   : onsale_start ≤ day < event_date − 10
 *   - final10  : event_date − 10 ≤ day < event_date
 *   - event    : day == event_date
 *
 * Where:
 *   onsale_start = general_sale_at ?? presale_at ?? null
 *
 * If onsale_start is null (none of announce/presale/general_sale set),
 * every day before final10 is treated as on-sale — matches the spec's
 * "all null → entire range as on-sale" fallback.
 *
 * Note on the spec's "(or presale_at → day before general_sale_at if
 * both set)" parenthetical: that wording covers the common case where
 * announce_at marks the public reveal but presale_at is the moment
 * conversion-style ads begin. In code we collapse both branches into
 * "onsale starts at general_sale_at if set, otherwise presale_at".
 * Days in the plan range that fall before that boundary are presale —
 * which is the strategically correct ratio whether announce_at exists
 * or not (you're not driving conversions before tickets are buyable).
 *
 * Per-day spend split (intra-day):
 *   - presale       → 100% Conversion,   0% Traffic
 *   - onsale (def)  →  25% Conversion,  75% Traffic
 *   - onsale payday →  50% Conversion,  50% Traffic
 *   - final10       →  75% Conversion,  25% Traffic
 *   - event day     →  75% Conversion,  25% Traffic
 *
 * Per-day budget (inter-day) is uniform: total / days.length. Smart
 * spread is overwrite-and-rebalance — every day in the plan range gets
 * its Traffic and Conversion keys replaced. The other objective keys
 * (Reach, Post engagement, TikTok, Google) are left untouched. This is
 * a deliberate split from Even spread, which preserves existing values:
 *   - Even spread  = additive fill into Conversion only
 *   - Smart spread = overwrite-and-rebalance Traffic + Conversion
 *
 * UK payday = last working day (Mon–Fri) of the calendar month. Bank
 * holidays are not modelled — overkill for v1.
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

export type SmartSpreadPhase = "presale" | "onsale" | "final10" | "event";

export interface SmartSpreadShare {
  traffic: number;
  conversion: number;
}

export interface SmartSpreadResult {
  /** day (YYYY-MM-DD) → traffic + conversion split. One entry per input day. */
  perDay: Map<string, SmartSpreadShare>;
  appliedCount: number;
}

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
  if (ctx.onsaleStart === null) return "onsale";
  if (day < ctx.onsaleStart) return "presale";
  return "onsale";
}

// ─── UK payday detection ─────────────────────────────────────────────────────

/**
 * Last working day (Mon–Fri) of the calendar month containing `ymd`.
 * Bank holidays are deliberately ignored; payday-shifting around them
 * is a refinement that hasn't bitten anyone yet and would require a
 * bank-holiday calendar this module doesn't have.
 */
function lastWorkingDayOfMonth(year: number, monthIdx: number): Date {
  // monthIdx is 0-based; passing day=0 to a (year, monthIdx + 1, 0)
  // constructor returns the last day of monthIdx.
  const d = new Date(year, monthIdx + 1, 0);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

export function isUkPayday(ymd: string): boolean {
  const d = parseLocalDate(ymd);
  const last = lastWorkingDayOfMonth(d.getFullYear(), d.getMonth());
  return (
    last.getFullYear() === d.getFullYear() &&
    last.getMonth() === d.getMonth() &&
    last.getDate() === d.getDate()
  );
}

// ─── Ratio table ─────────────────────────────────────────────────────────────

function shareForPhase(phase: SmartSpreadPhase, payday: boolean): SmartSpreadShare {
  switch (phase) {
    case "presale":
      return { traffic: 0, conversion: 1 };
    case "onsale":
      return payday
        ? { traffic: 0.5, conversion: 0.5 }
        : { traffic: 0.75, conversion: 0.25 };
    case "final10":
    case "event":
      return { traffic: 0.25, conversion: 0.75 };
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute a phase-aware spread of `totalBudget` across every day in the
 * plan range for `event`.
 *
 * Smart spread is overwrite-and-rebalance: every day gets a (traffic,
 * conversion) split per the phase ratios. Existing manual edits in
 * Traffic / Conversion are NOT preserved — that was the v1 behaviour
 * and it broke the common "Even spread first, then Smart spread to
 * rebalance" workflow (every day looked manually edited and the
 * algorithm no-op'd). The caller is responsible for preserving the
 * other objective keys (Reach, Post eng., TikTok, Google) when it
 * builds the persisted patch — this function only returns the Traffic
 * and Conversion values.
 *
 * Penny rounding: per-day budget is rounded to 2dp; the last day
 * absorbs any rounding drift so Σ traffic + Σ conversion across all
 * days equals totalBudget exactly. Within each day, the conversion
 * bucket absorbs intra-day rounding so traffic + conversion for that
 * day equals its allotted dayBudget — keeps the Daily spend column
 * tidy.
 */
export function computeSmartSpread(args: {
  days: SmartSpreadDay[];
  event: SmartSpreadEvent;
  totalBudget: number;
}): SmartSpreadResult {
  const { days, event, totalBudget } = args;
  const empty: SmartSpreadResult = {
    perDay: new Map(),
    appliedCount: 0,
  };

  if (days.length === 0 || totalBudget <= 0) return empty;
  const ctx = buildPhaseContext(event);
  if (!ctx) {
    // No event_date → can't classify; treat as no-op rather than
    // smearing onsale ratios across an undated plan.
    return empty;
  }

  const N = days.length;
  const perDay = Math.round((totalBudget / N) * 100) / 100;
  const lastDay = Math.round((totalBudget - perDay * (N - 1)) * 100) / 100;

  const out = new Map<string, SmartSpreadShare>();
  days.forEach((d, i) => {
    const dayBudget = i === N - 1 ? lastDay : perDay;
    const phase = classifyPhase(d.day, ctx);
    const ratios = shareForPhase(phase, phase === "onsale" && isUkPayday(d.day));
    const traffic = Math.round(dayBudget * ratios.traffic * 100) / 100;
    // Conversion absorbs the intra-day rounding remainder so the row
    // sum equals dayBudget exactly. Avoids £0.01 visual drift in the
    // Daily spend column when ratios.traffic isn't a clean fraction.
    const conversion = Math.round((dayBudget - traffic) * 100) / 100;
    out.set(d.day, { traffic, conversion });
  });

  return { perDay: out, appliedCount: N };
}
