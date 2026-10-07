/**
 * interest_clusters.live_evidence (migration 186): every non-archived
 * cluster of the operator joined to the launched ad sets whose sorted
 * interest ids equal the cluster's (the report's key rule), then to
 * ad_daily_insights by meta_adset_id, registration stage only.
 *
 * cprIndex follows the report: the cluster's CPR ÷ its clients' pooled
 * CPR (`clientBaselineCpr` over each client's registration-stage ad sets
 * with interests), weighted by the cluster's spend on each client. Spend
 * is GBP. `evidence`, the 6 Oct offline snapshot, is never written.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  clientBaselineCpr,
  fundedAdSetCount,
  type AggregateContext,
  type AnalysisAdSet,
} from "../analysis/interest-performance.ts";
import { interestKeyOf, type LaunchedAdSetRow, type LearningClient, type LearningFact } from "./joins.ts";
import { confidenceOf, type Confidence } from "./shrink.ts";

export type InterestCluster = { id: string; name: string; interests: unknown };

export type ClusterClientEvidence = {
  clientId: string;
  client: string;
  adSets: number;
  fundedAdSets: number;
  spend: number;
  registrations: number;
  cpr: number | null;
  clientBaselineCpr: number | null;
  cprIndex: number | null;
  confidence: Confidence;
};

export type LiveEvidence = {
  clusterKey: string;
  stage: "registration";
  adSets: number;
  fundedAdSets: number;
  spend: number;
  registrations: number;
  cpr: number | null;
  clients: string[];
  clientBaselineCpr: number | null;
  cprIndex: number | null;
  confidence: Confidence;
  perClient: ClusterClientEvidence[];
  computedAt: string;
};

function round(value: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Spend is already GBP, so the report's context is GBP 1:1 with one action type. */
const GBP_CTX: AggregateContext = { fx: { GBP: 1 }, chosenType: new Proxy({}, { get: () => "complete_registration" }), firstParty: {} };

function analysisAdSet(id: string, clientName: string, spend: number, registrations: number): AnalysisAdSet {
  return {
    id,
    name: id,
    accountId: "",
    accountName: "",
    currency: "GBP",
    campaignId: "",
    campaignName: "",
    campaignObjective: null,
    optimizationGoal: null,
    customEventType: null,
    effectiveStatus: null,
    startTime: null,
    endTime: null,
    interests: [],
    interestsAcrossFlexGroups: false,
    customAudienceCount: 0,
    excludedCustomAudienceCount: 0,
    advantageAudience: false,
    spend,
    impressions: 0,
    reach: 0,
    linkClicks: 0,
    regActions: { complete_registration: registrations },
    hasInsights: true,
    hasAnyActions: registrations > 0,
    launched: null,
    clientName,
  };
}

