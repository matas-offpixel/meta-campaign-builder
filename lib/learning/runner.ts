/**
 * Learning loop B — nightly learning refresh, DB-only, zero Meta calls.
 *
 * Loads facts once (lib/learning/joins.ts), then runs five jobs that
 * each log their rows and fail alone:
 *   1. creative_scores           (lib/learning/creative-scores.ts)
 *   2. tag_performance           (lib/learning/tag-performance.ts)
 *   3. client_funnel_benchmarks  (lib/learning/funnel-benchmarks.ts)
 *   4. interest_clusters.live_evidence (lib/learning/interest-evidence.ts)
 *   5. copy_performance            (lib/learning/copy-performance.ts)
 * `dryRun` computes everything and writes nothing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { OPERATOR_EMAIL } from "../analysis/cluster-seed-sql.ts";
import { logSkippedArchivedClients } from "../db/client-status.ts";
import { computeCreativeScores, writeCreativeScores } from "./creative-scores.ts";
import { computeFunnelBenchmarks, writeFunnelBenchmarks, type FunnelBenchmarkRow, type FunnelSkip } from "./funnel-benchmarks.ts";
import { computeLiveEvidence, loadOperatorClusters, writeLiveEvidence, type LiveEvidence } from "./interest-evidence.ts";
import {
  joinRates,
  loadLearningInputs,
  STAGE_SOURCES,
  type JoinRate,
  type LearningInputs,
  type LoadLearningOptions,
  type Stage,
  type StageSource,
} from "./joins.ts";
import { computeCopyPerformance, loadCopyLibrary, scopeCounts, writeCopyPerformance, type CopyLibrary } from "./copy-performance.ts";
import { passesCopyMinimum, type CopyPerformanceRow } from "./copy/score.ts";
import { computeTagPerformance, TAG_WINDOW_DAYS, windowStart, writeTagPerformance, type TagPerformanceRow } from "./tag-performance.ts";

export function isLearningRefreshEnabled(env: Record<string, string | undefined>): boolean {
  return env.ENABLE_LEARNING_REFRESH === "1";
}

export type LearningJobName = "creative_scores" | "tag_performance" | "client_funnel_benchmarks" | "interest_live_evidence" | "copy_performance";
export const LEARNING_JOBS: readonly LearningJobName[] = [
  "creative_scores",
  "tag_performance",
  "client_funnel_benchmarks",
  "interest_live_evidence",
  "copy_performance",
];

export type JobOutcome = { ok: boolean; rows: number; detail?: Record<string, unknown>; error?: string };

export type LearningRefreshResult =
  | { ok: true; skippedReason: "killswitch" }
  | {
      ok: boolean;
      dryRun: boolean;
      jobs: Record<LearningJobName, JobOutcome>;
      adDays: number;
      dropped: LearningInputs["dropped"];
      joinRates: Record<string, JoinRate>;
      /** Ad-days per client per stage. */
      stages: Record<string, Record<Stage, number>>;
      /** Ad-days per client by where the stage came from. */
      stageSources: Record<string, Record<StageSource, number>>;
      /** GBP spend per client, all ad-days and those with stage 'unknown'. */
      spend: Record<string, { total: number; unknown: number }>;
      /** Ticket-sale result per client in the 90-day tag window. Initiate checkout when that is the promoted event, otherwise purchases. */
      ticketSaleResults: Record<string, number>;
      /** Purchases on those same ticket-sale ad-days. The result before initiate checkout was counted. */
      ticketSalePurchases: Record<string, number>;
      /** Initiate-checkout results on ticket-sale ad-days whose promoted event is INITIATED_CHECKOUT. */
      ticketSaleCheckouts: Record<string, number>;
      currencyAssumed: string[];
      /** Dry run only: what the jobs computed. */
      preview?: {
        tagPerformance: TagPerformanceRow[];
        funnel: { rows: FunnelBenchmarkRow[]; skipped: FunnelSkip[] };
        liveEvidence: Record<string, LiveEvidence & { name: string }>;
        clients: LearningInputs["clients"];
        copyPerformance: CopyPerformanceRow[];
      };
      error?: string;
    };

type Db = SupabaseClient;

