/**
 * client_funnel_benchmarks learner (migration 158, roadmap C.2), 180 days
 * of learning facts per active client:
 *   reach_to_click  = link_clicks ÷ reach
 *   click_to_lpv    = landing_page_views ÷ link_clicks
 *   lpv_to_purchase = purchases ÷ landing_page_views, ticket-sale days only
 *                     (registration-phase LPVs land on signup pages and
 *                     cannot purchase)
 * Reach is summed across ad-days, so it overcounts people and
 * reach_to_click reads low. n = impressions; confidence is the thin / ok /
 * strong rule stored as CONFIDENCE_SCORE. A rate above 1 (the 158 check)
 * is skipped and reported, never clamped. Rows a person set
 * (provenance 'manually-overridden') are never overwritten.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { THIN_MIN_AD_SET_SPEND_GBP } from "../analysis/interest-performance.ts";
import type { ClientFunnelBenchmarkStage } from "../dashboard/client-funnel-benchmarks.ts";
import type { LearningClient, LearningFact } from "./joins.ts";
import { windowStart } from "./tag-performance.ts";
import { CONFIDENCE_SCORE, confidenceOf } from "./shrink.ts";

export const FUNNEL_WINDOW_DAYS = 180;

export type FunnelBenchmarkRow = {
  client_id: string;
  stage: ClientFunnelBenchmarkStage;
  rate: number;
  n: number;
  confidence: number;
  provenance: "learned";
};

export type FunnelSkip = { clientId: string; stage: ClientFunnelBenchmarkStage; reason: "no_denominator" | "rate_above_1"; value?: number };

export function computeFunnelBenchmarks(
  facts: readonly LearningFact[],
  clients: readonly LearningClient[],
  opts: { now: Date; windowDays?: number },
): { rows: FunnelBenchmarkRow[]; skipped: FunnelSkip[] } {
  const since = windowStart(opts.now, opts.windowDays ?? FUNNEL_WINDOW_DAYS);
  const active = new Set(clients.map((c) => c.id));
  type Sum = { reach: number; clicks: number; lpv: number; ticketLpv: number; purchases: number; impressions: number; spend: number; ads: Map<string, number> };
  const sums = new Map<string, Sum>();
  for (const f of facts) {
    if (!f.clientId || !active.has(f.clientId) || f.row.date < since) continue;
    const s = sums.get(f.clientId) ?? { reach: 0, clicks: 0, lpv: 0, ticketLpv: 0, purchases: 0, impressions: 0, spend: 0, ads: new Map() };
    const lpv = Number(f.row.landing_page_views) || 0;
    s.reach += Number(f.row.reach) || 0;
    s.clicks += Number(f.row.link_clicks) || 0;
    s.lpv += lpv;
    if (f.stage === "ticket_sale") {
      s.ticketLpv += lpv;
      s.purchases += Number(f.row.purchases) || 0;
    }
    s.impressions += Number(f.row.impressions) || 0;
    s.spend += f.spendGbp;
    s.ads.set(f.row.meta_ad_id, (s.ads.get(f.row.meta_ad_id) ?? 0) + f.spendGbp);
    sums.set(f.clientId, s);
  }
  const rows: FunnelBenchmarkRow[] = [];
  const skipped: FunnelSkip[] = [];
  for (const [clientId, s] of sums) {
    const funded = [...s.ads.values()].filter((v) => v >= THIN_MIN_AD_SET_SPEND_GBP).length;
    const confidence = CONFIDENCE_SCORE[confidenceOf(funded, s.spend)];
    const stages: [ClientFunnelBenchmarkStage, number, number][] = [
      ["reach_to_click", s.clicks, s.reach],
      ["click_to_lpv", s.lpv, s.clicks],
      ["lpv_to_purchase", s.purchases, s.ticketLpv],
    ];
    for (const [stage, num, den] of stages) {
      if (den <= 0) {
        skipped.push({ clientId, stage, reason: "no_denominator" });
        continue;
      }
      const rate = num / den;
      if (rate > 1) {
        skipped.push({ clientId, stage, reason: "rate_above_1", value: Math.round(rate * 1000) / 1000 });
        continue;
      }
      rows.push({ client_id: clientId, stage, rate: Math.round(rate * 1e6) / 1e6, n: s.impressions, confidence, provenance: "learned" });
    }
  }
  return { rows, skipped };
}

type Db = Pick<SupabaseClient, "from">;

/** Upsert learned rows on (client_id, stage), except where a person set the row. */
export async function writeFunnelBenchmarks(
  db: Db,
  rows: readonly FunnelBenchmarkRow[],
): Promise<{ written: number; preservedManual: number }> {
  if (!rows.length) return { written: 0, preservedManual: 0 };
  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const { data, error } = await db
    .from("client_funnel_benchmarks")
    .select("client_id, stage, provenance")
    .in("client_id", clientIds);
  if (error) throw new Error(`client_funnel_benchmarks read: ${error.message}`);
  const manual = new Set(
    ((data ?? []) as { client_id: string; stage: string; provenance: string }[])
      .filter((r) => r.provenance === "manually-overridden")
      .map((r) => `${r.client_id}|${r.stage}`),
  );
  const writable = rows.filter((r) => !manual.has(`${r.client_id}|${r.stage}`));
  if (writable.length) {
    const { error: upsertError } = await db
      .from("client_funnel_benchmarks")
      .upsert(writable, { onConflict: "client_id,stage" });
    if (upsertError) throw new Error(`client_funnel_benchmarks upsert: ${upsertError.message}`);
  }
  return { written: writable.length, preservedManual: rows.length - writable.length };
}
