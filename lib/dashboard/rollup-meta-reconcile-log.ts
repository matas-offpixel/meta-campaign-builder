import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Canonical 4theFans roster client — same UUID as `4thefans-allocation-import`. */
export const FOURTHEFANS_CLIENT_ID =
  "37906506-56b7-4d58-ab62-1b042e2b561a";

const DRIFT_WARN_GBP = 100;
const DEFAULT_TOP_N = 5;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function extractDriftGbp(payload: unknown): number | null {
  if (payload == null) return null;
  const rows = Array.isArray(payload) ? payload : [payload];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const [key, val] of Object.entries(row)) {
      if (!/drift/i.test(key)) continue;
      const n = Number(val);
      if (Number.isFinite(n)) return Math.abs(n);
    }
  }
  return null;
}

/**
 * After a rollup-sync cron batch, compare dashboard rollups vs Meta for the
 * highest-spend events (read-only audit RPC). Logs `console.warn` when drift
 * exceeds £100 so operators can spot regressions in logs during rollout.
 */
export async function warnMetaReconcileDriftForTopRollupEvents(
  supabase: SupabaseClient,
  opts?: {
    clientId?: string;
    since?: string;
    until?: string;
    limit?: number;
  },
): Promise<void> {
  const clientId = opts?.clientId ?? FOURTHEFANS_CLIENT_ID;
  const until = opts?.until ?? ymd(new Date());
  const since =
    opts?.since ??
    ymd(new Date(Date.now() - 89 * 24 * 60 * 60 * 1000));
  const limit = opts?.limit ?? DEFAULT_TOP_N;

  const { data: events, error: evErr } = await supabase
    .from("events")
    .select("id, event_code")
    .eq("client_id", clientId)
    .not("event_code", "is", null);

  if (evErr || !events?.length) {
    console.warn(
      `[rollup-meta-reconcile] skip load events: ${evErr?.message ?? "empty"}`,
    );
    return;
  }

  const codeById = new Map(
    events.map((e) => [e.id as string, e.event_code as string]),
  );
  const ids = [...codeById.keys()];

  const totals = new Map<string, number>();
  const chunk = 120;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const { data: rollups, error: rErr } = await supabase
      .from("event_daily_rollups")
      .select("event_id, ad_spend, ad_spend_presale")
      .in("event_id", slice)
      .gte("date", since)
      .lte("date", until);

    if (rErr) {
      console.warn(`[rollup-meta-reconcile] rollup query: ${rErr.message}`);
      return;
    }
    for (const row of rollups ?? []) {
      const id = row.event_id as string;
      const raw =
        Number(row.ad_spend ?? 0) + Number(row.ad_spend_presale ?? 0);
      totals.set(id, (totals.get(id) ?? 0) + raw);
    }
  }

  const topIds = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);

  const rpc = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };

  const argVariants = (
    code: string,
  ): Record<string, unknown>[] => [
    { event_code: code, range_start: since, range_end: until },
    { p_event_code: code, p_since: since, p_until: until },
    { event_code: code, since, until },
  ];

  for (const eventId of topIds) {
    const eventCode = codeById.get(eventId);
    if (!eventCode) continue;

    let data: unknown;
    let rpcOk = false;
    for (const args of argVariants(eventCode)) {
      const res = await rpc.rpc("meta_reconcile_event_spend", args);
      if (!res.error) {
        data = res.data;
        rpcOk = true;
        break;
      }
    }
    if (!rpcOk) continue;

    const drift = extractDriftGbp(data);
    if (drift != null && drift > DRIFT_WARN_GBP) {
      console.warn(
        `[rollup-meta-reconcile] drift £${drift.toFixed(2)} for ${eventCode} (${since}..${until})`,
      );
    }
  }
}
