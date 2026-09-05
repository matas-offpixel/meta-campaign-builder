/**
 * lib/db/optimisation-decisions.ts
 *
 * Applied-write lookups for task #120 PR B: cooldown clock
 * (`max(applied_at)` vs `decided_at`) and the rolling-24h sum of applied
 * positive `action_delta` percents used by `maxDailyIncreasePercent`.
 *
 * Thin Supabase adapter — the pure runner never imports this file.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { BUDGET_CHANGE_ACTIONS } from "@/lib/optimisation/evaluate";
import type { AdSetAutomationState } from "@/lib/optimisation/tick-runner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

function anySb(supabase: SupabaseClient): AnySupabase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as unknown as any;
}

/**
 * Last applied write + last CHANGE decision + sum of applied positive
 * deltas since `sinceISO` for one ad set. `lastDecidedAt` is the latest
 * scale_up / scale_down / pause only — maintain and skip_* never start
 * cooldown.
 */
export async function getAdSetAutomationState(
  supabase: SupabaseClient,
  adsetId: string,
  sinceISO: string,
): Promise<AdSetAutomationState> {
  const sb = anySb(supabase);

  const { data: appliedRows, error: appliedErr } = await sb
    .from("campaign_automation_decisions")
    .select("applied_at")
    .eq("adset_id", adsetId)
    .eq("applied", true)
    .not("applied_at", "is", null)
    .order("applied_at", { ascending: false })
    .limit(1);

  if (appliedErr) {
    throw new Error(`getAdSetAutomationState applied lookup failed: ${appliedErr.message}`);
  }

  const { data: decidedRows, error: decidedErr } = await sb
    .from("campaign_automation_decisions")
    .select("decided_at")
    .eq("adset_id", adsetId)
    .in("action_recommended", [...BUDGET_CHANGE_ACTIONS])
    .order("decided_at", { ascending: false })
    .limit(1);

  if (decidedErr) {
    throw new Error(`getAdSetAutomationState decided lookup failed: ${decidedErr.message}`);
  }

  const { data: deltaRows, error: deltaErr } = await sb
    .from("campaign_automation_decisions")
    .select("action_delta")
    .eq("adset_id", adsetId)
    .eq("applied", true)
    .gt("applied_at", sinceISO)
    .gt("action_delta", 0);

  if (deltaErr) {
    throw new Error(`getAdSetAutomationState daily-increase sum failed: ${deltaErr.message}`);
  }

  const lastAppliedAtRaw = appliedRows?.[0]?.applied_at as string | null | undefined;
  const lastDecidedAtRaw = decidedRows?.[0]?.decided_at as string | null | undefined;
  const appliedIncreasePercentLast24h = (deltaRows ?? []).reduce(
    (sum: number, row: { action_delta: number | null }) =>
      sum + (typeof row.action_delta === "number" ? row.action_delta : Number(row.action_delta) || 0),
    0,
  );

  return {
    lastAppliedAt: lastAppliedAtRaw ? new Date(lastAppliedAtRaw) : null,
    lastDecidedAt: lastDecidedAtRaw ? new Date(lastDecidedAtRaw) : null,
    appliedIncreasePercentLast24h,
  };
}
