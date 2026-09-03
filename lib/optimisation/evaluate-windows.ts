/**
 * lib/optimisation/evaluate-windows.ts
 *
 * Named constants that govern the evaluation window per metric class and the
 * minimum evidence threshold before any budget action fires.
 *
 * WHY per-metric rather than one global window
 * ─────────────────────────────────────────────
 * Evidence from prod shadow (2 days, 7 armed campaigns):
 *   - lpv_cost (traffic objective) — 10/10 ad sets produced decisions.
 *     Landing-page views are plentiful at any realistic budget, so 24h
 *     always accumulates enough signal.
 *   - cpr / cpa (registration / purchase objectives) — 0/50 ad sets produced
 *     decisions. At £5.56/day split across ~19 ad sets, each ad set sees
 *     ≈ £0.29/day. At a typical CPR of £1–2, that yields < 1 conversion per
 *     day per ad set — the 24h window reliably produces zero conversions and
 *     the evaluator correctly records "no data".
 *
 * The fix is metric-class-appropriate windows, not looser statistical checks:
 *   - Fast/volume metrics (cpc, cpm, ctr, lpv_cost): plenty of events per day
 *     at any realistic budget → keep 24h (unchanged — proven in prod).
 *   - Sparse/conversion metrics (cpr, cpa, roas): require accumulation time.
 *     7d (Meta's `last_7d` preset — confirmed valid after the 2026-08-18
 *     last_1d incident in live-metric.ts) gives 7× the signal; at £5.56/day
 *     over a week, an ad set sees ~£39 spend and at £1.72 CPR that is ~23
 *     conversions — well above the minimum-evidence threshold below.
 *
 * Meta call-volume impact: `last_7d` is a single insights fetch exactly as
 * expensive as `yesterday`. The request is not fan-out per day — it is a
 * single field expansion with a date_preset. Per-call cost unchanged;
 * per-tick call count unchanged.
 *
 * Shared by evaluate.ts, tick-runner.ts, and the test suite. No @/ imports;
 * node --test can resolve this module directly.
 */

import type { RuleMetric, RuleTimeWindow } from "../types.ts";

// ─── Per-metric class defaults ────────────────────────────────────────────────

/**
 * Metrics where a single day's worth of events is enough to compute a stable
 * rate. Landing-page views, clicks, and impressions are plentiful at any
 * realistic spend level, so 24h gives adequate signal without inflating the
 * measurement window.
 */
export const FAST_METRICS: readonly RuleMetric[] = ["lpv_cost", "cpc", "cpm", "ctr"];

/**
 * 24h — unchanged for fast metrics. `windowToDatePreset("24h")` → `"yesterday"`.
 */
export const DEFAULT_WINDOW_FAST: RuleTimeWindow = "24h";

/**
 * Conversion-style metrics where conversions per ad set per day can easily be
 * zero at typical spend levels. 7d (→ Meta's `last_7d` preset) accumulates
 * enough signal for a statistically meaningful rate while still being
 * responsive enough for weekly budget decisions.
 */
export const CONVERSION_METRICS: readonly RuleMetric[] = ["cpr", "cpa", "roas"];

/**
 * 7d — the default window for sparse conversion metrics.
 * Justification: see module doc comment above.
 */
export const DEFAULT_WINDOW_CONVERSION: RuleTimeWindow = "7d";

// ─── Minimum evidence ─────────────────────────────────────────────────────────

/**
 * Minimum raw result count within the evaluation window before any
 * scale_up / scale_down / pause action may fire.
 *
 * Applies only to metrics whose rate is derived from a countable event
 * (cpr, cpa) — not to direct-field metrics like cpm or ctr where
 * `resultCount` is null and the check is skipped.
 *
 * Justification: a rate computed from 1–4 conversions has a wide confidence
 * interval that will produce false signals and premature scaling. At typical
 * spend levels (£5–10/day, CPR £1–2), 5 conversions correspond to £5–10
 * of spend and ~3–5 days of data for a single ad set — enough to distinguish
 * noise from a real band match.
 */
export const MIN_CONVERSION_RESULT_COUNT = 5;

// ─── Cooldown alignment ───────────────────────────────────────────────────────

/**
 * Convert a `RuleTimeWindow` to hours. Used to derive the minimum cooldown.
 */
export function windowToHours(window: RuleTimeWindow): number {
  switch (window) {
    case "24h":
      return 24;
    case "3d":
      return 72;
    case "7d":
      return 168;
  }
}

/**
 * Effective cooldown hours for a given evaluation window and operator config.
 *
 * Invariant: cooldown ≥ window. Rationale — a budget change made on day D
 * is still inside the measured period for the next D+1 through D+7
 * evaluations when the window is 7d. Enforcing cooldown ≥ window prevents
 * stacking multiple changes within the same window (which would make the
 * measured rate increasingly unreliable as each change's effect compounds).
 *
 * Rolling-window caution: even with cooldown = window, the same conversion
 * event appears in every overlapping 7d fetch that spans its timestamp.
 * That is acceptable for threshold matching but callers MUST NOT treat N
 * consecutive scale_up decisions (where each window overlaps the prior one)
 * as independent evidence — there is no "N-consecutive" logic anywhere in
 * this codebase and this comment is the guard that keeps it that way.
 */
export function effectiveCooldownHours(
  window: RuleTimeWindow,
  configuredHours?: number,
): number {
  const windowHours = windowToHours(window);
  const base = configuredHours ?? windowHours; // default: cooldown equals window
  return Math.max(base, windowHours);
}

// ─── Window selection ─────────────────────────────────────────────────────────

/**
 * Class-appropriate default for a given metric.
 * `"cpr"`, `"cpa"`, `"roas"` → `"7d"`.
 * Everything else → `"24h"`.
 */
export function defaultWindowForMetric(metric: RuleMetric): RuleTimeWindow {
  return (CONVERSION_METRICS as readonly string[]).includes(metric)
    ? DEFAULT_WINDOW_CONVERSION
    : DEFAULT_WINDOW_FAST;
}

/**
 * Order comparison for `RuleTimeWindow`. Returns the wider of the two.
 * Guarantees a metric-appropriate window even when the operator's rule
 * still uses the old 24h setting — the system enforces the minimum
 * without requiring the operator to re-configure existing rules.
 */
export function maxWindow(a: RuleTimeWindow, b: RuleTimeWindow): RuleTimeWindow {
  const rank: Record<RuleTimeWindow, number> = { "24h": 0, "3d": 1, "7d": 2 };
  return rank[a] >= rank[b] ? a : b;
}
