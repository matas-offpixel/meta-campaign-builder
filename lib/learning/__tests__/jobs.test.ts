import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeDb, op, type FakeCall } from "../../launched-ads/__tests__/fake-db.ts";
import { computeCreativeScores, percentileRank, writeCreativeScores } from "../creative-scores.ts";
import { computeFunnelBenchmarks, writeFunnelBenchmarks } from "../funnel-benchmarks.ts";
import { computeLiveEvidence, writeLiveEvidence } from "../interest-evidence.ts";
import { loadLearningInputs } from "../joins.ts";
import { computeTagPerformance, writeTagPerformance, type TagPerformanceRow } from "../tag-performance.ts";
import { CLIENTS, NOW, TAGS, fact } from "./fixtures.ts";

const row = (rows: TagPerformanceRow[], scope: string, scopeId: string, key: string, stage = "registration") =>
  rows.find((r) => r.scope === scope && r.scope_id === scopeId && r.value_key === key && r.stage === stage);

describe("tag_performance job", () => {
  // client-a: two motion ads (£10/5 regs = £2, £20/5 = £4) and one still ad (£10/1 = £10).
  // client-b: one motion ad (£8/0 regs → worst) and one still ad (£6/3 = £2).
  const facts = [
    fact({ meta_ad_id: "a1", spend: 10, registrations: 5, impressions: 1000, link_clicks: 20 }, { clientId: "client-a", tagIds: ["t-motion"] }),
    fact({ meta_ad_id: "a2", spend: 20, registrations: 5 }, { clientId: "client-a", tagIds: ["t-motion"] }),
    fact({ meta_ad_id: "a3", spend: 10, registrations: 1 }, { clientId: "client-a", tagIds: ["t-still"] }),
    fact({ meta_ad_id: "b1", spend: 8, registrations: 0 }, { clientId: "client-b", tagIds: ["t-motion"] }),
    fact({ meta_ad_id: "b2", spend: 6, registrations: 3 }, { clientId: "client-b", tagIds: ["t-still"] }),
    fact({ meta_ad_id: "old", spend: 500, registrations: 1, date: "2026-06-01" }, { clientId: "client-a", tagIds: ["t-still"] }),
    fact({ meta_ad_id: "untagged", spend: 50, registrations: 1 }, { clientId: "client-a" }),
    fact({ meta_ad_id: "archived", spend: 90, registrations: 90 }, { clientId: "client-archived", tagIds: ["t-motion"] }),
  ];
  const rows = computeTagPerformance(facts, CLIENTS, TAGS, { now: NOW });

  it("client, vertical and all rows per tag × stage, from ads in the 90-day window only", () => {
    // 2 tags × (client-a, client-b, vertical music, all).
    assert.equal(rows.length, 2 * 4);
    const motionA = row(rows, "client", "client-a", "motion")!;
    assert.equal(motionA.ads, 2);
    assert.equal(motionA.funded_ads, 2);
    assert.equal(motionA.spend, 30);
    assert.equal(motionA.results, 10);
    assert.equal(motionA.cpr, 3);
    assert.equal(motionA.ctr, 0.02);
    assert.equal(row(rows, "client", "client-a", "still")!.spend, 10);
  });

  it("baseline = pooled spend ÷ results over the scope's tagged ads in the stage, not a median of per-ad costs", () => {
    // client-a: £40 / 11 regs.
    assert.equal(row(rows, "client", "client-a", "motion")!.baseline_cpr, 3.6364);
    assert.equal(row(rows, "client", "client-a", "motion")!.index, 0.825);
    // vertical music: £54 / 14 regs.
    assert.equal(row(rows, "vertical", "music", "motion")!.baseline_cpr, 3.8571);
    // client-b: £14 / 3 regs; its motion ad sold nothing, so no cpr.
    assert.equal(row(rows, "client", "client-b", "motion")!.baseline_cpr, 4.6667);
    assert.equal(row(rows, "client", "client-b", "motion")!.cpr, null);
  });

  it("ticket_sale gets a pooled baseline when most ads have no purchase; under 10 purchases is thin", () => {
    const ticket = (id: string, purchases: number, tag: string) =>
      fact({ meta_ad_id: id, spend: 100, purchases }, { clientId: "client-a", stage: "ticket_sale", tagIds: [tag] });
    const sparse = [
      ticket("p1", 0, "t-motion"),
      ticket("p2", 0, "t-motion"),
      ticket("p3", 4, "t-motion"),
      ticket("p4", 0, "t-still"),
      ticket("p5", 0, "t-still"),
      ticket("p6", 0, "t-still"),
      ticket("p7", 12, "t-still"),
    ];
    const out = computeTagPerformance(sparse, CLIENTS, TAGS, { now: NOW });
    const motion = row(out, "client", "client-a", "motion", "ticket_sale")!;
    const still = row(out, "client", "client-a", "still", "ticket_sale")!;
    // £700 / 16 purchases; per-ad median would be "no purchase".
    assert.equal(motion.baseline_cpr, 43.75);
    assert.equal(motion.cpr, 75);
    assert.equal(still.cpr, 33.3333);
    assert.equal(still.index, 0.7619);
    // Both clear 3 funded ads and £150; motion has 4 purchases → thin, still has 12 → ok.
    assert.equal(motion.confidence, "thin");
    assert.equal(still.confidence, "ok");
  });

  it("client rows shrink toward vertical, vertical toward all, all toward 1", () => {
    const all = row(rows, "all", "all", "motion")!;
    assert.equal(all.pool_index, 1);
    const vertical = row(rows, "vertical", "music", "motion")!;
    assert.equal(vertical.pool_index, all.index);
    const motionA = row(rows, "client", "client-a", "motion")!;
    // vertical motion is thin (£38) → pool falls back to all; all is thin too → the last pool with an index.
    assert.equal(motionA.pool_index, all.index);
    assert.equal(motionA.shrunk_index, Math.round(((2 * motionA.index! + 10 * all.index!) / 12) * 1e4) / 1e4);
    assert.equal(motionA.confidence, "thin");
  });

  it("an archived (or unknown) client's facts reach no scope", () => {
    assert.ok(rows.every((r) => r.scope_id !== "client-archived"));
    assert.equal(row(rows, "all", "all", "motion")!.ads, 3);
  });

  it("writer upserts on the unique key, then deletes this window's keys the run did not write", async () => {
    const { db, calls } = fakeDb(() => ({ error: null, count: 4 }));
    const result = await writeTagPerformance(db, rows, { computedAt: NOW.toISOString() });
    assert.deepEqual(result, { written: rows.length, deleted: 4 });
    const [upsert, del] = calls;
    assert.deepEqual(op(upsert!, "upsert")?.[1], { onConflict: "scope,scope_id,dimension,value_key,stage,window_days" });
    assert.ok(op(del!, "delete"));
    assert.deepEqual(op(del!, "eq"), ["window_days", 90]);
    assert.deepEqual(op(del!, "lt"), ["computed_at", NOW.toISOString()]);
  });

  it("a failed upsert skips the stale delete", async () => {
    const { db, calls } = fakeDb((call) => (op(call, "upsert") ? { error: { message: "boom" } } : { error: null }));
    await assert.rejects(writeTagPerformance(db, rows, { computedAt: NOW.toISOString() }), /boom/);
    assert.ok(calls.every((c) => !op(c, "delete")));
  });
});

