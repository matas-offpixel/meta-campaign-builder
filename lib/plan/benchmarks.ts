/**
 * Plan v2 benchmark read — canon §1.2, audit two §1, G34.
 * One function returns MetricChipBenchmark. n = 0 → undefined (J7 / not-yet).
 * Median + interpolated IQR match Postgres percentile_cont.
 * The view is the run grain; this file aggregates after excluding this event.
 */

import {
  benchmarkBandAllowed,
  defaultBenchmarkDirection,
  type MetricChipBenchmark,
} from "../viz/metric-chip.ts";
import { formatVizDay } from "../viz/format-moment.ts";
import { PLAN_BENCHMARK_WINDOW } from "./benchmark-window.ts";

export const BENCHMARK_VIEW = "campaign_plan_benchmarks_v" as const;

/** §1.5 rule 1 — removed once this view is the only median. */
export const BENCHMARK_ON_READ_REMOVAL =
  "campaign_plan_benchmarks_v lands and lib/plan/benchmarks.ts is the only median";

export type BenchmarkUnit = "signup" | "ticket" | "click" | "purchase" | "lead" | "lpv";
export type BenchmarkChannel = "all" | "meta" | "tiktok" | "google";

export type BenchmarkRun = {
  eventId: string;
  eventCode: string;
  eventDate: string | null;
  cost: number;
};

export function percentileCont(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0]!;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (pos - lo) * (sorted[hi]! - sorted[lo]!);
}

export function roundGbp(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatFromShows(n: number, venueLabel: string): string {
  const show = n === 1 ? "1 other show" : `${n} other shows`;
  return `from ${show} at ${venueLabel}`;
}

export function defaultChannelForUnit(unit: BenchmarkUnit): BenchmarkChannel {
  return unit === "ticket" ? "all" : "meta";
}

export function benchmarkWindowForUnit(unit: BenchmarkUnit) {
  return unit === "ticket" ? PLAN_BENCHMARK_WINDOW.perTicket : PLAN_BENCHMARK_WINDOW.perSignup;
}

function runLabel(run: BenchmarkRun): string {
  const date = run.eventDate ? formatVizDay(run.eventDate) : null;
  return date && date !== "—" ? `${run.eventCode} (${date})` : run.eventCode;
}

/**
 * Aggregate prior runs into the chip. `undefined` when n = 0 — the face
 * draws the not-yet, it does not invent a starting point here.
 */
export function metricChipBenchmarkFromRuns(input: {
  runs: readonly BenchmarkRun[];
  excludeEventId?: string | null;
  venueLabel: string;
}): MetricChipBenchmark | undefined {
  const prior = input.runs.filter((run) => run.eventId !== input.excludeEventId);
  const costs = prior.map((run) => run.cost).sort((a, b) => a - b);
  const n = costs.length;
  if (n === 0) return undefined;

  const value = roundGbp(percentileCont(costs, 0.5));
  const band = benchmarkBandAllowed(n)
    ? ([roundGbp(percentileCont(costs, 0.25)), roundGbp(percentileCont(costs, 0.75))] as [
        number,
        number,
      ])
    : undefined;
  const lineKind = n >= 3 ? "measured" : "estimated";

  return {
    value,
    band,
    lineKind,
    sentence: formatFromShows(n, input.venueLabel),
    runsUsed: prior.map(runLabel),
    bandWord: "your middle half",
    n,
    direction: defaultBenchmarkDirection("cost"),
  };
}

export type BenchmarkRow = {
  client_id: string;
  venue_key: string;
  event_id: string;
  event_code: string;
  event_date: string | null;
  unit: string;
  channel: string;
  cost: number;
};

/** Map a view row (or fixture) into a run. */
export function runFromViewRow(row: BenchmarkRow): BenchmarkRun {
  return {
    eventId: row.event_id,
    eventCode: row.event_code,
    eventDate: row.event_date,
    cost: Number(row.cost),
  };
}

export function selectBenchmarkRows(
  rows: readonly BenchmarkRow[],
  input: {
    clientId: string;
    venueKey: string;
    unit: BenchmarkUnit;
    channel?: BenchmarkChannel;
  },
): BenchmarkRow[] {
  const channel = input.channel ?? defaultChannelForUnit(input.unit);
  return rows.filter(
    (row) =>
      row.client_id === input.clientId &&
      row.venue_key === input.venueKey &&
      row.unit === input.unit &&
      row.channel === channel,
  );
}

/**
 * The one read. Pass view rows (or fixtures). Returns undefined when
 * there is no usual yet — J7 / starting-point faces handle that.
 */
export function planBenchmark(input: {
  rows: readonly BenchmarkRow[];
  clientId: string;
  venueKey: string;
  venueLabel: string;
  unit: BenchmarkUnit;
  channel?: BenchmarkChannel;
  excludeEventId?: string | null;
}): MetricChipBenchmark | undefined {
  const matched = selectBenchmarkRows(input.rows, input);
  return metricChipBenchmarkFromRuns({
    runs: matched.map(runFromViewRow),
    excludeEventId: input.excludeEventId,
    venueLabel: input.venueLabel,
  });
}
