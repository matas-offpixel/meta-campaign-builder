/**
 * creative_scores (migration 061) from learning facts — CR.3 / audit two §5.
 *
 * Per (event_id, creative_name = Meta ad name) over every ad-day of the
 * event:
 *   hook    = video_plays_3s ÷ impressions      (videos: plays > 0)
 *   watch   = video_plays_p100 ÷ video_plays_3s (videos: plays > 0)
 *   click   = link_clicks ÷ impressions
 *   convert = stage results ÷ spend on days with a known stage
 * score = percentile rank 0–100 within the event (ties share the mid
 * rank; one creative scores 50). significance = the creative's funded ads
 * and spend clear the thin rule; the column is a boolean, so the count
 * itself is not stored.
 *
 * One row per (event_id, creative_name, axis), restated nightly with
 * fetched_at = the run (unique key from migration 186).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { THIN_MIN_AD_SET_SPEND_GBP } from "../analysis/interest-performance.ts";
import { CREATIVE_SCORE_CONFLICT, type CreativeScoreAxis, type UpsertCreativeScoreArgs } from "../db/creative-tags.ts";
import type { LearningFact } from "./joins.ts";
import { confidenceOf } from "./shrink.ts";

export const CREATIVE_SCORE_AXES: readonly CreativeScoreAxis[] = ["hook", "watch", "click", "convert"];

type Creative = {
  eventId: string;
  name: string;
  impressions: number;
  plays3s: number;
  p100: number;
  linkClicks: number;
  spend: number;
  knownSpend: number;
  results: number;
  adSpend: Map<string, number>;
};

function metric(c: Creative, axis: CreativeScoreAxis): number | null {
  switch (axis) {
    case "hook":
      return c.plays3s > 0 && c.impressions > 0 ? c.plays3s / c.impressions : null;
    case "watch":
      return c.plays3s > 0 ? c.p100 / c.plays3s : null;
    case "click":
      return c.impressions > 0 ? c.linkClicks / c.impressions : null;
    case "convert":
      return c.knownSpend > 0 ? c.results / c.knownSpend : null;
  }
}

/** Share of values below, plus half the ties excluding itself, scaled 0–100. */
export function percentileRank(value: number, values: readonly number[]): number {
  if (values.length <= 1) return 50;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return Math.round(((below + (equal - 1) / 2) / (values.length - 1)) * 100);
}

export function computeCreativeScores(
  facts: readonly LearningFact[],
  opts: { userId: string; fetchedAt: string },
): UpsertCreativeScoreArgs[] {
  const creatives = new Map<string, Creative>();
  for (const f of facts) {
    const name = f.row.ad_name?.trim();
    if (!f.eventId || !name) continue;
    const key = `${f.eventId}|${name}`;
    const c = creatives.get(key) ?? {
      eventId: f.eventId,
      name,
      impressions: 0,
      plays3s: 0,
      p100: 0,
      linkClicks: 0,
      spend: 0,
      knownSpend: 0,
      results: 0,
      adSpend: new Map<string, number>(),
    };
    c.impressions += Number(f.row.impressions) || 0;
    c.plays3s += Number(f.row.video_plays_3s) || 0;
    c.p100 += Number(f.row.video_plays_p100) || 0;
    c.linkClicks += Number(f.row.link_clicks) || 0;
    c.spend += f.spendGbp;
    if (f.result != null) {
      c.knownSpend += f.spendGbp;
      c.results += f.result;
    }
    c.adSpend.set(f.row.meta_ad_id, (c.adSpend.get(f.row.meta_ad_id) ?? 0) + f.spendGbp);
    creatives.set(key, c);
  }

  const byEvent = new Map<string, Creative[]>();
  for (const c of creatives.values()) byEvent.set(c.eventId, [...(byEvent.get(c.eventId) ?? []), c]);

  const out: UpsertCreativeScoreArgs[] = [];
  for (const list of byEvent.values()) {
    for (const axis of CREATIVE_SCORE_AXES) {
      const scored = list.map((c) => ({ c, m: metric(c, axis) })).filter((x): x is { c: Creative; m: number } => x.m != null);
      const values = scored.map((x) => x.m);
      for (const { c, m } of scored) {
        const funded = [...c.adSpend.values()].filter((s) => s >= THIN_MIN_AD_SET_SPEND_GBP).length;
        out.push({
          userId: opts.userId,
          eventId: c.eventId,
          creativeName: c.name,
          axis,
          score: percentileRank(m, values),
          significance: confidenceOf(funded, c.spend, axis === "convert" ? c.results : undefined) !== "thin",
          fetchedAt: opts.fetchedAt,
        });
      }
    }
  }
  return out;
}

type Db = Pick<SupabaseClient, "from">;

export const CREATIVE_SCORE_CHUNK = 500;

/** Batched upserts on the (event_id, creative_name, axis) key; a failed chunk is counted and the rest still write. */
export async function writeCreativeScores(
  db: Db,
  rows: readonly UpsertCreativeScoreArgs[],
  chunkSize = CREATIVE_SCORE_CHUNK,
): Promise<{ written: number; failed: number; firstError: string | null }> {
  let written = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({
      user_id: r.userId,
      event_id: r.eventId,
      creative_name: r.creativeName,
      axis: r.axis,
      score: r.score,
      significance: r.significance ?? false,
      ...(r.fetchedAt ? { fetched_at: r.fetchedAt } : {}),
    }));
    const { error } = await db.from("creative_scores").upsert(chunk, { onConflict: CREATIVE_SCORE_CONFLICT });
    if (error) {
      failed += chunk.length;
      firstError ??= error.message;
    } else {
      written += chunk.length;
    }
  }
  return { written, failed, firstError };
}