describe("creative_scores job", () => {
  it("percentile rank 0–100 within the event; ties share; one creative is 50", () => {
    assert.equal(percentileRank(1, [1, 2, 3]), 0);
    assert.equal(percentileRank(3, [1, 2, 3]), 100);
    assert.equal(percentileRank(2, [1, 2, 2, 3]), 50);
    assert.equal(percentileRank(7, [7]), 50);
  });

  it("per (event, ad name): hook and watch for videos only, click, convert on known-stage spend; significance = not thin", () => {
    const facts = [
      ...[1, 2, 3].map((i) =>
        fact(
          { meta_ad_id: `v${i}`, ad_name: "Video", spend: 60, impressions: 1000, video_plays_3s: 300, video_plays_p100: 30, link_clicks: 10, registrations: 6 },
          { clientId: "client-a", eventId: "e1" },
        ),
      ),
      fact({ meta_ad_id: "s1", ad_name: "Still", spend: 20, impressions: 1000, link_clicks: 30, registrations: 1 }, { clientId: "client-a", eventId: "e1" }),
      fact({ meta_ad_id: "s2", ad_name: "Still", spend: 20, registrations: 9 }, { clientId: "client-a", eventId: "e1", stage: "unknown" }),
      fact({ meta_ad_id: "x", ad_name: "Elsewhere", spend: 5, impressions: 10 }, { clientId: "client-a", eventId: "e2" }),
    ];
    const rows = computeCreativeScores(facts, { userId: "op", fetchedAt: "2026-10-07T00:00:00.000Z" });
    const score = (event: string, name: string, axis: string) =>
      rows.find((r) => r.eventId === event && r.creativeName === name && r.axis === axis);
    assert.equal(score("e1", "Video", "hook")!.score, 50);
    assert.equal(score("e1", "Still", "hook"), undefined);
    assert.equal(score("e1", "Still", "watch"), undefined);
    assert.equal(score("e1", "Still", "click")!.score, 100);
    assert.equal(score("e1", "Video", "click")!.score, 0);
    // Video 18 regs / £180 = 0.1; Still 1 reg / £20 = 0.05 (the unknown-stage day is left out).
    assert.equal(score("e1", "Video", "convert")!.score, 100);
    assert.equal(score("e1", "Still", "convert")!.score, 0);
    assert.equal(score("e1", "Video", "convert")!.significance, true);
    assert.equal(score("e1", "Still", "convert")!.significance, false);
    assert.equal(score("e2", "Elsewhere", "click")!.score, 50);
    assert.ok(rows.every((r) => r.userId === "op" && r.fetchedAt === "2026-10-07T00:00:00.000Z"));
  });

  it("writes through upsertCreativeScore and counts failures without stopping", async () => {
    const { db, calls } = fakeDb((call: FakeCall) => {
      const values = op(call, "upsert")?.[0] as { creative_name: string };
      return values.creative_name === "bad" ? { data: null, error: { message: "nope" } } : { data: { id: "x" }, error: null };
    });
    const base = { userId: "op", eventId: "e1", axis: "click" as const, score: 50, fetchedAt: "2026-10-07T00:00:00.000Z" };
    const result = await writeCreativeScores(db, [
      { ...base, creativeName: "good" },
      { ...base, creativeName: "bad" },
      { ...base, creativeName: "good 2" },
    ]);
    assert.deepEqual(result, { written: 2, failed: 1, firstError: "nope" });
    assert.ok(calls.every((c) => c.table === "creative_scores"));
    assert.deepEqual(op(calls[0]!, "upsert")?.[1], { onConflict: "event_id,creative_name,axis,fetched_at" });
  });
});

