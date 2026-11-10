import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadArchivedClientIds } from "@/lib/db/client-status";
import { selectIn } from "@/lib/ad-daily-insights/id-lookup";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { CopyFeatureRow } from "../copy-features.ts";
import { passesCopyMinimum, type CopyPerformanceRow, type CopyStage, type CopyVoice } from "../copy/score.ts";
import { displayClientName, OperatorContext } from "./context.ts";

type Db = Pick<SupabaseClient, "from">;

export type TemplateQuery = {
  stage: CopyStage;
  voice?: CopyVoice;
  clientId?: string;
  verticalId?: string;
  limit?: number;
};

export type TemplateView = CopyPerformanceRow & {
  clients: { id: string; name: string }[];
};

function assertOperator(ctx: OperatorContext) {
  if (!(ctx instanceof OperatorContext)) throw new Error("OperatorContext required");
}

async function database(db?: Db): Promise<Db> {
  return db ?? createServiceRoleClient();
}

function scopeOf(query: TemplateQuery): { scope: "client" | "vertical" | "all"; scopeId: string } {
  if (query.clientId) return { scope: "client", scopeId: query.clientId };
  if (query.verticalId) return { scope: "vertical", scopeId: query.verticalId };
  return { scope: "all", scopeId: "all" };
}

async function namesOf(db: Db, ids: readonly string[], seesClientNames: boolean): Promise<{ id: string; name: string }[]> {
  if (!ids.length) return [];
  const { rows, error } = await selectIn(
    (chunk) => db.from("clients").select("id, name").in("id", chunk),
    ids,
  );
  if (error) throw new Error(`clients: ${error}`);
  const name = new Map((rows as { id: string; name: string | null }[]).map((row) => [row.id, row.name?.trim() || "a client"]));
  return ids.map((id) => ({ id, name: displayClientName(name.get(id) ?? "a client", seesClientNames) }));
}

function coerce(row: CopyPerformanceRow): CopyPerformanceRow {
  return {
    ...row,
    events_n: Number(row.events_n),
    ads_n: Number(row.ads_n),
    spend: Number(row.spend),
    results: Number(row.results),
    index_vs_event: row.index_vs_event == null ? null : Number(row.index_vs_event),
    client_ids: row.client_ids ?? [],
  };
}

function activeIds(ids: readonly string[], archived: ReadonlySet<string>): string[] {
  return ids.filter((id) => !archived.has(id));
}

async function present(
  db: Db,
  row: CopyPerformanceRow,
  archived: ReadonlySet<string>,
  seesClientNames: boolean,
): Promise<TemplateView | null> {
  if (row.scope === "client" && archived.has(row.scope_id)) return null;
  const ids = activeIds(row.client_ids, archived);
  if (!ids.length) return null;
  return { ...row, client_ids: ids, clients: await namesOf(db, ids, seesClientNames) };
}

export async function topTemplates(ctx: OperatorContext, query: TemplateQuery, db?: Db): Promise<TemplateView[]> {
  assertOperator(ctx);
  const store = await database(db);
  const archived = await loadArchivedClientIds(store as SupabaseClient);
  const { scope, scopeId } = scopeOf(query);
  let request = store
    .from("copy_performance")
    .select("*")
    .eq("scope", scope)
    .eq("scope_id", scopeId)
    .eq("stage", query.stage)
    .order("index_vs_event", { ascending: true });
  if (query.voice) request = request.eq("voice", query.voice);
  const { data, error } = await request;
  if (error) throw new Error(`copy_performance: ${error.message}`);
  const views: TemplateView[] = [];
  for (const raw of (data ?? []) as CopyPerformanceRow[]) {
    const row = coerce(raw);
    if (!passesCopyMinimum(row) || row.index_vs_event == null) continue;
    const view = await present(store, row, archived, ctx.seesClientNames);
    if (view) views.push(view);
  }
  views.sort((a, b) => (a.index_vs_event ?? 99) - (b.index_vs_event ?? 99) || b.events_n - a.events_n);
  return views.slice(0, query.limit ?? 20);
}

export type CopyFeatureView = CopyFeatureRow & {
  clients: { id: string; name: string }[];
};

function coerceFeature(row: CopyFeatureRow): CopyFeatureRow {
  return {
    ...row,
    events_n: Number(row.events_n),
    ads_n: Number(row.ads_n),
    spend: Number(row.spend),
    results: Number(row.results),
    index_vs_event: row.index_vs_event == null ? null : Number(row.index_vs_event),
    client_ids: row.client_ids ?? [],
    ads_hash: row.ads_hash ?? null,
  };
}

/**
 * copy_features (migration 213) at one scope and stage, best shrunk index
 * first, rows that pass the copy minimum only. Same operator gate and
 * archived-client filter as topTemplates.
 */
export async function topCopyFeatures(ctx: OperatorContext, query: TemplateQuery, db?: Db): Promise<CopyFeatureView[]> {
  assertOperator(ctx);
  const store = await database(db);
  const archived = await loadArchivedClientIds(store as SupabaseClient);
  const { scope, scopeId } = scopeOf(query);
  let request = store
    .from("copy_features")
    .select("*")
    .eq("scope", scope)
    .eq("scope_id", scopeId)
    .eq("stage", query.stage)
    .order("index_vs_event", { ascending: true });
  if (query.voice) request = request.eq("voice", query.voice);
  const { data, error } = await request;
  if (error) throw new Error(`copy_features: ${error.message}`);
  const views: CopyFeatureView[] = [];
  for (const raw of (data ?? []) as CopyFeatureRow[]) {
    const row = coerceFeature(raw);
    if (!passesCopyMinimum(row) || row.index_vs_event == null) continue;
    if (row.scope === "client" && archived.has(row.scope_id)) continue;
    const ids = activeIds(row.client_ids, archived);
    if (!ids.length) continue;
    views.push({ ...row, client_ids: ids, clients: await namesOf(store, ids, ctx.seesClientNames) });
  }
  views.sort((a, b) => (a.index_vs_event ?? 99) - (b.index_vs_event ?? 99) || b.events_n - a.events_n);
  return views.slice(0, query.limit ?? 20);
}

export async function templateDetail(ctx: OperatorContext, templateKey: string, db?: Db): Promise<TemplateView[]> {
  assertOperator(ctx);
  const store = await database(db);
  const archived = await loadArchivedClientIds(store as SupabaseClient);
  const { data, error } = await store.from("copy_performance").select("*").eq("template_key", templateKey);
  if (error) throw new Error(`copy_performance: ${error.message}`);
  const views: TemplateView[] = [];
  for (const raw of (data ?? []) as CopyPerformanceRow[]) {
    const view = await present(store, coerce(raw), archived, ctx.seesClientNames);
    if (view) views.push(view);
  }
  return views;
}
