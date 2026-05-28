/**
 * lib/dashboard/benchmarks.ts
 *
 * Central accessor for the funnel-pacing benchmark conversion rates.
 *
 * The canonical numeric source still lives in
 * `lib/dashboard/venue-canonical-funnel.ts` (`FUNNEL_BENCHMARKS`) — this
 * module re-exports it behind a `getFunnelBenchmarks()` accessor so that
 * presentation components depend on a *function*, not a literal. When a
 * follow-up introduces per-event-type benchmark overrides (e.g. festivals
 * vs single-night shows), only this file changes: callers pass an optional
 * `eventType` and keep working unmodified.
 *
 * No component should hard-code 14 / 50 / 5 or £4.80. Import the accessor.
 */

import { FUNNEL_BENCHMARKS } from "./venue-canonical-funnel.ts";

export interface FunnelBenchmarks {
  /** Reach → Click conversion (0.14 = 14%). */
  reachToClick: number;
  /** Click → Landing-page-view conversion (0.50 = 50%). */
  clickToLpv: number;
  /** Landing-page-view → Ticket conversion (0.05 = 5%). */
  lpvToTicket: number;
  /** Industry benchmark cost-per-ticket (£4.80). */
  benchmarkCostPerTicket: number;
}

/**
 * Event-type discriminator reserved for the follow-up override layer.
 * Today every type resolves to the locked 4theFans dataset benchmarks.
 */
export type BenchmarkEventType =
  | "default"
  | "single_show"
  | "festival"
  | "residency";

/**
 * Resolve the benchmark set for an event type. Currently type-agnostic —
 * returns the locked 14 / 50 / 5 / £4.80 set for every input. The
 * signature is intentionally future-proofed so the override table can be
 * dropped in without touching a single call-site.
 */
export function getFunnelBenchmarks(
  _eventType: BenchmarkEventType = "default",
): FunnelBenchmarks {
  return {
    reachToClick: FUNNEL_BENCHMARKS.reachToClick,
    clickToLpv: FUNNEL_BENCHMARKS.clickToLpv,
    lpvToTicket: FUNNEL_BENCHMARKS.lpvToTicket,
    benchmarkCostPerTicket: FUNNEL_BENCHMARKS.benchmarkCostPerTicket,
  };
}

/** Human-readable label for a funnel edge, keyed by the upstream stage. */
export function conversionEdgeLabel(
  stageKey: "reach" | "clicks" | "lpv" | "purchases",
): string {
  if (stageKey === "reach") return "Reach → Click";
  if (stageKey === "clicks") return "Click → LPV";
  if (stageKey === "lpv") return "LPV → Ticket";
  return "";
}
