import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb, op, type FakeCall } from "../../launched-ads/__tests__/fake-db.ts";
import { fetchAdAccountInsightsAdaptive, insightsSpans } from "../fetch.ts";
import { runAdDailyInsights } from "../runner.ts";

const ON = { ENABLE_AD_DAILY_INSIGHTS: "1" };
const WEEK = { since: "2026-09-30", until: "2026-10-06" };

function metaError(code: number, message: string, subcode?: number) {
  return Object.assign(new Error(message), { code, ...(subcode !== undefined ? { subcode } : {}) });
}

function span(params: Record<string, string>): { since: string; until: string; days: number } {
  const range = JSON.parse(params.time_range!) as { since: string; until: string };
  const days = (Date.parse(range.until) - Date.parse(range.since)) / 86_400_000 + 1;
  return { ...range, days };
}

function adRow(adId: string, date: string) {
  return { ad_id: adId, date_start: date, spend: "1", actions: [] };
}

function upsertedRows(calls: FakeCall[]): { meta_ad_id: string; date: string }[][] {
  return calls
    .filter((call) => call.table === "ad_daily_insights")
    .map((call) => op(call, "upsert")![0] as { meta_ad_id: string; date: string }[]);
}

describe("insightsSpans", () => {
  it("cuts a range into consecutive spans of at most N days", () => {
    assert.deepEqual(insightsSpans("2026-09-30", "2026-10-06", 3), [
      { since: "2026-09-30", until: "2026-10-02" },
      { since: "2026-10-03", until: "2026-10-05" },
      { since: "2026-10-06", until: "2026-10-06" },
    ]);
    assert.equal(insightsSpans("2026-07-01", "2026-10-06", 7).length, 14);
  });
});

