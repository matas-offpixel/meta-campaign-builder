import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadArchivedClientIds } from "@/lib/db/client-status";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  buildRail,
  type ClusterRow,
  type ClusterRowsByScope,
  type CopyLine,
  type RailContext,
  type RailData,
  type RailScope,
  type RailStage,
  type ShapeRow,
  type TagRow,
  type TagRowsByScope,
  type TikTokRow,
} from "@/lib/insights-rail/model";
import type { LiveEvidence } from "../interest-evidence.ts";
import type { TagPerformanceRow } from "../tag-performance.ts";
import { OperatorContext } from "./context.ts";
import { topCopyFeatures, topTemplates } from "./read.ts";

type Db = Pick<SupabaseClient, "from">;

/**
 * The Insights rail's readers. Operator-only like the copy library: a
 * route gets its OperatorContext from requireOperator(). Reads only.
 * tag_performance at the three scopes for one stage and surface, the
 * copy library on campaign creation, interest_clusters.live_evidence on
 * the audience builder, and tiktok_breakdown_snapshots on the TikTok
 * drawer. Nothing here writes.
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

function toShape(row: { feature: string; value: string; voice: ShapeRow["voice"]; index_vs_event: number | null; events_n: number; ads_n: number; stage: ShapeRow["stage"]; ads_hash: string | null; confidence: ShapeRow["confidence"] }): ShapeRow | null {
  if (row.index_vs_event == null) return null;
  return {
    feature: row.feature,
    value: row.value,
    voice: row.voice,
    index: row.index_vs_event,
    shows: row.events_n,
    ads: row.ads_n,
    stage: row.stage,
    adsHash: row.ads_hash,
    confidence: row.confidence,
  };
}

/** Best copy shapes at the drawer's stage. A client with nothing drawable falls back to all (R5, R20). */
async function railCopyShapes(
  ctx: OperatorContext,
  args: { clientId: string | null; stage: RailStage; scope: RailScope },
  db?: Db,
): Promise<{ rows: ShapeRow[]; scope: RailScope }> {
  assertOperator(ctx);
  const load = async (clientId: string | null): Promise<ShapeRow[]> => {
    const rows = await topCopyFeatures(ctx, clientId ? { stage: args.stage, clientId } : { stage: args.stage }, db);
    return rows.flatMap((row) => {
      const shape = toShape(row);
      return shape ? [shape] : [];
    });
  };
  const drawable = (rows: readonly ShapeRow[]) => rows.some((row) => row.shows >= 2 && row.ads >= 10);
  if (args.scope === "client" && args.clientId) {
    const own = await load(args.clientId);
    if (drawable(own)) return { rows: own, scope: "client" };
    return { rows: await load(null), scope: "all" };
  }
  return { rows: await load(null), scope: "all" };
}

// ── Interest clusters (IR5) ─────────────────────────────────────────────

type ClusterDbRow = {
  id: string;
  name: string;
  vertical: string | null;
  interests: unknown;
  use_count: number | null;
  live_evidence: LiveEvidence | null;
};

function interestsOf(raw: unknown): { id: string; name: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (item && typeof item === "object" ? { id: String((item as { id?: unknown }).id ?? ""), name: String((item as { name?: unknown }).name ?? "") } : null))
    .filter((item): item is { id: string; name: string } => Boolean(item && item.id));
}

function pooledRow(row: ClusterDbRow): ClusterRow {
  const live = row.live_evidence;
  return {
    id: row.id,
    name: row.name,
    interests: interestsOf(row.interests),
    cpr: num(live?.cpr),
    cprIndex: num(live?.cprIndex),
    fundedAdSets: Number(live?.fundedAdSets) || 0,
    clients: live?.clients?.length ?? 0,
    confidence: live?.confidence ?? "thin",
    useCount: Number(row.use_count) || 0,
    tried: (Number(live?.adSets) || 0) > 0,
  };
}

/**
 * Every non-archived cluster of the operator at the three scopes: the
 * client's own perClient entry, the clusters of the client's vertical
 * (the cluster's own `vertical`, not the rollup), and everything pooled.
 * A cluster no ad set has run is in every scope as untried.
 */
export async function railClusterRows(
  ctx: OperatorContext,
  args: { clientId: string | null; verticalId: string | null },
  db?: Db,
): Promise<ClusterRowsByScope> {
  assertOperator(ctx);
  const store = db ?? createServiceRoleClient();
  const { data, error } = await store
    .from("interest_clusters")
    .select("id, name, vertical, interests, use_count, live_evidence")
    .eq("user_id", ctx.userId)
    .is("archived_at", null);
  if (error) throw new Error(`interest_clusters read: ${error.message}`);
  const rows = (data ?? []) as ClusterDbRow[];
  const all = rows.map(pooledRow);
  const vertical = args.verticalId ? rows.filter((row) => row.vertical === args.verticalId).map(pooledRow) : [];
  const client = args.clientId
    ? rows.map((row) => {
        const own = row.live_evidence?.perClient?.find((entry) => entry.clientId === args.clientId) ?? null;
        const pooled = pooledRow(row);
        if (!own) return { ...pooled, cpr: null, cprIndex: null, fundedAdSets: 0, clients: 0, confidence: "thin" as const, tried: false };
        return {
          ...pooled,
          cpr: num(own.cpr),
          cprIndex: num(own.cprIndex),
          fundedAdSets: Number(own.fundedAdSets) || 0,
          clients: 1,
          confidence: own.confidence ?? "thin",
          tried: (Number(own.adSets) || 0) > 0,
        };
      })
    : [];
  return { client, vertical, all };
}