/** The operator, by the same email migration 182 looks up. */
export async function loadOperatorUserId(db: Pick<Db, "auth">): Promise<string> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`operator lookup: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === OPERATOR_EMAIL);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  throw new Error(`operator lookup: no user ${OPERATOR_EMAIL}`);
}

function stageCounts(facts: LearningInputs["facts"]): Record<string, Record<Stage, number>> {
  const out: Record<string, Record<Stage, number>> = {};
  for (const f of facts) {
    const c = (out[f.clientId ?? ""] ??= { registration: 0, ticket_sale: 0, unknown: 0 });
    c[f.stage] += 1;
  }
  return out;
}

function stageSourceCounts(facts: LearningInputs["facts"]): Record<string, Record<StageSource, number>> {
  const out: Record<string, Record<StageSource, number>> = {};
  for (const f of facts) {
    const c = (out[f.clientId ?? ""] ??= Object.fromEntries(STAGE_SOURCES.map((s) => [s, 0])) as Record<StageSource, number>);
    c[f.stageSource] += 1;
  }
  return out;
}

function ticketSaleResultCounts(
  facts: LearningInputs["facts"],
  since: string,
): { results: Record<string, number>; purchases: Record<string, number>; checkouts: Record<string, number> } {
  const results: Record<string, number> = {};
  const purchases: Record<string, number> = {};
  const checkouts: Record<string, number> = {};
  for (const fact of facts) {
    if (fact.stage !== "ticket_sale" || !fact.clientId || fact.row.date < since) continue;
    const id = fact.clientId;
    results[id] = (results[id] ?? 0) + (fact.result ?? 0);
    purchases[id] = (purchases[id] ?? 0) + (Number(fact.row.purchases) || 0);
    if ((fact.row.promoted_event ?? "").trim().toUpperCase() === "INITIATED_CHECKOUT") {
      checkouts[id] = (checkouts[id] ?? 0) + (fact.result ?? 0);
    }
  }
  return { results, purchases, checkouts };
}

function spendCounts(facts: LearningInputs["facts"]): Record<string, { total: number; unknown: number }> {
  const out: Record<string, { total: number; unknown: number }> = {};
  for (const f of facts) {
    const c = (out[f.clientId ?? ""] ??= { total: 0, unknown: 0 });
    c.total += f.spendGbp;
    if (f.stage === "unknown") c.unknown += f.spendGbp;
  }
  for (const c of Object.values(out)) {
    c.total = Math.round(c.total * 100) / 100;
    c.unknown = Math.round(c.unknown * 100) / 100;
  }
  return out;
}

async function job(name: LearningJobName, run: () => Promise<JobOutcome>): Promise<JobOutcome> {
  try {
    const outcome = await run();
    console.log(`[learning-refresh] job=${name} ok=${outcome.ok} rows=${outcome.rows}${outcome.detail ? ` ${JSON.stringify(outcome.detail)}` : ""}`);
    return outcome;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[learning-refresh] job=${name} failed: ${error}`);
    return { ok: false, rows: 0, error };
  }
}

