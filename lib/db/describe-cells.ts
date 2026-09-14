/**
 * One client-bounded read for Phase 1 describe.
 * launched_ad_sets by client_id (paged), then latest non-null
 * decision per armed ad set. Two selects. A failed read is
 * unreadable, not empty.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildDescribeCells,
  type DescribeCell,
  type DescribeDecisionPoint,
  type DescribeLaunchedRow,
} from "../optimisation/describe-cells.ts";

/**
 * Must equal the PostgREST max-rows project setting. If that setting
 * drops below this, page one comes back short and both loops stop.
 */
export const DESCRIBE_PAGE_SIZE = 1000;

/** A loop that stops only because data is finite is not bounded. */
export const DESCRIBE_MAX_PAGES = 20;

export type DescribeLoadResult =
  | { status: "ok"; cells: DescribeCell[]; launched: DescribeLaunchedRow[] }
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
  client_id: string | null;
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
  "client_id, meta_adset_id, draft_id, meta_campaign_id, source_type, objective, phase_at_launch, advantage_plus_effective, descriptor_source, initial_daily_budget_pence, launched_at";

const DECISION_SELECT = "adset_id, metric, metric_value, decided_at";

const ADSET_IN_CHUNK = 100;

export async function loadDescribeCellsForClients(
  supabase: SupabaseClient,
  clientIds: string[],
  opts?: { now?: Date; viewer?: DescribeViewer; armedDraftIds?: string[] },
): Promise<DescribeLoadResult> {
  const ids = [...new Set(clientIds.filter(Boolean))];
  if (ids.length === 0) return { status: "ok", cells: [], launched: [] };

  const sb = anySb(supabase);
  const launched = await pageLaunchedAdSets(sb, ids, opts?.viewer);
  if (launched.status === "unreadable") return launched;

  const mapped: DescribeLaunchedRow[] = launched.rows.map((row) => ({
    clientId: row.client_id || "unknown",
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

  const armedDraftIds = [...new Set((opts?.armedDraftIds ?? []).filter(Boolean))];
  const armedDraftSet = new Set(armedDraftIds);
  const armedAdSets = [
    ...new Map(
      mapped
        .filter((row) => row.draftId && armedDraftSet.has(row.draftId))
        .map((row) => [row.metaAdsetId, row.draftId as string]),
    ),
  ].map(([metaAdsetId, draftId]) => ({ metaAdsetId, draftId }));

  const decisions = await pageLatestDecisions(sb, armedAdSets);
  if (decisions.status === "unreadable") return decisions;

  return {
    status: "ok",
    cells: buildDescribeCells(mapped, decisions.points, opts?.now ?? new Date()),
    launched: mapped,
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
  for (let page = 0; ; page++) {
    if (page >= DESCRIBE_MAX_PAGES) {
      console.error(
        `[describe-cells] launched_ad_sets page cap ${DESCRIBE_MAX_PAGES} hit`,
      );
      return { status: "unreadable" };
    }
    const from = page * DESCRIBE_PAGE_SIZE;
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
    const batch = (data ?? []) as LaunchedRow[];
    rows.push(...batch);
    if (batch.length < DESCRIBE_PAGE_SIZE) break;
  }
  return { status: "ok", rows };
}

/**
 * Latest non-null metric per armed ad set. Order decided_at desc, id
 * desc, and page until every ad set in the chunk has a non-null hit
 * (or the pages run out / the cap is hit).
 *
 * Only armed drafts are queried — decisions do not exist for the
 * rest, and Phase 0 records every launch, so never-ticked is the
 * permanent state of most rows. Filtering them out is the bound.
 *
 * Why page, not a DISTINCT ON / view: that needs a migration.
 * Why not N × limit(1): keeps the two-select cost story. Existing
 * index is (adset_id, decided_at desc). A filter on draft_id wants
 * (draft_id, adset_id, decided_at desc). Not adding it.
 */
async function pageLatestDecisions(
  sb: AnySupabase,
  armedAdSets: Array<{ metaAdsetId: string; draftId: string }>,
): Promise<{ status: "ok"; points: DescribeDecisionPoint[] } | { status: "unreadable" }> {
  if (armedAdSets.length === 0) return { status: "ok", points: [] };

  const latest = new Map<string, DescribeDecisionPoint>();
  for (let i = 0; i < armedAdSets.length; i += ADSET_IN_CHUNK) {
    const chunk = armedAdSets.slice(i, i + ADSET_IN_CHUNK);
    const adsetIds = chunk.map((row) => row.metaAdsetId);
    const draftIds = [...new Set(chunk.map((row) => row.draftId))];
    const need = new Set(adsetIds);
    for (let page = 0; need.size > 0; page++) {
      if (page >= DESCRIBE_MAX_PAGES) {
        console.error(
          `[describe-cells] campaign_automation_decisions page cap ${DESCRIBE_MAX_PAGES} hit`,
        );
        return { status: "unreadable" };
      }
      const from = page * DESCRIBE_PAGE_SIZE;
      const { data, error } = await sb
        .from("campaign_automation_decisions")
        .select(DECISION_SELECT)
        .in("adset_id", adsetIds)
        .in("draft_id", draftIds)
        .order("decided_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + DESCRIBE_PAGE_SIZE - 1);
      if (error) {
        console.error(`[describe-cells] decisions read failed: ${error.message}`);
        return { status: "unreadable" };
      }
      const batch = (data ?? []) as DecisionRow[];
      for (const row of batch) {
        if (!need.has(row.adset_id)) continue;
        const point = pointIfMetric(row);
        if (!point) continue;
        need.delete(row.adset_id);
        latest.set(row.adset_id, point);
      }
      if (batch.length < DESCRIBE_PAGE_SIZE) break;
    }
  }
  return { status: "ok", points: [...latest.values()] };
}

function pointIfMetric(row: DecisionRow): DescribeDecisionPoint | null {
  const raw = row.metric_value;
  const value = typeof raw === "number" ? raw : raw != null ? Number(raw) : null;
  if (value == null || !Number.isFinite(value)) return null;
  if (!row.metric?.trim()) return null;
  return {
    metaAdsetId: row.adset_id,
    metric: row.metric,
    metricValue: value,
    decidedAt: row.decided_at,
  };
}
