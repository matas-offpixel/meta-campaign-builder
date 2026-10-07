/**
 * tag_performance (migration 186): scope × creative tag × stage over a
 * rolling window, from learning facts. Pure compute + one writer.
 *
 * Per ad (meta_ad_id) and stage the window's ad-days are summed first, so
 * `ads` and `funded_ads` count ads, not ad-days. A tag's cpr is pooled
 * (spend ÷ results). baseline_cpr is the scope's lower median per-ad cost
 * per result over every funded (≥ £5) tagged ad in the stage, with an ad
 * that has no result counted as the worst; null when that median has no
 * result. Funded only, so a £0.40 ad with one registration does not set
 * the norm. Then client rows shrink toward vertical, vertical toward all,
 * all toward 1 (lib/learning/shrink.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { THIN_MIN_AD_SET_SPEND_GBP } from "../analysis/interest-performance.ts";
import type { CreativeTag, LearningClient, LearningFact, Stage } from "./joins.ts";
import { choosePool, confidenceOf, shrinkIndex, type Confidence, type PoolRow } from "./shrink.ts";

export const TAG_WINDOW_DAYS = 90;

export type TagScope = "client" | "vertical" | "all";

export type TagPerformanceRow = {
  scope: TagScope;
  scope_id: string;
  dimension: string;
  value_key: string;
  stage: Stage;
  window_days: number;
  ads: number;
  funded_ads: number;
  spend: number;
  impressions: number;
  link_clicks: number;
  landing_page_views: number;
  video_plays_3s: number;
  results: number;
  cpr: number | null;
  ctr: number | null;
  baseline_cpr: number | null;
  index: number | null;
  pool_index: number | null;
  n_effective: number | null;
  shrunk_index: number | null;
  confidence: Confidence;
  computed_at: string;
};

type AdStage = {
  clientId: string;
  stage: Stage;
  spend: number;
  impressions: number;
  linkClicks: number;
  lpv: number;
  plays3s: number;
  results: number;
  tagIds: Set<string>;
};

export function windowStart(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Lower median, the report's rule (`whatToTestNext`). */
function lowerMedian(sorted: readonly number[]): number | null {
  if (!sorted.length) return null;
  const m = sorted[Math.floor((sorted.length - 1) / 2)]!;
  return Number.isFinite(m) ? m : null;
}

function adStages(facts: readonly LearningFact[], since: string): AdStage[] {
  const byKey = new Map<string, AdStage>();
  for (const f of facts) {
    if (!f.clientId || !f.tagIds.length || f.row.date < since) continue;
    const key = `${f.row.meta_ad_id}|${f.stage}`;
    const a = byKey.get(key) ?? {
      clientId: f.clientId,
      stage: f.stage,
      spend: 0,
      impressions: 0,
      linkClicks: 0,
      lpv: 0,
      plays3s: 0,
      results: 0,
      tagIds: new Set<string>(),
    };
    a.spend += f.spendGbp;
    a.impressions += Number(f.row.impressions) || 0;
    a.linkClicks += Number(f.row.link_clicks) || 0;
    a.lpv += Number(f.row.landing_page_views) || 0;
    a.plays3s += Number(f.row.video_plays_3s) || 0;
    a.results += f.result ?? 0;
    for (const t of f.tagIds) a.tagIds.add(t);
    byKey.set(key, a);
  }
  return [...byKey.values()];
}

type Bucket = { ads: AdStage[] };

