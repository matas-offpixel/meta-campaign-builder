import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { fetchAdAccountInsights, insightsParams } from "../fetch.ts";
import { insightsWindow, runAdDailyInsights } from "../runner.ts";

const ON = { ENABLE_AD_DAILY_INSIGHTS: "1" };

function metaError(code: number, message: string) {
  return Object.assign(new Error(message), { code });
}

function adRow(adId: string, date = "2026-10-05") {
  return { ad_id: adId, date_start: date, spend: "1", actions: [] };
}

describe("ad-daily-insights killswitch", () => {
  it("unset or not exactly '1' → skippedReason killswitch, no db or Meta call", async () => {
    for (const env of [{}, { ENABLE_AD_DAILY_INSIGHTS: "true" }, { ENABLE_AD_DAILY_INSIGHTS: "0" }]) {
      const { db, calls } = fakeDb(() => {
        throw new Error("db touched");
      });
      let metaCalls = 0;
      const result = await runAdDailyInsights({
        env,
        db,
        graphGet: async () => {
          metaCalls++;
          return {};
        },
      });
      assert.deepEqual(result, { ok: true, skippedReason: "killswitch" });
      assert.equal(calls.length, 0);
      assert.equal(metaCalls, 0);
    }
  });

  it("the route checks the killswitch before Meta and is registered nightly + in cron health", () => {
    const route = readFileSync("app/api/cron/ad-daily-insights/route.ts", "utf8");
    const kill = route.indexOf("isAdDailyInsightsEnabled(process.env)");
    assert.ok(kill > 0 && kill < route.indexOf("META_ACCESS_TOKEN"));
    assert.match(route, /skippedReason: "killswitch"/);
    assert.match(route, /maxAttempts: 1/);
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    assert.deepEqual(
      vercel.crons.find((c) => c.path === "/api/cron/ad-daily-insights"),
      { path: "/api/cron/ad-daily-insights", schedule: "30 2 * * *" },
    );
    assert.match(
      readFileSync("lib/reporting/cron-health-monitor.ts", "utf8"),
      /table: "ad_daily_insights", freshColumn: "fetched_at"/,
    );
    assert.match(readFileSync("CLAUDE.md", "utf8"), /ENABLE_AD_DAILY_INSIGHTS=/);
  });
});

describe("insights request", () => {
  it("level=ad, daily, spend > 0 server-side, rollup attribution windows", () => {
    const p = insightsParams("2026-10-04", "2026-10-06", 500, "CUR");
    assert.equal(p.level, "ad");
    assert.equal(p.time_increment, "1");
    assert.equal(p.time_range, '{"since":"2026-10-04","until":"2026-10-06"}');
    assert.equal(p.filtering, '[{"field":"spend","operator":"GREATER_THAN","value":0}]');
    assert.equal(p.action_attribution_windows, '["7d_click","1d_view"]');
    assert.equal(p.limit, "500");
    assert.equal(p.after, "CUR");
  });

  it("window is the last three complete UTC days", () => {
    assert.deepEqual(insightsWindow(new Date("2026-10-07T02:30:00Z")), { since: "2026-10-04", until: "2026-10-06" });
    assert.deepEqual(insightsWindow(new Date("2026-03-01T02:30:00Z")), { since: "2026-02-26", until: "2026-02-28" });
  });

  it("pages by cursor and counts every call, shrinking the page on 'reduce the amount of data'", async () => {
    const seen: string[] = [];
    const result = await fetchAdAccountInsights(
      async (_path, params) => {
        seen.push(`${params.limit}:${params.after ?? "-"}`);
        if (params.limit === "500") throw metaError(1, "Please reduce the amount of data you're asking for");
        if (!params.after) return { data: [adRow("1")], paging: { cursors: { after: "p2" }, next: "https://next" } };
        return { data: [adRow("2")], paging: { cursors: { after: "p3" } } };
      },
      "act_1",
      "2026-10-04",
      "2026-10-06",
    );
    assert.deepEqual(seen, ["500:-", "100:-", "100:p2"]);
    assert.equal(result.status, "ok");
    assert.equal(result.calls, 3);
    assert.equal(result.pages, 2);
    assert.equal(result.rows.length, 2);
  });
});

describe("runAdDailyInsights", () => {
  it("skips a rate-limited or auth-failed account, continues, and reports per-account outcomes", async () => {
    const { db, calls } = fakeDb(() => ({ error: null }));
    const result = await runAdDailyInsights({
      env: ON,
      db,
      now: new Date("2026-10-07T02:30:00Z"),
      accounts: ["act_1", "act_2", "act_3"],
      graphGet: async (path) => {
        if (path === "/act_1/insights") throw metaError(80004, "too many calls to this ad account");
        if (path === "/act_2/insights") throw metaError(190, "token expired");
        return { data: [adRow("9"), adRow("9"), adRow("10")] };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.metaCalls, 3);
    assert.deepEqual(
      result.outcomes!.map((o) => [o.adAccountId, o.status, o.calls, o.rows]),
      [
        ["act_1", "rate_limited", 1, 0],
        ["act_2", "auth_error", 1, 0],
        ["act_3", "ok", 1, 2],
      ],
    );
    const upserts = calls.filter((c) => c.table === "ad_daily_insights");
    assert.equal(upserts.length, 1);
    assert.deepEqual(op(upserts[0], "upsert")?.[1], { onConflict: "meta_ad_id,date" });
    assert.equal((op(upserts[0], "upsert")?.[0] as unknown[]).length, 2, "duplicate (ad, day) collapsed");
  });

  it("accounts are the normalised distinct union of clients, events and launched_ad_sets", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.table === "clients") return { data: [{ meta_ad_account_id: "111111" }, { meta_ad_account_id: "act_222222" }] };
      if (call.table === "events") return { data: [{ meta_ad_account_id: "act_111111" }] };
      if (call.table === "launched_ad_sets") return { data: [{ ad_account_id: "act_333333" }] };
      return { error: null };
    });
    const paths: string[] = [];
    const result = await runAdDailyInsights({
      env: ON,
      db,
      graphGet: async (path) => {
        paths.push(path);
        return { data: [] };
      },
    });
    assert.deepEqual(paths, ["/act_111111/insights", "/act_222222/insights", "/act_333333/insights"]);
    assert.equal(result.ok, true);
    assert.equal(calls.filter((c) => c.table === "ad_daily_insights").length, 0);
  });
});

describe("migration 185 ad_daily_insights", () => {
  const SQL = readFileSync("supabase/migrations/185_ad_daily_insights.sql", "utf8");
  it("unique per ad per day, three indexes, read-only RLS scoped to the owning operator", () => {
    assert.match(SQL, /create table if not exists ad_daily_insights/);
    assert.match(SQL, /unique \(meta_ad_id, date\)/);
    assert.match(SQL, /\(ad_account_id, date\)/);
    assert.match(SQL, /\(meta_campaign_id, date\)/);
    assert.match(SQL, /\(meta_adset_id, date\)/);
    assert.match(SQL, /actions\s+jsonb not null default '\[\]'::jsonb/);
    assert.match(SQL, /for select/);
    assert.doesNotMatch(SQL, /for (insert|update|delete)/);
    assert.doesNotMatch(SQL, /using \(true\)/);
    assert.doesNotMatch(SQL, /\buser_id\s+uuid/);
    let depth = 0;
    for (const ch of SQL.replace(/--.*$/gm, "")) depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    assert.equal(depth, 0);
    assert.match(SQL, /notify pgrst, 'reload schema';\s*$/);
  });
});
