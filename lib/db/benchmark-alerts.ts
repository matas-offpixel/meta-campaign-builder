import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert, TablesUpdate } from "@/lib/db/database.types";

export type BenchmarkAlertRow = Tables<"benchmark_alerts">;
export type BenchmarkAlertInsert = TablesInsert<"benchmark_alerts">;
export type BenchmarkAlertUpdate = TablesUpdate<"benchmark_alerts">;

export async function listOpenBenchmarkAlerts(
  supabase: SupabaseClient<Database>,
  userId: string,
  limit: number,
): Promise<BenchmarkAlertRow[]> {
  const { data, error } = await supabase
    .from("benchmark_alerts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "open")
    .order("surfaced_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[benchmark-alerts] listOpenBenchmarkAlerts", error.message);
    return [];
  }
  return (data ?? []) as BenchmarkAlertRow[];
}

export async function updateBenchmarkAlertStatus(
  supabase: SupabaseClient<Database>,
  args: { userId: string; id: string; status: "acknowledged" | "dismissed" },
): Promise<{ ok: boolean; error?: string }> {
  const patch: BenchmarkAlertUpdate =
    args.status === "acknowledged"
      ? { status: "acknowledged", acknowledged_at: new Date().toISOString() }
      : { status: "dismissed", acknowledged_at: null };
  const { data, error } = await supabase
    .from("benchmark_alerts")
    .update(patch)
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Not found or already handled" };
  return { ok: true };
}
