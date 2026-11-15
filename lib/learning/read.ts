/**
 * Read side of the stored learnings, for the dashboard (PR C) and the
 * wizard (PR D). Plain functions over a Supabase client; RLS applies, so
 * a session client sees its operator's rows only. Nothing here computes a
 * learning — that is the nightly job (lib/learning/runner.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveClientFunnelBenchmarks, type ClientFunnelBenchmarkSet } from "../dashboard/client-funnel-benchmarks.ts";
import type { CreativeScoreAxis } from "../db/creative-tags.ts";
import type { LiveEvidence } from "./interest-evidence.ts";
import type { Stage } from "./joins.ts";
import { confidenceLabel, type Confidence } from "./shrink.ts";
import type { TagPerformanceRow, TagScope } from "./tag-performance.ts";

type Db = Pick<SupabaseClient, "from">;

export type TagLearning = {
  dimension: string;
  valueKey: string;
  label: string;
  stage: Stage;
  ads: number;
  fundedAds: number;
  spend: number;
  results: number;
  cpr: number | null;
  index: number | null;
  shrunkIndex: number | null;
  nEffective: number | null;
  confidence: Confidence;
};

const num = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

function toLearning(row: TagPerformanceRow, labels: ReadonlyMap<string, string>): TagLearning {
  return {
    dimension: row.dimension,
    valueKey: row.value_key,
    label: labels.get(`${row.dimension}|${row.value_key}`) ?? row.value_key,
    stage: row.stage,
    ads: Number(row.ads) || 0,
    fundedAds: Number(row.funded_ads) || 0,
    spend: Number(row.spend) || 0,
    results: Number(row.results) || 0,
    cpr: num(row.cpr),
    index: num(row.index),
    shrunkIndex: num(row.shrunk_index),
    nEffective: num(row.n_effective),
    confidence: row.confidence,
  };
}

/** Lowest shrunk index first (best); rows without one last. */
function byShrunk(a: TagLearning, b: TagLearning): number {
  const x = a.shrunkIndex ?? Number.POSITIVE_INFINITY;
  const y = b.shrunkIndex ?? Number.POSITIVE_INFINITY;
  return x - y || b.fundedAds - a.fundedAds || a.valueKey.localeCompare(b.valueKey);
}

async function tagLabels(db: Db): Promise<Map<string, string>> {
  const { data, error } = await db.from("creative_tags").select("dimension, value_key, value_label").not("dimension", "is", null);
  if (error) throw new Error(`creative_tags read: ${error.message}`);
  const out = new Map<string, string>();
  for (const t of (data ?? []) as { dimension: string; value_key: string; value_label: string | null }[]) {
    if (t.value_label) out.set(`${t.dimension}|${t.value_key}`, t.value_label);
  }
  return out;
}

export async function getTagPerformance(db: Db, scope: TagScope, scopeId: string, stage: Stage): Promise<TagLearning[]> {
  const [{ data, error }, labels] = await Promise.all([
    db.from("tag_performance").select("*").eq("scope", scope).eq("scope_id", scopeId).eq("stage", stage),
    tagLabels(db),
  ]);
  if (error) throw new Error(`tag_performance read: ${error.message}`);
  return ((data ?? []) as TagPerformanceRow[]).map((r) => toLearning(r, labels)).sort(byShrunk);
}

export type CreativeScores = {
  fetchedAt: string | null;
  creatives: { creativeName: string; scores: Partial<Record<CreativeScoreAxis, number>>; significant: boolean }[];
};

/** The latest snapshot only. */
export async function getCreativeScores(db: Db, eventId: string): Promise<CreativeScores> {
  const { data, error } = await db
    .from("creative_scores")
    .select("creative_name, axis, score, significance, fetched_at")
    .eq("event_id", eventId)
    .order("fetched_at", { ascending: false });
  if (error) throw new Error(`creative_scores read: ${error.message}`);
  const rows = (data ?? []) as { creative_name: string; axis: CreativeScoreAxis; score: number; significance: boolean; fetched_at: string }[];
  const fetchedAt = rows[0]?.fetched_at ?? null;
  const byName = new Map<string, CreativeScores["creatives"][number]>();
  for (const r of rows) {
    if (r.fetched_at !== fetchedAt) continue;
    const c = byName.get(r.creative_name) ?? { creativeName: r.creative_name, scores: {}, significant: false };
    c.scores[r.axis] = r.score;
    c.significant ||= r.significance;
    byName.set(r.creative_name, c);
  }
  return { fetchedAt, creatives: [...byName.values()].sort((a, b) => a.creativeName.localeCompare(b.creativeName)) };
}