describe("adaptive window", () => {
  it("fails at 7 and 3, succeeds at 1: every call counted, each day written once, window_split=7d→1d", async () => {
    const { db, calls } = fakeDb(() => ({ error: null }));
    const seen: number[] = [];
    const logs: string[] = [];
    const log = console.log;
    console.log = (line: string) => logs.push(line);
    try {
      const result = await runAdDailyInsights({
        env: ON,
        db,
        accounts: ["act_1967530076312"],
        window: WEEK,
        graphGet: async (_path, params) => {
          const { since, days } = span(params);
          seen.push(days);
          if (days > 1) throw metaError(1, "An unknown error occurred", 99);
          return { data: [adRow("ad1", since)] };
        },
      });
      const outcome = result.outcomes![0]!;
      assert.equal(outcome.status, "ok");
      assert.deepEqual(seen, [7, 3, 1, 1, 1, 3, 1, 1, 1, 1]);
      assert.equal(outcome.calls, 10);
      assert.equal(result.metaCalls, 10);
      assert.deepEqual(outcome.windowSplit, { from: 7, to: 1 });
      const written = upsertedRows(calls).flat();
      assert.equal(written.length, 7);
      assert.equal(new Set(written.map((row) => `${row.meta_ad_id}|${row.date}`)).size, 7);
      assert.equal(outcome.rows, 7);
      assert.ok(logs.some((line) => line.includes("act_1967530076312 window_split=7d→1d")));
    } finally {
      console.log = log;
    }
  });

  it("the cron's 3-day window splits 3d→1d", async () => {
    const { db } = fakeDb(() => ({ error: null }));
    const result = await runAdDailyInsights({
      env: ON,
      db,
      accounts: ["act_1"],
      window: { since: "2026-10-04", until: "2026-10-06" },
      graphGet: async (_path, params) => {
        const { since, days } = span(params);
        if (days > 1) throw metaError(2, "Service temporarily unavailable");
        return { data: [adRow("ad1", since)] };
      },
    });
    const outcome = result.outcomes![0]!;
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.calls, 4);
    assert.deepEqual(outcome.windowSplit, { from: 3, to: 1 });
    assert.equal(outcome.rows, 3);
  });

  it("succeeds at 7: one call, one write, no split", async () => {
    const { db, calls } = fakeDb(() => ({ error: null }));
    const result = await runAdDailyInsights({
      env: ON,
      db,
      accounts: ["act_1"],
      window: WEEK,
      graphGet: async () => ({ data: [adRow("ad1", "2026-09-30"), adRow("ad2", "2026-10-01")] }),
    });
    const outcome = result.outcomes![0]!;
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.calls, 1);
    assert.equal(outcome.windowSplit, undefined);
    assert.equal(upsertedRows(calls).length, 1);
    assert.equal(outcome.rows, 2);
  });

  it("auth and rate-limit errors stop the account without splitting", async () => {
    for (const [code, status] of [[190, "auth_error"], [80004, "rate_limited"]] as const) {
      const { db, calls } = fakeDb(() => ({ error: null }));
      let metaCalls = 0;
      const result = await runAdDailyInsights({
        env: ON,
        db,
        accounts: ["act_1"],
        window: WEEK,
        graphGet: async () => {
          metaCalls++;
          throw metaError(code, "nope");
        },
      });
      const outcome = result.outcomes![0]!;
      assert.equal(outcome.status, status);
      assert.equal(metaCalls, 1);
      assert.equal(outcome.calls, 1);
      assert.equal(outcome.windowSplit, undefined);
      assert.equal(upsertedRows(calls).length, 0);
    }
  });

  it("an error that is not code 1/2 or reduce-data does not split", async () => {
    let metaCalls = 0;
    const result = await fetchAdAccountInsightsAdaptive(
      async () => {
        metaCalls++;
        throw metaError(100, "Invalid parameter");
      },
      "act_1",
      WEEK.since,
      WEEK.until,
      async () => null,
    );
    assert.equal(result.status, "error");
    assert.equal(metaCalls, 1);
    assert.equal(result.windowSplit, null);
  });

  it("reduce-data after the smallest page size splits the window", async () => {
    const limits: string[] = [];
    const result = await fetchAdAccountInsightsAdaptive(
      async (_path, params) => {
        const { since, days } = span(params);
        limits.push(`${days}d:${params.limit}`);
        if (days > 1) throw metaError(1, "Please reduce the amount of data you're asking for, then retry your request");
        return { data: [adRow("ad1", since)] };
      },
      "act_1",
      "2026-10-05",
      "2026-10-06",
      async () => null,
    );
    assert.deepEqual(limits, ["2d:500", "2d:100", "2d:25", "1d:500", "1d:500"]);
    assert.equal(result.status, "ok");
    assert.equal(result.calls, 5);
    assert.deepEqual(result.windowSplit, { from: 2, to: 1 });
  });

  it("a page that fails mid-span drops the span's earlier pages; nothing from it is written", async () => {
    const { db, calls } = fakeDb(() => ({ error: null }));
    const result = await runAdDailyInsights({
      env: ON,
      db,
      accounts: ["act_1"],
      window: WEEK,
      graphGet: async (_path, params) => {
        const { since, days } = span(params);
        if (days === 7 && !params.after) {
          return {
            data: Array.from({ length: 100 }, (_, i) => adRow(`p1-${i}`, since)),
            paging: { cursors: { after: "p2" }, next: "https://next" },
          };
        }
        if (days === 7) throw metaError(1, "An unknown error occurred");
        return { data: [adRow("ok", since)] };
      },
    });
    const outcome = result.outcomes![0]!;
    assert.equal(outcome.status, "ok");
    assert.deepEqual(outcome.windowSplit, { from: 7, to: 3 });
    const written = upsertedRows(calls).flat();
    assert.equal(written.some((row) => row.meta_ad_id.startsWith("p1-")), false);
    assert.equal(written.length, 3);
  });

  it("at 1 day it gives up with error and the Meta code, keeps finished spans, and stops", async () => {
    const { db, calls } = fakeDb(() => ({ error: null }));
    const days: string[] = [];
    const result = await runAdDailyInsights({
      env: ON,
      db,
      accounts: ["act_1"],
      window: { since: "2026-10-04", until: "2026-10-06" },
      graphGet: async (_path, params) => {
        const range = span(params);
        days.push(`${range.since}/${range.days}`);
        if (range.days > 1 || range.since === "2026-10-05") {
          if (!params.after && range.days === 1) {
            return { data: [adRow("x", range.since)], paging: { cursors: { after: "p2" }, next: "https://next" } };
          }
          throw metaError(1, "An unknown error occurred", 99);
        }
        return { data: [adRow("ad1", range.since)] };
      },
    });
    const outcome = result.outcomes![0]!;
    assert.equal(outcome.status, "error");
    assert.match(outcome.error!, /^2026-10-05\.\.2026-10-05: Meta code=1 subcode=99: An unknown error occurred$/);
    assert.deepEqual(days, ["2026-10-04/3", "2026-10-04/1", "2026-10-05/1", "2026-10-05/1"]);
    assert.equal(outcome.calls, 4);
    assert.deepEqual(upsertedRows(calls).flat().map((row) => row.date), ["2026-10-04"]);
    assert.equal(outcome.rows, 1);
  });

  it("the backfill script splits through the same runner and cuts windows with insightsSpans", () => {
    const script = readFileSync("scripts/backfill-ad-daily-insights.mts", "utf8");
    assert.match(script, /runAdDailyInsights\(/);
    assert.match(script, /insightsSpans\(since!, until!, CHUNK_DAYS\)/);
    assert.match(script, /window_split=/);
    assert.doesNotMatch(script, /fetchAdAccountInsights\b/);
  });
});
