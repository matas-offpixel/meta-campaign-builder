/**
 * campaign_plan_predictions write path — canon §1.3.
 * Written at Launch; actual written at close (show or archive).
 * LEARN is not wired here. Soft-fails when migration 166 is unapplied.
 */

import { isRelationMissing } from "./schema-probe.ts";
import type { MetricChipBenchmark } from "../viz/metric-chip.ts";

export const PREDICTIONS_TABLE = "campaign_plan_predictions" as const;

/** §1.5 rule 2 — predictions read from the row once 166 lands. */
export const PREDICTIONS_REMOVAL =
  "campaign_plan_predictions lands → predictions read from the row";

export type PredictionMetric =
  | "cost_per_unit"
  | "split_meta"
  | "split_tiktok"
  | "split_google"
  | "pace_daily";

export type PredictionUnit = "reg" | "click" | "lpv" | "purchase" | "view";

export type PredictionLineKind = "measured" | "estimated" | "not_yet";

export type PredictionRung = "venue" | "client" | "client_thin" | "starting_point";

export type PredictionSourceKind = "meta_said" | "our_tag" | "entered";

export type CampaignPlanPrediction = {
  userId: string;
  planId: string;
  metric: PredictionMetric;
  unit: PredictionUnit | null;
  value: number;
  lineKind: PredictionLineKind;
  benchmarkRung: PredictionRung | null;
  n: number;
  runsUsed: string[];
  sourceKind: PredictionSourceKind;
};

export function rungFromBenchmark(benchmark: MetricChipBenchmark | undefined): PredictionRung {
  if (!benchmark || benchmark.n <= 0) return "starting_point";
  if (benchmark.n >= 3) return "venue";
  if (benchmark.n === 2) return "client";
  return "client_thin";
}

export function lineKindFromBenchmark(
  benchmark: MetricChipBenchmark | undefined,
): PredictionLineKind {
  if (!benchmark) return "not_yet";
  return benchmark.lineKind === "measured" ? "measured" : "estimated";
}

export function predictionFromBenchmark(input: {
  userId: string;
  planId: string;
  unit: PredictionUnit;
  benchmark: MetricChipBenchmark | undefined;
  startingPoint: number;
  sourceKind?: PredictionSourceKind;
}): CampaignPlanPrediction {
  const benchmark = input.benchmark;
  return {
    userId: input.userId,
    planId: input.planId,
    metric: "cost_per_unit",
    unit: input.unit,
    value: benchmark?.value ?? input.startingPoint,
    lineKind: lineKindFromBenchmark(benchmark),
    benchmarkRung: rungFromBenchmark(benchmark),
    n: benchmark?.n ?? 0,
    runsUsed: benchmark?.runsUsed ?? [],
    sourceKind: input.sourceKind ?? "meta_said",
  };
}

function rowToInsert(row: CampaignPlanPrediction): Record<string, unknown> {
  return {
    user_id: row.userId,
    plan_id: row.planId,
    metric: row.metric,
    unit: row.unit,
    value: row.value,
    line_kind: row.lineKind,
    benchmark_rung: row.benchmarkRung,
    n: row.n,
    runs_used: row.runsUsed,
    source_kind: row.sourceKind,
  };
}

type WriteClient = {
  from: (table: string) => {
    upsert: (
      row: Record<string, unknown>,
      opts?: { onConflict?: string },
    ) => Promise<{ error: { code?: string; message?: string } | null }>;
    update: (row: Record<string, unknown>) => {
      eq: (col: string, value: string) => {
        is: (
          col: string,
          value: null,
        ) => Promise<{ error: { code?: string; message?: string } | null }>;
      };
    };
  };
};

export async function writePredictionsAtLaunch(
  supabase: unknown,
  rows: readonly CampaignPlanPrediction[],
): Promise<{ ok: true } | { ok: false; tableMissing: boolean; error: string }> {
  const client = supabase as WriteClient;
  for (const row of rows) {
    const { error } = await client
      .from(PREDICTIONS_TABLE)
      .upsert(rowToInsert(row), { onConflict: "plan_id,metric,unit" });
    if (!error) continue;
    return {
      ok: false,
      tableMissing: isRelationMissing(error),
      error: error.message ?? "campaign_plan_predictions write failed",
    };
  }
  return { ok: true };
}

export async function writePredictionActualsAtClose(
  supabase: unknown,
  input: {
    planId: string;
    actual: number;
    closedReason: "show" | "archived";
  },
): Promise<{ ok: true } | { ok: false; tableMissing: boolean; error: string }> {
  const client = supabase as WriteClient;
  const { error } = await client
    .from(PREDICTIONS_TABLE)
    .update({
      actual: input.actual,
      actual_at: new Date().toISOString(),
      closed_reason: input.closedReason,
    })
    .eq("plan_id", input.planId)
    .is("actual_at", null);
  if (!error) return { ok: true };
  return {
    ok: false,
    tableMissing: isRelationMissing(error),
    error: error.message ?? "campaign_plan_predictions actual write failed",
  };
}