describe("client_funnel_benchmarks job", () => {
  it("rates over 180 days; lpv_to_purchase on ticket-sale days; n = impressions; rate > 1 skipped, not clamped", () => {
    const facts = [
      fact({ meta_ad_id: "r", spend: 200, reach: 1000, link_clicks: 50, landing_page_views: 40, impressions: 3000 }, { clientId: "client-a" }),
      fact(
        { meta_ad_id: "t", spend: 100, reach: 1000, link_clicks: 50, landing_page_views: 40, purchases: 2, impressions: 2000 },
        { clientId: "client-a", stage: "ticket_sale" },
      ),
      fact({ meta_ad_id: "old", reach: 1_000_000, date: "2026-01-01" }, { clientId: "client-a" }),
      fact({ meta_ad_id: "b", spend: 10, reach: 100, link_clicks: 5, landing_page_views: 9, impressions: 100 }, { clientId: "client-b" }),
      fact({ meta_ad_id: "z", spend: 10, reach: 100, link_clicks: 5 }, { clientId: "client-archived" }),
    ];
    const { rows, skipped } = computeFunnelBenchmarks(facts, CLIENTS, { now: NOW });
    const a = Object.fromEntries(rows.filter((r) => r.client_id === "client-a").map((r) => [r.stage, r]));
    assert.equal(a.reach_to_click!.rate, 0.05);
    assert.equal(a.click_to_lpv!.rate, 0.8);
    assert.equal(a.lpv_to_purchase!.rate, 0.05);
    assert.equal(a.reach_to_click!.n, 5000);
    assert.equal(a.reach_to_click!.provenance, "learned");
    assert.equal(a.reach_to_click!.confidence, 0);
    assert.ok(rows.every((r) => r.client_id !== "client-archived"));
    assert.deepEqual(skipped, [
      { clientId: "client-b", stage: "click_to_lpv", reason: "rate_above_1", value: 1.8 },
      { clientId: "client-b", stage: "lpv_to_purchase", reason: "no_denominator" },
    ]);
  });

  it("never overwrites a manually-overridden row", async () => {
    const { db, calls } = fakeDb((call) =>
      op(call, "select")
        ? { data: [{ client_id: "client-a", stage: "click_to_lpv", provenance: "manually-overridden" }, { client_id: "client-a", stage: "reach_to_click", provenance: "learned" }], error: null }
        : { error: null },
    );
    const rows = (["reach_to_click", "click_to_lpv"] as const).map((stage) => ({
      client_id: "client-a",
      stage,
      rate: 0.1,
      n: 10,
      confidence: 0,
      provenance: "learned" as const,
    }));
    assert.deepEqual(await writeFunnelBenchmarks(db, rows), { written: 1, preservedManual: 1 });
    const upsert = calls.find((c) => op(c, "upsert"))!;
    assert.deepEqual((op(upsert, "upsert")?.[0] as { stage: string }[]).map((r) => r.stage), ["reach_to_click"]);
    assert.deepEqual(op(upsert, "upsert")?.[1], { onConflict: "client_id,stage" });
  });
});

