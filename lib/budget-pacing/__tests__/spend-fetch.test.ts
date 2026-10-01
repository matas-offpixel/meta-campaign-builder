import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fetchCampaignPacingSnapshot,
  fetchCampaignSpendPence,
  lifetimeDenominatorMinor,
  PACING_BATCH_FIELDS,
  type BudgetPacingGraphFetcher,
} from "../spend-fetch.ts";

test("empty campaign list makes no calls and returns an empty map", async () => {
  let calls = 0;
  const fetcher: BudgetPacingGraphFetcher = async () => {
    calls += 1;
    return {} as never;
  };
  const result = await fetchCampaignSpendPence(fetcher, [], "token");
  assert.deepEqual(result, {});
  assert.equal(calls, 0);
});

test("<=20 campaigns issues one /insights call per campaign", async () => {
  const calls: { path: string; params: Record<string, string> }[] = [];
  const fetcher: BudgetPacingGraphFetcher = async (path, params) => {
    calls.push({ path, params });
    return { data: [{ spend: "12.50" }] } as never;
  };
  const ids = ["111", "222", "333"];
  const result = await fetchCampaignSpendPence(fetcher, ids, "token");

  assert.equal(calls.length, 3);
  for (const id of ids) {
    assert.ok(calls.some((c) => c.path === `/${id}/insights`));
  }
  assert.equal(calls[0].params.fields, "spend");
  assert.equal(calls[0].params.date_preset, "maximum");
  assert.deepEqual(result, { "111": 1250, "222": 1250, "333": 1250 });
});

test("a campaign with no insights row yet resolves to 0 spend, not null/undefined", async () => {
  const fetcher: BudgetPacingGraphFetcher = async () => ({ data: [] }) as never;
  const result = await fetchCampaignSpendPence(fetcher, ["111"], "token");
  assert.equal(result["111"], 0);
});

test(">20 campaigns batches via ids= in chunks of 20", async () => {
  const ids = Array.from({ length: 45 }, (_, i) => `id${i}`);
  const calls: { path: string; params: Record<string, string> }[] = [];
  const fetcher: BudgetPacingGraphFetcher = async (path, params) => {
    calls.push({ path, params });
    const chunkIds = params.ids.split(",");
    const nodes: Record<string, unknown> = {};
    for (const id of chunkIds) {
      nodes[id] = { id, insights: { data: [{ spend: "5.00" }] } };
    }
    return nodes as never;
  };

  const result = await fetchCampaignSpendPence(fetcher, ids, "token");

  assert.equal(calls.length, 3); // 20 + 20 + 5
  assert.equal(calls[0].path, "");
  assert.equal(calls[0].params.fields, "insights.date_preset(maximum){spend}");
  assert.equal(calls[0].params.ids.split(",").length, 20);
  assert.equal(calls[2].params.ids.split(",").length, 5);
  assert.equal(Object.keys(result).length, 45);
  assert.equal(result["id0"], 500);
  assert.equal(result["id44"], 500);
});

test("exactly 20 campaigns still uses the individual per-campaign path", async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `id${i}`);
  const calls: string[] = [];
  const fetcher: BudgetPacingGraphFetcher = async (path) => {
    calls.push(path);
    return { data: [{ spend: "1.00" }] } as never;
  };
  await fetchCampaignSpendPence(fetcher, ids, "token");
  assert.equal(calls.length, 20);
  assert.ok(calls.every((p) => p.endsWith("/insights")));
});

test("a batched node missing entirely from the response resolves to 0", async () => {
  const fetcher: BudgetPacingGraphFetcher = async () => ({}) as never; // no nodes at all
  const ids = Array.from({ length: 21 }, (_, i) => `id${i}`);
  const result = await fetchCampaignSpendPence(fetcher, ids, "token");
  assert.equal(result["id0"], 0);
  assert.equal(Object.keys(result).length, 21);
});

test("lifetimeDenominatorMinor prefers a positive campaign lifetime budget", () => {
  assert.deepEqual(
    lifetimeDenominatorMinor({
      lifetime_budget: "5000",
      adsets: { data: [{ lifetime_budget: "100" }] },
    }),
    [5000],
  );
});

test("lifetimeDenominatorMinor sums positive ad set lifetimes and drops zeros", () => {
  assert.deepEqual(
    lifetimeDenominatorMinor({
      lifetime_budget: "0",
      adsets: { data: [{ lifetime_budget: "0" }, { lifetime_budget: 2500 }, {}] },
    }),
    [2500],
  );
  assert.deepEqual(lifetimeDenominatorMinor({}), []);
});

test("pacing snapshot reads lifetime on the same batch and keeps the other campaign when one id is missing", async () => {
  const calls: { path: string; params: Record<string, string> }[] = [];
  const fetcher: BudgetPacingGraphFetcher = async (path, params) => {
    calls.push({ path, params });
    return {
      good: {
        id: "good",
        lifetime_budget: "5000",
        adsets: { data: [{ lifetime_budget: "100" }] },
        insights: { data: [{ spend: "12.50" }] },
      },
    } as never;
  };
  const result = await fetchCampaignPacingSnapshot(fetcher, ["good", "bad"], "token");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "");
  assert.equal(calls[0].params.fields, PACING_BATCH_FIELDS);
  assert.match(PACING_BATCH_FIELDS, /lifetime_budget/);
  assert.match(PACING_BATCH_FIELDS, /adsets\.limit\(200\)\{lifetime_budget\}/);
  assert.deepEqual(result.lifetimeBudgetsMinor.good, [5000]);
  assert.equal(result.spendPence.good, 1250);
  assert.equal("bad" in result.lifetimeBudgetsMinor, false);
  assert.equal(result.spendPence.bad, 0);
});