export function computeLiveEvidence(
  clusters: readonly InterestCluster[],
  adSets: readonly LaunchedAdSetRow[],
  facts: readonly LearningFact[],
  clients: readonly LearningClient[],
  opts: { now: Date },
): Map<string, LiveEvidence> {
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const keyOf = new Map<string, string>();
  for (const a of adSets) {
    const key = interestKeyOf(a.interest_ids);
    if (key) keyOf.set(a.meta_adset_id, key);
  }
  // Registration-stage totals per launched ad set with interests, by the client of its ad-days.
  type Sum = { clientId: string; key: string; spend: number; registrations: number };
  const perAdSet = new Map<string, Sum>();
  for (const f of facts) {
    const id = f.row.meta_adset_id;
    const key = id ? keyOf.get(id) : undefined;
    if (!id || !key || !f.clientId || f.stage !== "registration") continue;
    const s = perAdSet.get(id) ?? { clientId: f.clientId, key, spend: 0, registrations: 0 };
    s.spend += f.spendGbp;
    s.registrations += f.result ?? 0;
    perAdSet.set(id, s);
  }
  const asAnalysis = (id: string, s: Sum) => analysisAdSet(id, s.clientId, s.spend, s.registrations);
  const baselineByClient = new Map<string, number | null>();
  const byClient = new Map<string, AnalysisAdSet[]>();
  for (const [id, s] of perAdSet) byClient.set(s.clientId, [...(byClient.get(s.clientId) ?? []), asAnalysis(id, s)]);
  for (const [clientId, list] of byClient) baselineByClient.set(clientId, clientBaselineCpr(list, GBP_CTX).baselineCpr);

  const out = new Map<string, LiveEvidence>();
  for (const cluster of clusters) {
    const key = interestKeyOf(cluster.interests);
    const matched = [...perAdSet.entries()].filter(([, s]) => key && s.key === key);
    const groups = new Map<string, AnalysisAdSet[]>();
    for (const [id, s] of matched) groups.set(s.clientId, [...(groups.get(s.clientId) ?? []), asAnalysis(id, s)]);
    const perClient: ClusterClientEvidence[] = [...groups.entries()]
      .map(([clientId, list]) => {
        const pooled = clientBaselineCpr(list, GBP_CTX);
        const funded = fundedAdSetCount(list, GBP_CTX);
        const base = baselineByClient.get(clientId) ?? null;
        return {
          clientId,
          client: clientName.get(clientId) ?? clientId,
          adSets: list.length,
          fundedAdSets: funded,
          spend: pooled.spendGbp,
          registrations: pooled.registrations,
          cpr: pooled.baselineCpr,
          clientBaselineCpr: base,
          cprIndex: pooled.baselineCpr != null && base ? round(pooled.baselineCpr / base) : null,
          confidence: confidenceOf(funded, pooled.spendGbp, pooled.registrations),
        };
      })
      .sort((a, b) => b.spend - a.spend || a.client.localeCompare(b.client));
    const all = [...groups.values()].flat();
    const total = clientBaselineCpr(all, GBP_CTX);
    const funded = fundedAdSetCount(all, GBP_CTX);
    let weighted = 0;
    let weight = 0;
    for (const c of perClient) {
      if (c.clientBaselineCpr == null || c.spend <= 0) continue;
      weighted += c.clientBaselineCpr * c.spend;
      weight += c.spend;
    }
    const baseline = weight > 0 ? round(weighted / weight) : null;
    out.set(cluster.id, {
      clusterKey: key,
      stage: "registration",
      adSets: all.length,
      fundedAdSets: funded,
      spend: total.spendGbp,
      registrations: total.registrations,
      cpr: total.baselineCpr,
      clients: perClient.map((c) => c.client).sort(),
      clientBaselineCpr: baseline,
      cprIndex: total.baselineCpr != null && baseline ? round(total.baselineCpr / baseline) : null,
      confidence: confidenceOf(funded, total.spendGbp, total.registrations),
      perClient,
      computedAt: opts.now.toISOString(),
    });
  }
  return out;
}

type Db = Pick<SupabaseClient, "from">;

export async function loadOperatorClusters(db: Db, operatorUserId: string): Promise<InterestCluster[]> {
  const { data, error } = await db
    .from("interest_clusters")
    .select("id, name, interests")
    .eq("user_id", operatorUserId)
    .is("archived_at", null);
  if (error) throw new Error(`interest_clusters read: ${error.message}`);
  return (data ?? []) as InterestCluster[];
}

/** live_evidence + evidence_refreshed_at only; `evidence` is not in the update. */
export async function writeLiveEvidence(
  db: Db,
  evidence: ReadonlyMap<string, LiveEvidence>,
  refreshedAt: string,
): Promise<{ written: number }> {
  let written = 0;
  for (const [id, live] of evidence) {
    const { error } = await db
      .from("interest_clusters")
      .update({ live_evidence: live, evidence_refreshed_at: refreshedAt })
      .eq("id", id);
    if (error) throw new Error(`interest_clusters update ${id}: ${error.message} (written ${written})`);
    written += 1;
  }
  return { written };
}
