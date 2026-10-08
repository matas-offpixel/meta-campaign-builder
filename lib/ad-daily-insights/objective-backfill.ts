/**
 * Backfill of ad_daily_insights.campaign_objective / optimization_goal /
 * promoted_event (migration 187) for rows written before the cron asked
 * for them. Driven by scripts/backfill-insights-objective.mts.
 *
 * Per ad account: the distinct meta_adset_id still missing a field the
 * stage needs (no campaign_objective, or a sales conversion ad set with
 * no promoted_event), read in batches of ≤50 with one attempt each, then
 * one UPDATE per ad set by meta_adset_id and ad_account_id. `plan` calls nothing; `fetch`
 * reads Meta and writes nothing; `apply` writes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { metaObjectiveNeedsPromotedEvent } from "../launched-ad-sets/snapshot.ts";
import { ADSET_BATCH, fetchAdSetMeta, type AdSetMeta } from "./adset-meta.ts";
import type { GraphGet } from "./fetch.ts";
import { loadClientAdAccounts } from "./runner.ts";

export const OBJECTIVE_BACKFILL_FIELDS = "campaign{objective},optimization_goal,promoted_object";

/** Rate-limit and auth codes: stop the run rather than burn more calls. */
const STOP_CODES = new Set([4, 17, 32, 190, 613, 80004]);
const PAGE = 1000;

export type ObjectiveBackfillMode = "plan" | "fetch" | "apply";

type StoredRow = {
  meta_adset_id: string;
  campaign_objective?: string | null;
  optimization_goal?: string | null;
  promoted_event?: string | null;
};

export type ObjectiveBackfillResult = {
  plan: { adAccountId: string; adSetIds: string[]; calls: number }[];
  plannedCalls: number;
  metaCalls: number;
  failedBatches: number;
  errors: string[];
  stopped: boolean;
  found: Map<string, AdSetMeta & { adAccountId: string }>;
  updated: number;
};

/**
 * Accounts to backfill: every active-client account (`loadClientAdAccounts`,
 * archived excluded), or just `only` when it is one of them. An archived
 * client's account, or one no client uses, is refused.
 */
export async function backfillAccounts(db: SupabaseClient, only: string | null): Promise<string[]> {
  const { accounts } = await loadClientAdAccounts(db);
  if (!only) return accounts;
  if (!accounts.includes(only)) {
    throw new Error(`${only} is not an active client's ad account (archived or unknown); refusing`);
  }
  return [only];
}

/** Distinct ad sets on the account still missing a field the stage needs. */
export async function adSetsToFill(db: SupabaseClient, adAccountId: string, has187: boolean): Promise<string[]> {
  const columns = has187 ? "meta_adset_id, campaign_objective, optimization_goal, promoted_event" : "meta_adset_id";
  const done = new Set<string>();
  const all = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("ad_daily_insights")
      .select(columns)
      .eq("ad_account_id", adAccountId)
      .not("meta_adset_id", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`ad_daily_insights ${adAccountId}: ${error.message}`);
    const rows = (data ?? []) as unknown as StoredRow[];
    for (const row of rows) {
      all.add(row.meta_adset_id);
      const complete =
        !!row.campaign_objective &&
        (!!row.promoted_event || !metaObjectiveNeedsPromotedEvent(row.campaign_objective, row.optimization_goal));
      if (complete) done.add(row.meta_adset_id);
    }
    if (rows.length < PAGE) break;
  }
  return [...all].filter((id) => !done.has(id)).sort();
}

export async function runObjectiveBackfill(deps: {
  db: SupabaseClient;
  graphGet: GraphGet;
  accounts: readonly string[];
  mode: ObjectiveBackfillMode;
  /** False before migration 187: every ad set counts as missing. */
  has187: boolean;
}): Promise<ObjectiveBackfillResult> {
  if (deps.mode === "apply" && !deps.has187) {
    throw new Error("apply needs migration 187 (ad_daily_insights.promoted_event is missing)");
  }
  const plan: ObjectiveBackfillResult["plan"] = [];
  for (const adAccountId of deps.accounts) {
    const adSetIds = await adSetsToFill(deps.db, adAccountId, deps.has187);
    plan.push({ adAccountId, adSetIds, calls: Math.ceil(adSetIds.length / ADSET_BATCH) });
  }
  const result: ObjectiveBackfillResult = {
    plan,
    plannedCalls: plan.reduce((n, p) => n + p.calls, 0),
    metaCalls: 0,
    failedBatches: 0,
    errors: [],
    stopped: false,
    found: new Map(),
    updated: 0,
  };
  if (deps.mode === "plan") return result;

  outer: for (const { adAccountId, adSetIds } of plan) {
    for (let start = 0; start < adSetIds.length; start += ADSET_BATCH) {
      const fetched = await fetchAdSetMeta(deps.graphGet, adSetIds.slice(start, start + ADSET_BATCH), OBJECTIVE_BACKFILL_FIELDS);
      result.metaCalls += fetched.calls;
      if (fetched.error) {
        result.failedBatches++;
        result.errors.push(`${adAccountId} batch ${start / ADSET_BATCH + 1}: ${fetched.error}`);
        if (fetched.code !== undefined && STOP_CODES.has(fetched.code)) {
          result.stopped = true;
          break outer;
        }
        continue;
      }
      for (const [id, meta] of fetched.meta) {
        result.found.set(id, { ...meta, adAccountId });
        if (deps.mode !== "apply") continue;
        const { error } = await deps.db
          .from("ad_daily_insights")
          .update({
            campaign_objective: meta.campaignObjective,
            optimization_goal: meta.optimizationGoal,
            promoted_event: meta.promotedEvent,
          })
          .eq("meta_adset_id", id)
          .eq("ad_account_id", adAccountId);
        if (error) result.errors.push(`update ${id}: ${error.message}`);
        else result.updated++;
      }
    }
  }
  return result;
}