export function computeTagPerformance(
  facts: readonly LearningFact[],
  clients: readonly LearningClient[],
  tags: ReadonlyMap<string, CreativeTag>,
  opts: { now: Date; windowDays?: number },
): TagPerformanceRow[] {
  const windowDays = opts.windowDays ?? TAG_WINDOW_DAYS;
  const computedAt = opts.now.toISOString();
  const vertical = new Map(clients.map((c) => [c.id, c.vertical]));
  const scopesOf = (clientId: string): [TagScope, string][] => {
    const v = vertical.get(clientId);
    return v ? [["client", clientId], ["vertical", v], ["all", "all"]] : [];
  };

  const scopeStage = new Map<string, Bucket>();
  const tagBuckets = new Map<string, Bucket & { scope: TagScope; scopeId: string; stage: Stage; tag: CreativeTag }>();
  for (const ad of adStages(facts, windowStart(opts.now, windowDays))) {
    for (const [scope, scopeId] of scopesOf(ad.clientId)) {
      const ssKey = `${scope}|${scopeId}|${ad.stage}`;
      (scopeStage.get(ssKey) ?? scopeStage.set(ssKey, { ads: [] }).get(ssKey)!).ads.push(ad);
      for (const tagId of ad.tagIds) {
        const tag = tags.get(tagId);
        if (!tag) continue;
        const key = `${ssKey}|${tag.dimension}|${tag.value_key}`;
        const bucket = tagBuckets.get(key) ?? { ads: [], scope, scopeId, stage: ad.stage, tag };
        // Two tag rows (one per operator) can share a dimension + value_key.
        if (!bucket.ads.includes(ad)) bucket.ads.push(ad);
        tagBuckets.set(key, bucket);
      }
    }
  }

  const baseline = new Map<string, number | null>();
  for (const [key, { ads }] of scopeStage) {
    const stage = key.split("|")[2] as Stage;
    if (stage === "unknown") {
      baseline.set(key, null);
      continue;
    }
    const cprs = ads
      .filter((a) => a.spend >= THIN_MIN_AD_SET_SPEND_GBP)
      .map((a) => (a.results > 0 ? a.spend / a.results : Number.POSITIVE_INFINITY))
      .sort((x, y) => x - y);
    baseline.set(key, lowerMedian(cprs));
  }

  const rows = new Map<string, TagPerformanceRow>();
  for (const [key, b] of tagBuckets) {
    const sum = (pick: (a: AdStage) => number) => b.ads.reduce((s, a) => s + pick(a), 0);
    const spend = sum((a) => a.spend);
    const results = sum((a) => a.results);
    const impressions = sum((a) => a.impressions);
    const linkClicks = sum((a) => a.linkClicks);
    const funded = b.ads.filter((a) => a.spend >= THIN_MIN_AD_SET_SPEND_GBP).length;
    const cpr = b.stage !== "unknown" && results > 0 ? spend / results : null;
    const base = baseline.get(`${b.scope}|${b.scopeId}|${b.stage}`) ?? null;
    const index = cpr != null && base ? cpr / base : null;
    rows.set(key, {
      scope: b.scope,
      scope_id: b.scopeId,
      dimension: b.tag.dimension,
      value_key: b.tag.value_key,
      stage: b.stage,
      window_days: windowDays,
      ads: b.ads.length,
      funded_ads: funded,
      spend: round(spend, 2),
      impressions,
      link_clicks: linkClicks,
      landing_page_views: sum((a) => a.lpv),
      video_plays_3s: sum((a) => a.plays3s),
      results,
      cpr: cpr == null ? null : round(cpr, 4),
      ctr: impressions > 0 ? round(linkClicks / impressions, 6) : null,
      baseline_cpr: base == null ? null : round(base, 4),
      index: index == null ? null : round(index, 4),
      pool_index: null,
      n_effective: null,
      shrunk_index: null,
      confidence: confidenceOf(funded, spend),
      computed_at: computedAt,
    });
  }

  const pooled = (scope: TagScope, scopeId: string, row: TagPerformanceRow): PoolRow => {
    const hit = rows.get(`${scope}|${scopeId}|${row.stage}|${row.dimension}|${row.value_key}`);
    return hit ? { index: hit.index, confidence: hit.confidence, fundedAds: hit.funded_ads } : null;
  };
  for (const row of rows.values()) {
    const chain: PoolRow[] =
      row.scope === "client"
        ? [pooled("vertical", vertical.get(row.scope_id) ?? "", row), pooled("all", "all", row)]
        : row.scope === "vertical"
          ? [pooled("all", "all", row)]
          : [];
    const pool = choosePool(chain);
    const { shrunkIndex, nEffective } = shrinkIndex(row.funded_ads, row.index, pool);
    row.pool_index = round(pool.index, 4);
    row.n_effective = nEffective;
    row.shrunk_index = shrunkIndex == null ? null : round(shrunkIndex, 4);
  }
  return [...rows.values()];
}

type Db = Pick<SupabaseClient, "from">;

export const TAG_PERFORMANCE_CONFLICT = "scope,scope_id,dimension,value_key,stage,window_days";

/**
 * Upsert every row, then delete this window's rows the run did not write
 * (computed_at older than the run): stale keys, and scopes whose client
 * was archived. A failed upsert skips the delete, so a partial run never
 * empties the table.
 */
export async function writeTagPerformance(
  db: Db,
  rows: readonly TagPerformanceRow[],
  opts: { computedAt: string; windowDays?: number },
): Promise<{ written: number; deleted: number }> {
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await db.from("tag_performance").upsert(chunk, { onConflict: TAG_PERFORMANCE_CONFLICT });
    if (error) throw new Error(`tag_performance upsert: ${error.message} (written ${written})`);
    written += chunk.length;
  }
  const { error, count } = await db
    .from("tag_performance")
    .delete({ count: "exact" })
    .eq("window_days", opts.windowDays ?? TAG_WINDOW_DAYS)
    .lt("computed_at", opts.computedAt);
  if (error) throw new Error(`tag_performance stale delete: ${error.message}`);
  return { written, deleted: count ?? 0 };
}