// ── TikTok breakdowns (IR8) ─────────────────────────────────────────────

type SnapshotRow = {
  event_id: string;
  dimension: string;
  dimension_value: string;
  spend: number | string | null;
  impressions: number | null;
  clicks: number | null;
  video_views_2s: number | null;
  window_until: string;
  fetched_at: string;
};

export const TIKTOK_WINDOW_DAYS = 90;

/**
 * The client's own TikTok age and gender rows: the latest window per
 * event (newest window_until, then fetched_at) for each dimension value,
 * for events whose latest window ended in the last 90 days, summed over
 * the client's events. Read-only; never a TikTok call.
 */
export async function railTikTokRows(
  ctx: OperatorContext,
  args: { clientId: string | null; now?: Date },
  db?: Db,
): Promise<TikTokRow[]> {
  assertOperator(ctx);
  if (!args.clientId) return [];
  const store = db ?? createServiceRoleClient();
  const archived = await loadArchivedClientIds(store as SupabaseClient);
  if (archived.has(args.clientId)) return [];
  const { data: events, error: eventsError } = await store.from("events").select("id").eq("client_id", args.clientId);
  if (eventsError) throw new Error(`events read: ${eventsError.message}`);
  const eventIds = ((events ?? []) as { id: string }[]).map((event) => event.id);
  if (!eventIds.length) return [];
  const now = args.now ?? new Date();
  const since = new Date(now.getTime() - TIKTOK_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await store
    .from("tiktok_breakdown_snapshots")
    .select("event_id, dimension, dimension_value, spend, impressions, clicks, video_views_2s, window_until, fetched_at")
    .in("event_id", eventIds)
    .in("dimension", ["age", "gender"])
    .gte("window_until", since)
    .order("window_until", { ascending: false })
    .order("fetched_at", { ascending: false })
    .range(0, 4999);
  if (error) throw new Error(`tiktok_breakdown_snapshots read: ${error.message}`);
  return sumLatestWindows((data ?? []) as SnapshotRow[]);
}

/** Pure: newest row per (event, dimension, value) wins, then the values are summed across events. */
export function sumLatestWindows(rows: readonly SnapshotRow[]): TikTokRow[] {
  const latest = new Map<string, SnapshotRow>();
  for (const row of rows) {
    const key = `${row.event_id}|${row.dimension}|${row.dimension_value}`;
    const have = latest.get(key);
    if (!have || row.window_until > have.window_until || (row.window_until === have.window_until && row.fetched_at > have.fetched_at)) latest.set(key, row);
  }
  const sums = new Map<string, TikTokRow>();
  for (const row of latest.values()) {
    if (row.dimension !== "age" && row.dimension !== "gender") continue;
    const key = `${row.dimension}|${row.dimension_value}`;
    const at = sums.get(key) ?? { dimension: row.dimension, value: row.dimension_value, spend: 0, clicks: 0, impressions: 0, views2s: 0 };
    at.spend += Number(row.spend) || 0;
    at.clicks += Number(row.clicks) || 0;
    at.impressions += Number(row.impressions) || 0;
    at.views2s += Number(row.video_views_2s) || 0;
    sums.set(key, at);
  }
  return [...sums.values()]
    .map((row) => ({ ...row, spend: Math.round(row.spend * 100) / 100 }))
    .sort((a, b) => a.dimension.localeCompare(b.dimension) || a.value.localeCompare(b.value));
}

/** Everything the rail draws for one page at one scope and stage. */
export async function railData(
  ctx: OperatorContext,
  args: { context: RailContext; scope: RailScope; stage: RailStage },
  db?: Db,
): Promise<RailData> {
  assertOperator(ctx);
  const { context } = args;
  const [rows, copy, shapes, clusters, tiktok] = await Promise.all([
    context.surface === "audience_builder" ? Promise.resolve({}) : railTagRows(ctx, { clientId: context.clientId, verticalId: context.verticalId, stage: args.stage }, db),
    context.surface === "campaign" ? railCopyLines(ctx, { clientId: context.clientId, stage: args.stage }, db) : Promise.resolve(null),
    context.surface === "campaign" ? railCopyShapes(ctx, { clientId: context.clientId, stage: args.stage, scope: args.scope }, db) : Promise.resolve(null),
    context.surface === "audience_builder" ? railClusterRows(ctx, { clientId: context.clientId, verticalId: context.verticalId }, db) : Promise.resolve(null),
    context.surface === "tiktok_campaign" ? railTikTokRows(ctx, { clientId: context.clientId }, db) : Promise.resolve(null),
  ]);
  return buildRail({ context, scope: args.scope, stage: args.stage, rows, copy, shapes, clusters, tiktok });
}
