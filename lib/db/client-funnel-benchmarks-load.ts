import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveClientFunnelBenchmarks,
  seedClientFunnelBenchmarks,
  type ClientFunnelBenchmarkSet,
} from "@/lib/dashboard/client-funnel-benchmarks";

function tableMissing(error: { code?: string; message?: string } | null): boolean {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    message.includes("client_funnel_benchmarks")
  );
}

/**
 * Additive read: table absent or empty → seed 15/50/5, provenance seed.
 * No learning job.
 */
export async function loadClientFunnelBenchmarks(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientFunnelBenchmarkSet> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("client_funnel_benchmarks")
    .select("stage, rate, n, confidence, provenance, updated_at")
    .eq("client_id", clientId);

  if (error) {
    if (!tableMissing(error)) {
      console.warn("[client-funnel-benchmarks] read failed", error.message);
    }
    return seedClientFunnelBenchmarks();
  }

  return resolveClientFunnelBenchmarks(
    (data ?? []) as Array<{
      stage?: string | null;
      rate?: number | null;
      n?: number | null;
      confidence?: number | null;
      provenance?: string | null;
      updated_at?: string | null;
    }>,
  );
}
