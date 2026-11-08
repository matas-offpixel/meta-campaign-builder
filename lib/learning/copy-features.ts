/**
 * copy_features (migration 213). DB-only. The copy library copy_performance
 * built (one ScoreAd per ad with its normalised lines) is re-keyed from
 * template words to feature values (`cta_kind=sign_up`) and scored with
 * the same maths: expected ÷ actual against the event's stage cost per
 * result, shrink k = 2, n = distinct shows, proven at n ≥ 2 and ≤ 0.9.
 * One row per feature × value × field × stage × voice × scope.
 *
 * No example text is stored: a feature value is a label, not a line.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CopyLibrary } from "./copy-performance.ts";
import { copyFeatures, featureKey, parseFeatureKey, COPY_FEATURES, type CopyFeature } from "./copy/features.ts";
import {
  COPY_MIN_EVENTS,
  COPY_SHRINK_K,
  scoreTemplates,
  type CopyConfidence,
  type CopyField,
  type CopyScope,
  type CopyStage,
  type CopyVoice,
  type ScoreAd,
} from "./copy/score.ts";

type Db = Pick<SupabaseClient, "from">;

export type CopyFeatureRow = {
  feature: CopyFeature;
  value: string;
  field: CopyField;
  stage: CopyStage;
  voice: CopyVoice;
  scope: CopyScope;
  scope_id: string;
  events_n: number;
  ads_n: number;
  spend: number;
  results: number;
  index_vs_event: number | null;
  confidence: CopyConfidence;
  proven: boolean;
  client_ids: string[];
};

/** The library's ads with each line re-keyed to its feature values. */
export function featureAds(library: CopyLibrary): ScoreAd[] {
  return library.ads.map((ad) => {
    const lines: ScoreAd["lines"] = [];
    for (const line of ad.lines) {
      const features = copyFeatures(line.text, line.key);
      for (const feature of COPY_FEATURES) lines.push({ field: line.field, key: featureKey(feature, features[feature]), text: line.text });
    }
    return { ...ad, lines };
  });
}

export function computeCopyFeatures(library: CopyLibrary): CopyFeatureRow[] {
  const rows: CopyFeatureRow[] = [];
  for (const scored of scoreTemplates(featureAds(library), COPY_SHRINK_K, { keep: (key) => parseFeatureKey(key) != null })) {
    const parsed = parseFeatureKey(scored.template_key);
    if (!parsed) continue;
    rows.push({
      feature: parsed.feature,
      value: parsed.value,
      field: scored.field,
      stage: scored.stage,
      voice: scored.voice,
      scope: scored.scope,
      scope_id: scored.scope_id,
      events_n: scored.events_n,
      ads_n: scored.ads_n,
      spend: scored.spend,
      results: scored.results,
      index_vs_event: scored.index_vs_event,
      confidence: scored.confidence,
      proven: scored.proven,
      client_ids: scored.client_ids,
    });
  }
  return rows;
}

export const COPY_FEATURES_CONFLICT = "feature,value,field,stage,voice,scope,scope_id";

export async function writeCopyFeatures(db: Db, rows: readonly CopyFeatureRow[], updatedAt: string): Promise<{ written: number; deleted: number }> {
  if (!rows.length) {
    console.warn("[learning-refresh] copy_features: no rows, delete skipped");
    return { written: 0, deleted: 0 };
  }
  let written = 0;
  for (let start = 0; start < rows.length; start += 200) {
    const chunk = rows.slice(start, start + 200).map((row) => ({ ...row, updated_at: updatedAt }));
    const { error } = await db.from("copy_features").upsert(chunk, { onConflict: COPY_FEATURES_CONFLICT });
    if (error) throw new Error(`copy_features upsert: ${error.message} (written ${written})`);
    written += chunk.length;
  }
  const { error, count } = await db.from("copy_features").delete({ count: "exact" }).lt("updated_at", updatedAt);
  if (error) throw new Error(`copy_features stale delete: ${error.message}`);
  return { written, deleted: count ?? 0 };
}

export type CopyFeatureSummary = {
  scopes: Record<CopyScope, number>;
  /** Scope-all rows per feature. */
  perFeature: Record<CopyFeature, number>;
  /** Scope-all rows on 2+ shows. */
  recurring: number;
  proven: number;
};

export function summariseCopyFeatures(rows: readonly CopyFeatureRow[]): CopyFeatureSummary {
  const scopes: Record<CopyScope, number> = { client: 0, vertical: 0, all: 0 };
  const perFeature = Object.fromEntries(COPY_FEATURES.map((feature) => [feature, 0])) as Record<CopyFeature, number>;
  let recurring = 0;
  let proven = 0;
  for (const row of rows) {
    scopes[row.scope] += 1;
    if (row.scope !== "all") continue;
    perFeature[row.feature] += 1;
    if (row.events_n >= COPY_MIN_EVENTS) recurring += 1;
    if (row.proven) proven += 1;
  }
  return { scopes, perFeature, recurring, proven };
}