export type ClientInterestLearning = {
  clusterId: string;
  name: string;
  /** This client's slice of the cluster's live evidence. */
  cprIndex: number | null;
  cpr: number | null;
  adSets: number;
  fundedAdSets: number;
  spend: number;
  registrations: number;
  confidence: Confidence;
  refreshedAt: string | null;
};

export type ClientLearnings = {
  /** dimension → stage → best and worst tags by shrunk index. */
  tags: Record<string, Partial<Record<Stage, { top: TagLearning[]; bottom: TagLearning[] }>>>;
  funnel: ClientFunnelBenchmarkSet & { confidenceLabel: Record<string, Confidence | null> };
  /** Clusters this client ran, best cprIndex first. */
  interests: ClientInterestLearning[];
};

export async function getClientLearnings(db: Db, clientId: string, opts: { perSide?: number } = {}): Promise<ClientLearnings> {
  const perSide = opts.perSide ?? 3;
  const [tagRes, labels, funnelRes, clusterRes] = await Promise.all([
    db.from("tag_performance").select("*").eq("scope", "client").eq("scope_id", clientId),
    tagLabels(db),
    db.from("client_funnel_benchmarks").select("stage, rate, n, confidence, provenance, updated_at").eq("client_id", clientId),
    db
      .from("interest_clusters")
      .select("id, name, live_evidence, evidence_refreshed_at")
      .is("archived_at", null)
      .not("live_evidence", "is", null),
  ]);
  if (tagRes.error) throw new Error(`tag_performance read: ${tagRes.error.message}`);
  if (funnelRes.error) throw new Error(`client_funnel_benchmarks read: ${funnelRes.error.message}`);
  if (clusterRes.error) throw new Error(`interest_clusters read: ${clusterRes.error.message}`);

  const tags: ClientLearnings["tags"] = {};
  const grouped = new Map<string, TagLearning[]>();
  for (const row of (tagRes.data ?? []) as TagPerformanceRow[]) {
    const l = toLearning(row, labels);
    const key = `${l.dimension}|${l.stage}`;
    grouped.set(key, [...(grouped.get(key) ?? []), l]);
  }
  for (const [key, list] of grouped) {
    const [dimension, stage] = key.split("|") as [string, Stage];
    const ranked = list.filter((l) => l.shrunkIndex != null).sort(byShrunk);
    const top = ranked.slice(0, perSide);
    const bottom = ranked.slice(top.length).slice(-perSide).reverse();
    (tags[dimension] ??= {})[stage] = { top, bottom };
  }

  const resolved = resolveClientFunnelBenchmarks(
    (funnelRes.data ?? []) as Parameters<typeof resolveClientFunnelBenchmarks>[0],
  );
  const funnel = {
    ...resolved,
    confidenceLabel: Object.fromEntries(
      Object.values(resolved).map((row) => [row.stage, row.provenance === "learned" ? confidenceLabel(row.confidence) : null]),
    ),
  };

  const interests: ClientInterestLearning[] = [];
  for (const c of (clusterRes.data ?? []) as { id: string; name: string; live_evidence: LiveEvidence; evidence_refreshed_at: string | null }[]) {
    const slice = c.live_evidence?.perClient?.find((p) => p.clientId === clientId);
    if (!slice) continue;
    interests.push({
      clusterId: c.id,
      name: c.name,
      cprIndex: slice.cprIndex,
      cpr: slice.cpr,
      adSets: slice.adSets,
      fundedAdSets: slice.fundedAdSets,
      spend: slice.spend,
      registrations: slice.registrations,
      confidence: slice.confidence,
      refreshedAt: c.evidence_refreshed_at,
    });
  }
  interests.sort(
    (a, b) =>
      (a.cprIndex ?? Number.POSITIVE_INFINITY) - (b.cprIndex ?? Number.POSITIVE_INFINITY) ||
      b.spend - a.spend ||
      a.name.localeCompare(b.name),
  );
  return { tags, funnel, interests };
}