describe("interest_clusters.live_evidence job", () => {
  const adSets = [
    { meta_adset_id: "s1", client_id: "client-a", event_id: null, phase_at_launch: null, interest_ids: ["2", "1"] },
    { meta_adset_id: "s2", client_id: "client-a", event_id: null, phase_at_launch: null, interest_ids: ["1", "2", "3"] },
    { meta_adset_id: "s3", client_id: "client-b", event_id: null, phase_at_launch: null, interest_ids: [{ id: "1" }, { id: "2" }] },
  ];
  const facts = [
    fact({ meta_ad_id: "a", meta_adset_id: "s1", spend: 100, registrations: 50 }, { clientId: "client-a" }),
    fact({ meta_ad_id: "b", meta_adset_id: "s2", spend: 100, registrations: 25 }, { clientId: "client-a" }),
    fact({ meta_ad_id: "c", meta_adset_id: "s1", spend: 400, purchases: 9 }, { clientId: "client-a", stage: "ticket_sale" }),
    fact({ meta_ad_id: "d", meta_adset_id: "s3", spend: 30, registrations: 10 }, { clientId: "client-b" }),
  ];
  const clusters = [
    { id: "k12", name: "One + two", interests: [{ id: "1", name: "One" }, { id: "2", name: "Two" }] },
    { id: "k9", name: "Never ran", interests: [{ id: "9", name: "Nine" }] },
  ];
  const live = computeLiveEvidence(clusters, adSets, facts, CLIENTS, { now: NOW });

  it("exact sorted-id match, registration stage only, per-client breakdown with cprIndex vs the client's pooled CPR", () => {
    const e = live.get("k12")!;
    assert.equal(e.adSets, 2);
    assert.equal(e.spend, 130);
    assert.equal(e.registrations, 60);
    assert.deepEqual(e.clients, ["Client A", "Client B"]);
    const a = e.perClient.find((p) => p.clientId === "client-a")!;
    // client-a pooled: £200 / 75 regs = 2.67; cluster slice £100 / 50 = 2 → 0.75.
    assert.equal(a.clientBaselineCpr, 2.67);
    assert.equal(a.cpr, 2);
    assert.equal(a.cprIndex, 0.75);
    assert.equal(e.perClient.find((p) => p.clientId === "client-b")!.cprIndex, 1);
    assert.equal(e.confidence, "thin");
  });

  it("a cluster no ad set ran still gets a row of zeros", () => {
    assert.deepEqual(
      { ...live.get("k9")!, computedAt: undefined },
      {
        clusterKey: "9",
        stage: "registration",
        adSets: 0,
        fundedAdSets: 0,
        spend: 0,
        registrations: 0,
        cpr: null,
        clients: [],
        clientBaselineCpr: null,
        cprIndex: null,
        confidence: "thin",
        perClient: [],
        computedAt: undefined,
      },
    );
  });

  it("writes live_evidence and evidence_refreshed_at only, never evidence", async () => {
    const { db, calls } = fakeDb(() => ({ error: null }));
    assert.deepEqual(await writeLiveEvidence(db, live, NOW.toISOString()), { written: 2 });
    for (const call of calls) {
      assert.deepEqual(Object.keys(op(call, "update")?.[0] as object).sort(), ["evidence_refreshed_at", "live_evidence"]);
    }
  });
});

