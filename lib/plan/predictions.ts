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
  actual?: number | null;
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

export async function loadPlanPredictions(
  supabase: unknown,
  planId: string,
): Promise<CampaignPlanPrediction[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;
  const { data, error } = await client
    .from(PREDICTIONS_TABLE)
    .select("user_id, plan_id, metric, unit, value, line_kind, benchmark_rung, n, runs_used, source_kind, actual")
    .eq("plan_id", planId);
  if (error) {
    if (!isRelationMissing(error)) {
      console.warn("[predictions] load failed", error.message);
    }
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    userId: String(row.user_id ?? ""),
    planId: String(row.plan_id ?? ""),
    metric: row.metric as PredictionMetric,
    unit: (row.unit as PredictionUnit | null) ?? null,
    value: Number(row.value ?? 0),
    lineKind: row.line_kind as PredictionLineKind,
    benchmarkRung: (row.benchmark_rung as PredictionRung | null) ?? null,
    n: Number(row.n ?? 0),
    runsUsed: Array.isArray(row.runs_used) ? row.runs_used.map(String) : [],
    sourceKind: row.source_kind as PredictionSourceKind,
    actual: row.actual == null ? null : Number(row.actual),
  }));
}

export function planWindowActual(input: {
  spend: number;
  regs: number;
  purchases: number;
  reach: number;
  unit: PredictionUnit | null;
}): number | null {
  const denom =
    input.unit === "purchase"
      ? input.purchases
      : input.unit === "view"
        ? input.reach / 1000
        : input.regs;
  if (denom <= 0 || input.spend < 0) return null;
  return Math.round((input.spend / denom) * 100) / 100;
}

export async function loadPlanWindowActual(
  supabase: unknown,
  input: { eventId: string; sinceDate?: string | null; unit: PredictionUnit | null },
): Promise<number | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;
  let query = client
    .from("event_daily_rollups")
    .select("ad_spend, tiktok_spend, google_ads_spend, meta_regs, meta_purchases, meta_reach")
    .eq("event_id", input.eventId);
  if (input.sinceDate) query = query.gte("date", input.sinceDate);
  const { data, error } = await query;
  if (error || !data || data.length === 0) return null;
  const totals = (data as Array<Record<string, unknown>>).reduce<{
    spend: number;
    regs: number;
    purchases: number;
    reach: number;
  }>(
    (sum, row) => ({
      spend:
        sum.spend +
        Number(row.ad_spend ?? 0) +
        Number(row.tiktok_spend ?? 0) +
        Number(row.google_ads_spend ?? 0),
      regs: sum.regs + Number(row.meta_regs ?? 0),
      purchases: sum.purchases + Number(row.meta_purchases ?? 0),
      reach: sum.reach + Number(row.meta_reach ?? 0),
    }),
    { spend: 0, regs: 0, purchases: 0, reach: 0 },
  );
  return planWindowActual({ ...totals, unit: input.unit });
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
