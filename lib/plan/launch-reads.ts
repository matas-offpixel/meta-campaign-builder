/**
 * LAUNCH reads — rollup days over the plan window and view rows for
 * `planBenchmark`. Pure mapping stays in launch-face; this file talks
 * to Supabase.
 */

import { BENCHMARK_VIEW, type BenchmarkRow } from "./benchmarks.ts";
import type { LaunchRollupDay } from "./launch-face.ts";

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function rollupDayFromRow(row: Record<string, unknown>): LaunchRollupDay {
  return {
    date: String(row.date ?? ""),
    ad_spend: num(row.ad_spend),
    meta_regs: num(row.meta_regs),
    meta_purchases: num(row.meta_purchases),
    meta_reach: num(row.meta_reach),
    tiktok_spend: num(row.tiktok_spend),
    tiktok_results: num(row.tiktok_results),
    google_ads_spend: num(row.google_ads_spend),
    google_ads_conversions: num(row.google_ads_conversions),
  };
}

export async function loadLaunchRollupDays(
  supabase: unknown,
  eventId: string,
  window: { from: string; to: string },
): Promise<LaunchRollupDay[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;
  const { data, error } = await client
    .from("event_daily_rollups")
    .select(
      "date, ad_spend, meta_regs, meta_purchases, meta_reach, tiktok_spend, tiktok_results, google_ads_spend, google_ads_conversions",
    )
    .eq("event_id", eventId)
    .gte("date", window.from)
    .lte("date", window.to);
  if (error) {
    console.warn("[launch-reads] rollup window failed", error.message);
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map(rollupDayFromRow);
}

export async function loadPlanBenchmarkRows(
  supabase: unknown,
  input: { clientId: string; venueKey: string },
): Promise<BenchmarkRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;
  const { data, error } = await client
    .from(BENCHMARK_VIEW)
    .select("client_id, venue_key, event_id, event_code, event_date, unit, channel, cost")
    .eq("client_id", input.clientId)
    .eq("venue_key", input.venueKey);
  if (error) {
    console.warn("[launch-reads] benchmark view failed", error.message);
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    client_id: String(row.client_id ?? ""),
    venue_key: String(row.venue_key ?? ""),
    event_id: String(row.event_id ?? ""),
    event_code: String(row.event_code ?? ""),
    event_date: row.event_date == null ? null : String(row.event_date),
    unit: String(row.unit ?? ""),
    channel: String(row.channel ?? ""),
    cost: num(row.cost),
  }));
}
