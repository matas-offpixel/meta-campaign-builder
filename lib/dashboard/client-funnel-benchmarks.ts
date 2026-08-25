import { EVENT_FUNNEL_SEEDS } from "./event-funnel.ts";

export const CLIENT_FUNNEL_BENCHMARK_STAGES = [
  "reach_to_click",
  "click_to_lpv",
  "lpv_to_purchase",
] as const;

export type ClientFunnelBenchmarkStage =
  (typeof CLIENT_FUNNEL_BENCHMARK_STAGES)[number];

export const CLIENT_FUNNEL_BENCHMARK_PROVENANCES = [
  "seed",
  "learned",
  "manually-overridden",
] as const;

export type ClientFunnelBenchmarkProvenance =
  (typeof CLIENT_FUNNEL_BENCHMARK_PROVENANCES)[number];

export interface ClientFunnelBenchmarkRow {
  stage: ClientFunnelBenchmarkStage;
  rate: number;
  n: number;
  confidence: number | null;
  provenance: ClientFunnelBenchmarkProvenance;
  updatedAt: string | null;
}

export type ClientFunnelBenchmarkSet = Record<
  ClientFunnelBenchmarkStage,
  ClientFunnelBenchmarkRow
>;

export const CLIENT_FUNNEL_SEED_RATES: Record<
  ClientFunnelBenchmarkStage,
  number
> = {
  reach_to_click: EVENT_FUNNEL_SEEDS.reachToClick,
  click_to_lpv: EVENT_FUNNEL_SEEDS.clickToLpv,
  lpv_to_purchase: EVENT_FUNNEL_SEEDS.lpvToPurchase,
};

function seedRow(stage: ClientFunnelBenchmarkStage): ClientFunnelBenchmarkRow {
  return {
    stage,
    rate: CLIENT_FUNNEL_SEED_RATES[stage],
    n: 0,
    confidence: null,
    provenance: "seed",
    updatedAt: null,
  };
}

export function seedClientFunnelBenchmarks(): ClientFunnelBenchmarkSet {
  return {
    reach_to_click: seedRow("reach_to_click"),
    click_to_lpv: seedRow("click_to_lpv"),
    lpv_to_purchase: seedRow("lpv_to_purchase"),
  };
}

export function isClientFunnelBenchmarkStage(
  value: string,
): value is ClientFunnelBenchmarkStage {
  return (CLIENT_FUNNEL_BENCHMARK_STAGES as readonly string[]).includes(value);
}

export function isClientFunnelBenchmarkProvenance(
  value: string,
): value is ClientFunnelBenchmarkProvenance {
  return (CLIENT_FUNNEL_BENCHMARK_PROVENANCES as readonly string[]).includes(
    value,
  );
}

/**
 * Merge stored rows onto the seed set. Missing / invalid stages stay seed.
 * Learned rows never appear unless the caller actually supplied them.
 */
export function resolveClientFunnelBenchmarks(
  rows: Array<{
    stage?: string | null;
    rate?: number | null;
    n?: number | null;
    confidence?: number | null;
    provenance?: string | null;
    updated_at?: string | null;
  }> | null,
): ClientFunnelBenchmarkSet {
  const resolved = seedClientFunnelBenchmarks();
  for (const row of rows ?? []) {
    if (!row.stage || !isClientFunnelBenchmarkStage(row.stage)) continue;
    if (!row.provenance || !isClientFunnelBenchmarkProvenance(row.provenance)) {
      continue;
    }
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) continue;
    resolved[row.stage] = {
      stage: row.stage,
      rate,
      n: Number.isFinite(Number(row.n)) ? Math.max(0, Number(row.n)) : 0,
      confidence:
        row.confidence == null || !Number.isFinite(Number(row.confidence))
          ? null
          : Number(row.confidence),
      provenance: row.provenance,
      updatedAt: row.updated_at ?? null,
    };
  }
  return resolved;
}
