import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadArchivedClientIds } from "@/lib/db/client-status";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { buildRail, type CopyLine, type RailContext, type RailData, type RailScope, type RailStage, type TagRow, type TagRowsByScope } from "@/lib/insights-rail/model";
import type { TagPerformanceRow } from "../tag-performance.ts";
import { OperatorContext } from "./context.ts";
import { topTemplates } from "./read.ts";

type Db = Pick<SupabaseClient, "from">;

/**
 * The Insights rail's readers. Operator-only like the copy library: a
 * route gets its OperatorContext from requireOperator(). Reads only.
 * tag_performance at the three scopes for one stage and surface, and the
 * copy library on campaign creation. Nothing here writes.
 */

function assertOperator(ctx: OperatorContext) {
  if (!(ctx instanceof OperatorContext)) throw new Error("OperatorContext required");
}

const num = (value: unknown): number | null => (value == null || !Number.isFinite(Number(value)) ? null : Number(value));

function toTagRow(row: TagPerformanceRow): TagRow {
  return {
    dimension: row.dimension,
    valueKey: row.value_key,
    fundedAds: Number(row.funded_ads) || 0,
    cpr: num(row.cpr),
    baselineCpr: num(row.baseline_cpr),
    shrunkIndex: num(row.shrunk_index),
    confidence: row.confidence,
  };
}

async function tagRowsAt(db: Db, scope: RailScope, scopeId: string, stage: RailStage): Promise<TagRow[]> {
  const { data, error } = await db.from("tag_performance").select("*").eq("scope", scope).eq("scope_id", scopeId).eq("stage", stage);
  if (error) throw new Error(`tag_performance read: ${error.message}`);
  return ((data ?? []) as TagPerformanceRow[]).map(toTagRow);
}

/** The rows the rail may draw from: the client's own, its vertical's, everyone's. */
export async function railTagRows(
  ctx: OperatorContext,
  args: { clientId: string | null; verticalId: string | null; stage: RailStage },
  db?: Db,
): Promise<TagRowsByScope> {
  assertOperator(ctx);
  const store = db ?? createServiceRoleClient();
  const archived = await loadArchivedClientIds(store as SupabaseClient);
  const clientId = args.clientId && !archived.has(args.clientId) ? args.clientId : null;
  const [client, vertical, all] = await Promise.all([
    clientId ? tagRowsAt(store, "client", clientId, args.stage) : Promise.resolve([]),
    args.verticalId ? tagRowsAt(store, "vertical", args.verticalId, args.stage) : Promise.resolve([]),
    tagRowsAt(store, "all", "all", args.stage),
  ]);
  return { client, vertical, all };
}

function toCopyLine(row: { example_text: string; spend: number; results: number; index_vs_event: number | null; events_n: number; proven: boolean }): CopyLine {
  return {
    text: row.example_text,
    cpr: row.results > 0 ? row.spend / row.results : null,
    indexVsEvent: row.index_vs_event,
    eventsN: row.events_n,
    proven: row.proven,
  };
}

/** Best lines for the page's client at its stage, and lines proven across clients. */
export async function railCopyLines(
  ctx: OperatorContext,
  args: { clientId: string | null; stage: RailStage },
  db?: Db,
): Promise<{ best: CopyLine[]; proven: CopyLine[] }> {
  assertOperator(ctx);
  const [own, everyone] = await Promise.all([
    args.clientId ? topTemplates(ctx, { stage: args.stage, clientId: args.clientId, limit: 3 }, db) : Promise.resolve([]),
    topTemplates(ctx, { stage: args.stage, limit: 20 }, db),
  ]);
  return {
    best: own.map(toCopyLine),
    proven: everyone.filter((row) => row.proven).slice(0, 5).map(toCopyLine),
  };
}

/** Everything the rail draws for one page at one scope and stage. */
export async function railData(
  ctx: OperatorContext,
  args: { context: RailContext; scope: RailScope; stage: RailStage },
  db?: Db,
): Promise<RailData> {
  assertOperator(ctx);
  const { context } = args;
  const [rows, copy] = await Promise.all([
    railTagRows(ctx, { clientId: context.clientId, verticalId: context.verticalId, stage: args.stage }, db),
    context.surface === "campaign" ? railCopyLines(ctx, { clientId: context.clientId, stage: args.stage }, db) : Promise.resolve(null),
  ]);
  return buildRail({ context, scope: args.scope, stage: args.stage, rows, copy, verticalOff: true });
}
