import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeDb, op, type FakeCall } from "../../launched-ads/__tests__/fake-db.ts";
import { getClientLearnings, getCreativeScores, getTagPerformance } from "../read.ts";
import { CONFIDENCE_SCORE } from "../shrink.ts";

function tagRow(valueKey: string, stage: string, shrunk: number | null, extra: Record<string, unknown> = {}) {
  return {
    scope: "client",
    scope_id: "client-a",
    dimension: "asset_type",
    value_key: valueKey,
    stage,
    window_days: 90,
    ads: 4,
    funded_ads: 3,
    spend: "120.5",
    results: 40,
    cpr: "3.01",
    index: shrunk,
    shrunk_index: shrunk == null ? null : String(shrunk),
    n_effective: 13,
    confidence: "ok",
    ...extra,
  };
}

const DB: Record<string, unknown[]> = {
  tag_performance: [
    tagRow("motion", "registration", 0.7),
    tagRow("still", "registration", 1.2),
    tagRow("carousel", "registration", 0.9),
    tagRow("text", "registration", null, { confidence: "thin" }),
    tagRow("motion", "ticket_sale", 1.1),
  ],
  creative_tags: [
    { dimension: "asset_type", value_key: "motion", value_label: "Motion" },
    { dimension: "asset_type", value_key: "still", value_label: "Still" },
  ],
  client_funnel_benchmarks: [
    { stage: "reach_to_click", rate: 0.02, n: 5000, confidence: CONFIDENCE_SCORE.strong, provenance: "learned", updated_at: "2026-10-07" },
    { stage: "click_to_lpv", rate: 0.6, n: 0, confidence: null, provenance: "manually-overridden", updated_at: "2026-10-01" },
  ],
  interest_clusters: [
    {
      id: "k1",
      name: "Techno",
      evidence_refreshed_at: "2026-10-07T03:30:00Z",
      live_evidence: { perClient: [{ clientId: "client-a", cprIndex: 1.2, cpr: 2, adSets: 3, fundedAdSets: 3, spend: 200, registrations: 100, confidence: "ok" }] },
    },
    {
      id: "k2",
      name: "House",
      evidence_refreshed_at: "2026-10-07T03:30:00Z",
      live_evidence: { perClient: [{ clientId: "client-a", cprIndex: 0.8, cpr: 1.5, adSets: 2, fundedAdSets: 1, spend: 90, registrations: 60, confidence: "thin" }] },
    },
    { id: "k3", name: "Other client", evidence_refreshed_at: null, live_evidence: { perClient: [{ clientId: "client-b", cprIndex: 0.1 }] } },
  ],
  creative_scores: [
    { creative_name: "Video", axis: "hook", score: 80, significance: true, fetched_at: "2026-10-07T00:00:00Z" },
    { creative_name: "Video", axis: "click", score: 40, significance: true, fetched_at: "2026-10-07T00:00:00Z" },
    { creative_name: "Still", axis: "click", score: 60, significance: false, fetched_at: "2026-10-07T00:00:00Z" },
    { creative_name: "Video", axis: "hook", score: 10, significance: true, fetched_at: "2026-10-06T00:00:00Z" },
  ],
};

function fixtureDb() {
  return fakeDb((call: FakeCall) => {
    let rows = DB[call.table] ?? [];
    if (call.table === "tag_performance") {
      for (const [name, args] of call.ops) {
        if (name === "eq") rows = rows.filter((r) => (r as Record<string, unknown>)[args[0] as string] === args[1]);
      }
    }
    return { data: rows, error: null };
  });
}

describe("learning read module", () => {
  it("getTagPerformance: one scope + stage, best shrunk index first, labels from creative_tags, numbers parsed", async () => {
    const { db, calls } = fixtureDb();
    const rows = await getTagPerformance(db, "client", "client-a", "registration");
    assert.deepEqual(rows.map((r) => r.valueKey), ["motion", "carousel", "still", "text"]);
    assert.equal(rows[0]!.label, "Motion");
    assert.equal(rows[1]!.label, "carousel");
    assert.equal(rows[0]!.spend, 120.5);
    assert.equal(rows[0]!.shrunkIndex, 0.7);
    assert.equal(rows[3]!.shrunkIndex, null);
    const tp = calls.find((c) => c.table === "tag_performance")!;
    assert.deepEqual(tp.ops.filter(([n]) => n === "eq").map(([, a]) => a), [["scope", "client"], ["scope_id", "client-a"], ["stage", "registration"]]);
  });

  it("getClientLearnings: tags by dimension and stage (top / bottom), funnel with provenance, interests by this client's cprIndex", async () => {
    const { db } = fixtureDb();
    const learnings = await getClientLearnings(db, "client-a", { perSide: 1 });
    const reg = learnings.tags.asset_type!.registration!;
    assert.deepEqual(reg.top.map((t) => [t.valueKey, t.confidence]), [["motion", "ok"]]);
    assert.deepEqual(reg.bottom.map((t) => t.valueKey), ["still"]);
    assert.deepEqual(learnings.tags.asset_type!.ticket_sale!.top.map((t) => t.valueKey), ["motion"]);
    assert.deepEqual(learnings.tags.asset_type!.ticket_sale!.bottom, []);

    assert.equal(learnings.funnel.reach_to_click.provenance, "learned");
    assert.equal(learnings.funnel.reach_to_click.rate, 0.02);
    assert.equal(learnings.funnel.click_to_lpv.provenance, "manually-overridden");
    assert.equal(learnings.funnel.lpv_to_purchase.provenance, "seed");
    assert.deepEqual(learnings.funnel.confidenceLabel, { reach_to_click: "strong", click_to_lpv: null, lpv_to_purchase: null });

    assert.deepEqual(learnings.interests.map((i) => [i.name, i.cprIndex, i.confidence]), [["House", 0.8, "thin"], ["Techno", 1.2, "ok"]]);
  });

  it("getCreativeScores: the latest snapshot only, axes folded per creative", async () => {
    const { db, calls } = fixtureDb();
    const scores = await getCreativeScores(db, "e1");
    assert.equal(scores.fetchedAt, "2026-10-07T00:00:00Z");
    assert.deepEqual(scores.creatives, [
      { creativeName: "Still", scores: { click: 60 }, significant: false },
      { creativeName: "Video", scores: { hook: 80, click: 40 }, significant: true },
    ]);
    assert.deepEqual(op(calls[0]!, "eq"), ["event_id", "e1"]);
  });
});
