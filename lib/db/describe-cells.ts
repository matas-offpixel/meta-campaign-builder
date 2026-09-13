/**
 * One client-bounded read for Phase 1 describe.
 * launched_ad_sets by client_id, then campaign_automation_decisions
 * on those meta_adset_id values. Two selects, one surface.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildDescribeCells,
  type DescribeCell,
  type DescribeDecisionPoint,
  type DescribeLaunchedRow,
} from "@/lib/optimisation/describe-cells";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

function anySb(supabase: SupabaseClient): AnySupabase {
  return supabase as unknown as AnySupabase;
}

interface LaunchedRow {
  meta_adset_id: string;
  draft_id: string | null;
  meta_campaign_id: string | null;
  source_type: string | null;
  objective: string | null;
  phase_at_launch: string | null;
  advantage_plus_effective: boolean | null;
  descriptor_source: string | null;
  initial_daily_budget_pence: number | null;
  launched_at: string;
}

interface DecisionRow {
  adset_id: string;
  metric: string | null;
  metric_value: number | string | null;
  decided_at: string;
}

export async function loadDescribeCellsForClients(
  supabase: SupabaseClient,
  clientIds: string[],
  now: Date = new Date(),
): Promise<DescribeCell[]> {
  const ids = [...new Set(clientIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const sb = anySb(supabase);
  const { data: launched, error: launchedErr } = await sb
    .from("launched_ad_sets")
    .select(
      "meta_adset_id, draft_id, meta_campaign_id, source_type, objective, phase_at_launch, advantage_plus_effective, descriptor_source, initial_daily_budget_pence, launched_at",
    )
    .in("client_id", ids);
  if (launchedErr) {
    console.error(`[describe-cells] launched_ad_sets read failed: ${launchedErr.message}`);
    return [];
  }

  const launchedRows = (launched ?? []) as LaunchedRow[];
  const mapped: DescribeLaunchedRow[] = launchedRows.map((row) => ({
    metaAdsetId: row.meta_adset_id,
    draftId: row.draft_id,
    metaCampaignId: row.meta_campaign_id,
    sourceType: row.source_type,
    objective: row.objective,
    phaseAtLaunch: row.phase_at_launch,
    advantagePlusEffective: row.advantage_plus_effective,
    descriptorSource: row.descriptor_source,
    initialDailyBudgetPence: row.initial_daily_budget_pence,
    launchedAt: row.launched_at,
  }));

  const adsetIds = [...new Set(mapped.map((row) => row.metaAdsetId).filter(Boolean))];
  const points: DescribeDecisionPoint[] = [];
  if (adsetIds.length > 0) {
    const { data: decisions, error: decisionErr } = await sb
      .from("campaign_automation_decisions")
      .select("adset_id, metric, metric_value, decided_at")
      .in("adset_id", adsetIds);
    if (decisionErr) {
      console.error(`[describe-cells] decisions read failed: ${decisionErr.message}`);
    } else {
      for (const row of (decisions ?? []) as DecisionRow[]) {
        const raw = row.metric_value;
        const value = typeof raw === "number" ? raw : raw != null ? Number(raw) : null;
        points.push({
          metaAdsetId: row.adset_id,
          metric: row.metric,
          metricValue: value != null && Number.isFinite(value) ? value : null,
          decidedAt: row.decided_at,
        });
      }
    }
  }

  return buildDescribeCells(mapped, points, now);
}
