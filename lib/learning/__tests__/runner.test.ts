import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { currencyResolver } from "../currency.ts";
import type { LearningInputs } from "../joins.ts";
import { LEARNING_JOBS, runLearningRefresh } from "../runner.ts";
import { CLIENTS, NOW, TAGS, fact } from "./fixtures.ts";

function inputs(): LearningInputs {
  return {
    clients: CLIENTS,
    archivedClientIds: new Set(["client-archived"]),
    facts: [
      fact(
        { meta_ad_id: "a1", meta_adset_id: "s1", ad_name: "Motion 1", spend: 10, registrations: 5, impressions: 100, reach: 80, link_clicks: 4, landing_page_views: 3 },
        { clientId: "client-a", eventId: "e1", tagIds: ["t-motion"] },
      ),
    ],
    dropped: { noClient: 0, archived: 0 },
    adSets: [{ meta_adset_id: "s1", client_id: "client-a", event_id: "e1", phase_at_launch: null, interest_ids: ["1"] }],
    tags: TAGS,
    currency: currencyResolver(new Map()),
  };
}

describe("learning-refresh killswitch", () => {
  it("unset or not exactly '1' → skippedReason killswitch, no db call", async () => {
    for (const env of [{}, { ENABLE_LEARNING_REFRESH: "true" }, { ENABLE_LEARNING_REFRESH: "0" }]) {
      const { db, calls } = fakeDb(() => {
        throw new Error("db touched");
      });
      assert.deepEqual(await runLearningRefresh({ env, db }), { ok: true, skippedReason: "killswitch" });
      assert.equal(calls.length, 0);
    }
  });

  it("the route checks the killswitch first; registered at 03:30 UTC, in cron health and CLAUDE.md", () => {
    const route = readFileSync("app/api/cron/learning-refresh/route.ts", "utf8");
    const kill = route.indexOf("isLearningRefreshEnabled(process.env)");
    assert.ok(kill > 0 && kill < route.indexOf("createServiceRoleClient()"));
    assert.match(route, /skippedReason: "killswitch"/);
    assert.doesNotMatch(route, /lib\/meta\/|graphGet|META_ACCESS_TOKEN/);
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    assert.deepEqual(
      vercel.crons.find((c) => c.path === "/api/cron/learning-refresh"),
      { path: "/api/cron/learning-refresh", schedule: "30 3 * * *" },
    );
    assert.match(
      readFileSync("lib/reporting/cron-health-monitor.ts", "utf8"),
      /table: "tag_performance", freshColumn: "computed_at"/,
    );
    const claude = readFileSync("CLAUDE.md", "utf8");
    assert.match(claude, /ENABLE_LEARNING_REFRESH=/);
    assert.match(claude, /\/api\/cron\/learning-refresh/);
  });

  it("no lib/learning module calls Meta", () => {
    for (const file of ["joins", "tag-performance", "creative-scores", "funnel-benchmarks", "interest-evidence", "runner", "read", "shrink", "currency"]) {
      const source = readFileSync(`lib/learning/${file}.ts`, "utf8");
      assert.doesNotMatch(source, /graph\.facebook|graphGet|from "\.\.\/meta\/client/, file);
    }
  });
});

describe("learning-refresh jobs", () => {
  it("every job runs and logs rows; one failing job does not stop the others", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.table === "tag_performance") return { error: { message: "tag table down" } };
      if (call.table === "client_funnel_benchmarks" && op(call, "select")) return { data: [], error: null };
      if (call.table === "interest_clusters" && op(call, "select")) {
        return { data: [{ id: "k1", name: "One", interests: [{ id: "1" }] }], error: null };
      }
      if (call.table === "creative_scores") return { data: { id: "x" }, error: null };
      return { error: null };
    });
    const result = await runLearningRefresh({ env: { ENABLE_LEARNING_REFRESH: "1" }, db, now: NOW, operatorUserId: "op", inputs: inputs() });
    assert.ok(!("skippedReason" in result));
    if ("skippedReason" in result) return;
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result.jobs), [...LEARNING_JOBS]);
    assert.equal(result.jobs.tag_performance.ok, false);
    assert.match(result.jobs.tag_performance.error ?? "", /tag table down/);
    assert.equal(result.jobs.creative_scores.ok, true);
    // A static ad: click and convert, no hook or watch.
    assert.equal(result.jobs.creative_scores.rows, 2);
    assert.equal(result.jobs.client_funnel_benchmarks.ok, true);
    assert.equal(result.jobs.client_funnel_benchmarks.rows, 2);
    assert.equal(result.jobs.interest_live_evidence.ok, true);
    assert.equal(result.jobs.interest_live_evidence.rows, 1);
    const update = calls.find((c) => c.table === "interest_clusters" && op(c, "update"))!;
    assert.equal((op(update, "update")?.[0] as { live_evidence: { adSets: number } }).live_evidence.adSets, 1);
  });

  it("dry run computes every job and writes nothing", async () => {
    const { db, calls } = fakeDb((call) =>
      call.table === "interest_clusters" ? { data: [{ id: "k1", name: "One", interests: [{ id: "1" }] }], error: null } : { error: null },
    );
    const result = await runLearningRefresh({ env: {}, db, now: NOW, dryRun: true, operatorUserId: "op", inputs: inputs() });
    if ("skippedReason" in result) throw new Error("dry run must not hit the killswitch");
    assert.equal(result.ok, true);
    assert.deepEqual(
      LEARNING_JOBS.map((n) => result.jobs[n].rows),
      [2, 3, 2, 1],
    );
    assert.equal(result.preview?.tagPerformance.length, 3);
    assert.ok(calls.every((c) => !op(c, "upsert") && !op(c, "update") && !op(c, "delete") && !op(c, "insert")));
    assert.deepEqual(result.joinRates["client-a"], { adDays: 1, tagged: 1, byAdId: 0, byName: 1, rate: 1 });
  });
});

describe("migration 186", () => {
  const sql = readFileSync("supabase/migrations/186_tag_performance.sql", "utf8");

  it("tag_performance with every column, the unique key and an operator-scoped read policy", () => {
    assert.match(sql, /create table if not exists tag_performance/);
    for (const column of [
      "scope", "scope_id", "dimension", "value_key", "stage", "window_days", "ads", "funded_ads", "spend",
      "impressions", "link_clicks", "landing_page_views", "video_plays_3s", "results", "cpr", "ctr",
      "baseline_cpr", '"index"', "pool_index", "n_effective", "shrunk_index", "confidence", "computed_at",
    ]) {
      assert.match(sql, new RegExp(`\\n  ${column.replace(/"/g, '"')}\\s+\\w`), column);
    }
    assert.match(sql, /check \(scope in \('client', 'vertical', 'all'\)\)/);
    assert.match(sql, /check \(confidence in \('thin', 'ok', 'strong'\)\)/);
    assert.match(sql, /unique \(scope, scope_id, dimension, value_key, stage, window_days\)/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /for select [\s\S]*to authenticated using/);
    assert.match(sql, /c\.user_id = auth\.uid\(\)/);
    assert.doesNotMatch(sql, /for (insert|update|all)/);
  });

  it("adds interest_clusters.evidence_refreshed_at and live_evidence, and leaves evidence alone", () => {
    assert.match(sql, /add column if not exists evidence_refreshed_at timestamptz/);
    assert.match(sql, /add column if not exists live_evidence jsonb/);
    assert.doesNotMatch(sql, /alter column evidence|drop column/);
    assert.match(sql, /notify pgrst, 'reload schema'/);
  });
});
