/**
 * Plan v2 benchmark read.
 *
 * TODO(plan-v2-benchmarks) — the real aggregator lives on #896
 * (`campaign_plan_benchmarks_v`). Until that PR merges, every plan is
 * rung 0: this module returns undefined and never a preset number.
 */

import type { MetricChipBenchmark } from "../viz/metric-chip.ts";

export type BenchmarkUnit = "signup" | "ticket" | "click" | "purchase" | "lead" | "lpv" | "view";
export type BenchmarkChannel = "all" | "meta" | "tiktok" | "google";

export function planBenchmark(_input?: {
  clientId?: string | null;
  venueKey?: string | null;
  venueLabel?: string | null;
  unit?: BenchmarkUnit;
  channel?: BenchmarkChannel;
  excludeEventId?: string | null;
}): MetricChipBenchmark | undefined {
  return undefined;
}