export async function runLearningRefresh(input: {
  env: Record<string, string | undefined>;
  db: Db;
  now?: Date;
  dryRun?: boolean;
  /** Tests: skip the auth admin lookup. */
  operatorUserId?: string;
  /** Tests: inject the loaded inputs. */
  inputs?: LearningInputs;
  /** Dry runs: see `LoadLearningOptions`. */
  load?: LoadLearningOptions;
}): Promise<LearningRefreshResult> {
  const dryRun = input.dryRun === true;
  if (!dryRun && !isLearningRefreshEnabled(input.env)) return { ok: true, skippedReason: "killswitch" };
  const now = input.now ?? new Date();
  const runAt = now.toISOString();
  if (input.load?.adSetMeta && !dryRun) throw new Error("load.adSetMeta is for dry runs only");
  const inputs = input.inputs ?? (await loadLearningInputs(input.db, input.load));
  logSkippedArchivedClients("learning-refresh", inputs.archivedClientIds.size, `dropped_ad_days=${inputs.dropped.archived}`);

  let operatorId: string | null = input.operatorUserId ?? null;
  const operator = async () => (operatorId ??= await loadOperatorUserId(input.db));

  let tagRows: TagPerformanceRow[] = [];
  let funnel: { rows: FunnelBenchmarkRow[]; skipped: FunnelSkip[] } = { rows: [], skipped: [] };
  let liveEvidence: Map<string, LiveEvidence> = new Map();
  let clusterNames = new Map<string, string>();
  let copyRows: CopyPerformanceRow[] = [];

  const jobs = {} as Record<LearningJobName, JobOutcome>;
  jobs.creative_scores = await job("creative_scores", async () => {
    const rows = computeCreativeScores(inputs.facts, { userId: await operator(), fetchedAt: runAt });
    const events = new Set(rows.map((r) => r.eventId)).size;
    if (dryRun) return { ok: true, rows: rows.length, detail: { events, dryRun } };
    const written = await writeCreativeScores(input.db, rows);
    return {
      ok: written.failed === 0,
      rows: written.written,
      detail: { events, failed: written.failed },
      ...(written.firstError ? { error: written.firstError } : {}),
    };
  });
  jobs.tag_performance = await job("tag_performance", async () => {
    tagRows = computeTagPerformance(inputs.facts, inputs.clients, inputs.tags, { now, shows: inputs.shows });
    const scopes = { client: 0, vertical: 0, all: 0 };
    for (const r of tagRows) scopes[r.scope] += 1;
    if (dryRun) return { ok: true, rows: tagRows.length, detail: { ...scopes, dryRun } };
    const written = await writeTagPerformance(input.db, tagRows, { computedAt: runAt });
    return { ok: true, rows: written.written, detail: { ...scopes, staleDeleted: written.deleted } };
  });
  jobs.client_funnel_benchmarks = await job("client_funnel_benchmarks", async () => {
    funnel = computeFunnelBenchmarks(inputs.facts, inputs.clients, { now });
    const detail = { skipped: funnel.skipped.length };
    if (dryRun) return { ok: true, rows: funnel.rows.length, detail: { ...detail, dryRun } };
    const written = await writeFunnelBenchmarks(input.db, funnel.rows);
    return { ok: true, rows: written.written, detail: { ...detail, preservedManual: written.preservedManual } };
  });
  jobs.interest_live_evidence = await job("interest_live_evidence", async () => {
    const clusters = await loadOperatorClusters(input.db, await operator());
    clusterNames = new Map(clusters.map((c) => [c.id, c.name]));
    liveEvidence = computeLiveEvidence(clusters, inputs.adSets, inputs.facts, inputs.clients, { now });
    const matched = [...liveEvidence.values()].filter((e) => e.adSets > 0).length;
    if (dryRun) return { ok: true, rows: liveEvidence.size, detail: { matched, dryRun } };
    const written = await writeLiveEvidence(input.db, liveEvidence, runAt);
    return { ok: true, rows: written.written, detail: { matched } };
  });
  jobs.copy_performance = await job("copy_performance", async () => {
    const library: CopyLibrary = await loadCopyLibrary(input.db, inputs.facts, inputs.clients);
    copyRows = computeCopyPerformance(library);
    const scopes = scopeCounts(copyRows);
    const detail = {
      ...scopes,
      droppedNameOnly: library.droppedNameOnly,
      shown: copyRows.filter((row) => row.scope === "all" && passesCopyMinimum(row)).length,
      proven: copyRows.filter((row) => row.scope === "all" && row.proven).length,
    };
    if (dryRun) return { ok: true, rows: copyRows.length, detail: { ...detail, dryRun } };
    const written = await writeCopyPerformance(input.db, copyRows, runAt);
    return { ok: true, rows: written.written, detail: { ...scopes, droppedNameOnly: library.droppedNameOnly, staleDeleted: written.deleted } };
  });

  const ticketSales = ticketSaleResultCounts(inputs.facts, windowStart(now, TAG_WINDOW_DAYS));
  const result: LearningRefreshResult = {
    ok: LEARNING_JOBS.every((name) => jobs[name].ok),
    dryRun,
    jobs,
    adDays: inputs.facts.length,
    dropped: inputs.dropped,
    joinRates: Object.fromEntries(joinRates(inputs.facts)),
    stages: stageCounts(inputs.facts),
    stageSources: stageSourceCounts(inputs.facts),
    spend: spendCounts(inputs.facts),
    ticketSaleResults: ticketSales.results,
    ticketSalePurchases: ticketSales.purchases,
    ticketSaleCheckouts: ticketSales.checkouts,
    currencyAssumed: [...inputs.currency.assumed].sort(),
  };
  if (dryRun) {
    result.preview = {
      tagPerformance: tagRows,
      funnel,
      liveEvidence: Object.fromEntries(
        [...liveEvidence].map(([id, e]) => [id, { ...e, name: clusterNames.get(id) ?? id }]),
      ),
      clients: inputs.clients,
      copyPerformance: copyRows,
    };
  }
  console.log(
    `[learning-refresh] done ok=${result.ok} dry_run=${dryRun} ad_days=${result.adDays} ${LEARNING_JOBS.map((n) => `${n}=${jobs[n].rows}`).join(" ")}`,
  );
  return result;
}