describe("loadLearningInputs", () => {
  it("drops an archived client's ad-days and ad sets, and ad-days with no client", async () => {
    const tables: Record<string, unknown[]> = {
      clients: [
        { id: "client-a", name: "A", vertical: "music", user_id: "op", meta_ad_account_id: "111" },
        { id: "client-x", name: "X", vertical: "music", user_id: "op", meta_ad_account_id: "222" },
      ],
      events: [],
      launched_ads: [
        { meta_ad_id: "ad-a", client_id: "client-a", event_id: null },
        { meta_ad_id: "ad-x", client_id: "client-x", event_id: null },
      ],
      launched_ad_sets: [
        { meta_adset_id: "s-a", client_id: "client-a", event_id: null, phase_at_launch: null, interest_ids: ["1"] },
        { meta_adset_id: "s-x", client_id: "client-x", event_id: null, phase_at_launch: null, interest_ids: ["1"] },
      ],
      creative_tag_assignments: [],
      creative_tags: [],
      bm_ad_accounts: [],
      ad_daily_insights: ["ad-a", "ad-x", "ad-nobody"].map((id) => ({ meta_ad_id: id, ad_account_id: "act_111", date: "2026-10-01", spend: 1 })),
    };
    const { db } = fakeDb((call) => {
      if (call.table === "clients" && op(call, "eq")?.[1] === "archived") return { data: [{ id: "client-x" }], error: null };
      return { data: tables[call.table] ?? [], error: null };
    });
    const inputs = await loadLearningInputs(db);
    assert.deepEqual(inputs.clients.map((c) => c.id), ["client-a"]);
    assert.deepEqual(inputs.facts.map((f) => f.row.meta_ad_id), ["ad-a"]);
    assert.deepEqual(inputs.dropped, { noClient: 1, archived: 1 });
    assert.deepEqual(inputs.adSets.map((a) => a.meta_adset_id), ["s-a"]);
  });
});
