/**
 * One client-bounded read for Phase 1 describe.
 * launched_ad_sets by client_id (paged), then latest decision per
 * ad set. Two selects. A failed read is unreadable, not empty.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildDescribeCells,
  type DescribeCell,
  type DescribeDecisionPoint,
  type DescribeLaunchedRow,
} from "../optimisation/describe-cells.ts";

export const DESCRIBE_PAGE_SIZE = 1000;

export type DescribeLoadResult =
  | { status: "ok"; cells: DescribeCell[] }
  | { status: "unreadable" };

export type DescribeViewer = {
  userId: string;
  isOperator: boolean;
};

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

const LAUNCHED_SELECT =
  "meta_adset_id, draft_id, meta_campaign_id, source_type, objective, phase_at_launch, advantage_plus_effective, descriptor_source, initial_daily_budget_pence, launched_at";

const DECISION_SELECT = "adset_id, metric, metric_value, decided_at";

const ADSET_IN_CHUNK = 100;

export async function loadDescribeCellsForClients(
  supabase: SupabaseClient,
  clientIds: string[],
  opts?: { now?: Date; viewer?: DescribeViewer },
): Promise<DescribeLoadResult> {
  const ids = [...new Set(clientIds.filter(Boolean))];
  if (ids.length === 0) return { status: "ok", cells: [] };

  const sb = anySb(supabase);
  const launched = await pageLaunchedAdSets(sb, ids, opts?.viewer);
  if (launched.status === "unreadable") return launched;

  const mapped: DescribeLaunchedRow[] = launched.rows.map((row) => ({
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
  const decisions = await pageLatestDecisions(sb, adsetIds);
  if (decisions.status === "unreadable") return decisions;

  return {
    status: "ok",
    cells: buildDescribeCells(mapped, decisions.points, opts?.now ?? new Date()),
  };
}

/**
 * Page launched_ad_sets with .range(). PostgREST caps an unbounded
 * select at 1,000; order by meta_adset_id so pages do not skip.
 */
async function pageLaunchedAdSets(
  sb: AnySupabase,
  clientIds: string[],
  viewer: DescribeViewer | undefined,
): Promise<{ status: "ok"; rows: LaunchedRow[] } | { status: "unreadable" }> {
  const rows: LaunchedRow[] = [];
  for (let from = 0; ; from += DESCRIBE_PAGE_SIZE) {
    let q = sb
      .from("launched_ad_sets")
      .select(LAUNCHED_SELECT)
      .in("client_id", clientIds);
    if (viewer && !viewer.isOperator) {
      q = q.eq("user_id", viewer.userId);
    }
    const { data, error } = await q
      .order("meta_adset_id", { ascending: true })
      .range(from, from + DESCRIBE_PAGE_SIZE - 1);
    if (error) {
      console.error(`[describe-cells] launched_ad_sets read failed: ${error.message}`);
      return { status: "unreadable" };
    }
    const page = (data ?? []) as LaunchedRow[];
    rows.push(...page);
    if (page.length < DESCRIBE_PAGE_SIZE) break;
  }
  return { status: "ok", rows };
}

/**
 * Latest decision per ad set. Order decided_at desc and page until
 * every ad set in the batch has a hit (or the pages run out).
 *
 * Why page, not a DISTINCT ON / view: that needs a migration.
 * Why not N × limit(1): keeps the two-select cost story. The index
 * on (adset_id, decided_at desc) covers per-adset order, not a
 * global decided_at sort across an IN list. If paging slows, the
 * missing index is (decided_at desc) or a latest-per-adset view.
 * Not adding it.
 */
async function pageLatestDecisions(
  sb: AnySupabase,
  adsetIds: string[],
): Promise<{ status: "ok"; points: DescribeDecisionPoint[] } | { status: "unreadable" }> {
  if (adsetIds.length === 0) return { status: "ok", points: [] };

  const latest = new Map<string, DescribeDecisionPoint>();
  for (let i = 0; i < adsetIds.length; i += ADSET_IN_CHUNK) {
    const chunk = adsetIds.slice(i, i + ADSET_IN_CHUNK);
    const need = new Set(chunk);
    for (let from = 0; need.size > 0; from += DESCRIBE_PAGE_SIZE) {
      const { data, error } = await sb
        .from("campaign_automation_decisions")
        .select(DECISION_SELECT)
        .in("adset_id", chunk)
        .order("decided_at", { ascending: false })
        .range(from, from + DESCRIBE_PAGE_SIZE - 1);
      if (error) {
        console.error(`[describe-cells] decisions read failed: ${error.message}`);
        return { status: "unreadable" };
      }
      const page = (data ?? []) as DecisionRow[];
      for (const row of page) {
        if (!need.has(row.adset_id)) continue;
        need.delete(row.adset_id);
        latest.set(row.adset_id, toPoint(row));
      }
      if (page.length < DESCRIBE_PAGE_SIZE) break;
    }
  }
  return { status: "ok", points: [...latest.values()] };
}

function toPoint(row: DecisionRow): DescribeDecisionPoint {
  const raw = row.metric_value;
  const value = typeof raw === "number" ? raw : raw != null ? Number(raw) : null;
  return {
    metaAdsetId: row.adset_id,
    metric: row.metric,
    metricValue: value != null && Number.isFinite(value) ? value : null,
    decidedAt: row.decided_at,
  };
}
