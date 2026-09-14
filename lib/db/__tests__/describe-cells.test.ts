import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DESCRIBE_MAX_PAGES,
  DESCRIBE_PAGE_SIZE,
  loadDescribeCellsForClients,
} from "../describe-cells.ts";
import { formatDescribeUnreadable } from "../../optimisation/describe-cells.ts";

type LaunchedFixture = {
  client_id: string;
  user_id: string | null;
  meta_adset_id: string;
  draft_id: string | null;
  meta_campaign_id: string | null;
  source_type: string | null;
  objective: string | null;
  phase_at_launch: string | null;
  advantage_plus_effective: boolean | null;
  descriptor_source: string | null;
  initial_daily_budget_pence: number | null;
  launched_at: string;
};

type DecisionFixture = {
  id: string;
  draft_id: string;
  adset_id: string;
  metric: string | null;
  metric_value: number | string | null;
  decided_at: string;
};

function launched(partial: Partial<LaunchedFixture> & { meta_adset_id: string }): LaunchedFixture {
  return {
    client_id: "client-1",
    user_id: "owner-1",
    draft_id: "draft-a",
    meta_campaign_id: "camp-a",
    source_type: "lookalike_group",
    objective: "registration",
    phase_at_launch: "presale",
    advantage_plus_effective: true,
    descriptor_source: "launch",
    initial_daily_budget_pence: 2000,
    launched_at: "2026-09-01T00:00:00.000Z",
    ...partial,
  };
}

function isoAt(index: number): string {
  const hour = Math.floor(index / 3600)
    .toString()
    .padStart(2, "0");
  const min = Math.floor((index % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const sec = (index % 60).toString().padStart(2, "0");
  return `2026-01-01T${hour}:${min}:${sec}.000Z`;
}

function decision(
  partial: Partial<DecisionFixture> & { adset_id: string; decided_at: string },
): DecisionFixture {
  return {
    id: partial.id ?? "000000",
    draft_id: partial.draft_id ?? "draft-a",
    metric: partial.metric ?? "cpr",
    metric_value: partial.metric_value === undefined ? 1 : partial.metric_value,
    ...partial,
  };
}

function makeClient(opts: {
  launched: LaunchedFixture[] | { error: { message: string } };
  decisions: DecisionFixture[] | { error: { message: string } };
  cap?: number;
}): {
  client: SupabaseClient;
  launchedEqs: Array<{ col: string; val: unknown }>;
  decisionAdsetIns: string[][];
  decisionRanges: Array<{ from: number; to: number }>;
  decisionFromCount: { n: number };
} {
  const cap = opts.cap ?? DESCRIBE_PAGE_SIZE;
  const launchedEqs: Array<{ col: string; val: unknown }> = [];
  const decisionAdsetIns: string[][] = [];
  const decisionRanges: Array<{ from: number; to: number }> = [];
  const decisionFromCount = { n: 0 };

  const client = {
    from(table: string) {
      if (table === "campaign_automation_decisions") decisionFromCount.n += 1;
      const ins: Array<{ col: string; ids: string[] }> = [];
      let eqCol: string | null = null;
      let eqVal: unknown = null;
      const orders: Array<{ col: string; asc: boolean }> = [];
      let rangeFrom = 0;
      let rangeTo = cap - 1;

      const run = () => {
        const source = table === "launched_ad_sets" ? opts.launched : opts.decisions;
        if (source && typeof source === "object" && "error" in source) {
          return { data: null, error: source.error };
        }
        let rows = [...(source as Array<Record<string, unknown>>)];
        for (const filter of ins) {
          rows = rows.filter((row) => filter.ids.includes(String(row[filter.col])));
        }
        if (eqCol) {
          rows = rows.filter((row) => row[eqCol!] === eqVal);
        }
        if (orders.length > 0) {
          rows.sort((a, b) => {
            for (const order of orders) {
              const av = String(a[order.col] ?? "");
              const bv = String(b[order.col] ?? "");
              const cmp = av.localeCompare(bv);
              if (cmp !== 0) return order.asc ? cmp : -cmp;
            }
            return 0;
          });
        }
        return { data: rows.slice(rangeFrom, rangeTo + 1), error: null };
      };

      const api = {
        select() {
          return api;
        },
        in(col: string, ids: string[]) {
          ins.push({ col, ids });
          if (table === "campaign_automation_decisions" && col === "adset_id") {
            decisionAdsetIns.push(ids);
          }
          return api;
        },
        eq(col: string, val: unknown) {
          if (table === "launched_ad_sets") launchedEqs.push({ col, val });
          eqCol = col;
          eqVal = val;
          return api;
        },
        order(col: string, orderOpts?: { ascending?: boolean }) {
          orders.push({ col, asc: orderOpts?.ascending !== false });
          return api;
        },
        range(from: number, to: number) {
          rangeFrom = from;
          rangeTo = to;
          if (table === "campaign_automation_decisions") {
            decisionRanges.push({ from, to });
          }
          return api;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return api;
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    launchedEqs,
    decisionAdsetIns,
    decisionRanges,
    decisionFromCount,
  };
}

function captureErrors(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return fn()
    .catch((err) => {
      console.error = orig;
      throw err;
    })
    .then(() => {
      console.error = orig;
      return lines;
    });
}

describe("loadDescribeCellsForClients", () => {
  it("two ad sets: 1,200 rows plus one older row — the pager turns a page", async () => {
    const decisions: DecisionFixture[] = [];
    for (let i = 1; i <= 1200; i++) {
      decisions.push(
        decision({
          id: String(i).padStart(6, "0"),
          adset_id: "ad-hot",
          metric_value: i,
          decided_at: isoAt(i),
        }),
      );
    }
    decisions.push(
      decision({
        id: "000000",
        adset_id: "ad-old",
        metric_value: 0.42,
        decided_at: isoAt(0),
      }),
    );

    const { client, decisionRanges } = makeClient({
      launched: [
        launched({ meta_adset_id: "ad-hot" }),
        launched({ meta_adset_id: "ad-old" }),
      ],
      decisions,
    });
    const result = await loadDescribeCellsForClients(client, ["client-1"], {
      now: new Date("2026-09-14T12:00:00.000Z"),
      viewer: { userId: "owner-1", isOperator: true },
      armedDraftIds: ["draft-a"],
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.ok(decisionRanges.some((range) => range.from >= DESCRIBE_PAGE_SIZE));
    assert.equal(result.cells[0]?.metricN, 2);
    const values = [result.cells[0]?.metricMin, result.cells[0]?.metricMax].sort();
    assert.deepEqual(values, [0.42, 1200]);
  });

  it("pages launched_ad_sets past the 1,000-row cap", async () => {
    const launchedRows = Array.from({ length: 1501 }, (_, i) =>
      launched({
        meta_adset_id: `ad-${String(i + 1).padStart(4, "0")}`,
        draft_id: `d-${i + 1}`,
        meta_campaign_id: `c-${i + 1}`,
      }),
    );
    const { client } = makeClient({
      launched: launchedRows,
      decisions: [],
    });
    const result = await loadDescribeCellsForClients(client, ["client-1"], {
      viewer: { userId: "owner-1", isOperator: true },
      armedDraftIds: launchedRows.map((row) => row.draft_id!).filter(Boolean),
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.cells[0]?.n, 1501);
  });

  it("two clients with the same shape stay two cells", async () => {
    const { client } = makeClient({
      launched: [
        launched({
          client_id: "client-a",
          meta_adset_id: "a-1",
          draft_id: "da",
          meta_campaign_id: "ca",
        }),
        launched({
          client_id: "client-b",
          meta_adset_id: "b-1",
          draft_id: "db",
          meta_campaign_id: "cb",
        }),
      ],
      decisions: [],
    });
    const result = await loadDescribeCellsForClients(client, ["client-a", "client-b"], {
      viewer: { userId: "owner-1", isOperator: true },
      armedDraftIds: ["da", "db"],
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.cells.length, 2);
    assert.deepEqual(
      result.cells.map((cell) => cell.key.clientId).sort(),
      ["client-a", "client-b"],
    );
    for (const cell of result.cells) {
      assert.equal(cell.n, 1);
      assert.equal(cell.campaignCount, 1);
      assert.equal(cell.reportable, false);
    }
  });

  it("a never-ticked ad set on a non-armed draft is in n and not in the decisions read", async () => {
    const { client, decisionAdsetIns, decisionFromCount } = makeClient({
      launched: [
        launched({ meta_adset_id: "ad-armed", draft_id: "draft-a" }),
        launched({ meta_adset_id: "ad-silent", draft_id: "draft-off" }),
      ],
      decisions: [
        decision({
          adset_id: "ad-armed",
          metric_value: 0.7,
          decided_at: isoAt(10),
        }),
      ],
    });
    const result = await loadDescribeCellsForClients(client, ["client-1"], {
      now: new Date("2026-09-14T12:00:00.000Z"),
      viewer: { userId: "owner-1", isOperator: true },
      armedDraftIds: ["draft-a"],
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.cells[0]?.n, 2);
    assert.equal(result.cells[0]?.metricN, 1);
    assert.equal(decisionFromCount.n, 1);
    assert.ok(decisionAdsetIns.every((ids) => !ids.includes("ad-silent")));
    assert.ok(decisionAdsetIns.some((ids) => ids.includes("ad-armed")));
  });

  it("a never-ticked non-armed draft alone does not open a decisions read", async () => {
    const { client, decisionFromCount } = makeClient({
      launched: [launched({ meta_adset_id: "ad-silent", draft_id: "draft-off" })],
      decisions: [
        decision({
          adset_id: "ad-silent",
          metric_value: 9,
          decided_at: isoAt(1),
        }),
      ],
    });
    const result = await loadDescribeCellsForClients(client, ["client-1"], {
      viewer: { userId: "owner-1", isOperator: true },
      armedDraftIds: [],
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.cells[0]?.n, 1);
    assert.equal(result.cells[0]?.metricN, 0);
    assert.equal(decisionFromCount.n, 0);
  });

  it("a chunk past the page cap is unreadable and logs the cap", async () => {
    const launchedRows = Array.from(
      { length: DESCRIBE_MAX_PAGES * DESCRIBE_PAGE_SIZE + 1 },
      (_, i) =>
        launched({
          meta_adset_id: `ad-${String(i + 1).padStart(5, "0")}`,
          draft_id: `d-${i + 1}`,
          meta_campaign_id: `c-${i + 1}`,
        }),
    );
    const { client } = makeClient({
      launched: launchedRows,
      decisions: [],
    });
    const errors = await captureErrors(async () => {
      const result = await loadDescribeCellsForClients(client, ["client-1"], {
        viewer: { userId: "owner-1", isOperator: true },
        armedDraftIds: [],
      });
      assert.deepEqual(result, { status: "unreadable" });
    });
    assert.match(errors.join("\n"), /launched_ad_sets page cap 20 hit/);
  });

  it("an ad set whose latest row is null reports the previous value", async () => {
    const { client } = makeClient({
      launched: [launched({ meta_adset_id: "ad-1" })],
      decisions: [
        decision({
          id: "000002",
          adset_id: "ad-1",
          metric_value: null,
          decided_at: isoAt(20),
        }),
        decision({
          id: "000001",
          adset_id: "ad-1",
          metric_value: 0.61,
          decided_at: isoAt(10),
        }),
      ],
    });
    const result = await loadDescribeCellsForClients(client, ["client-1"], {
      now: new Date("2026-09-14T12:00:00.000Z"),
      viewer: { userId: "owner-1", isOperator: true },
      armedDraftIds: ["draft-a"],
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.cells[0]?.metricMedian, 0.61);
    assert.equal(result.cells[0]?.metricN, 1);
  });

  it("a launched_ad_sets error is unreadable, not n=0", async () => {
    const { client } = makeClient({
      launched: { error: { message: "boom launched" } },
      decisions: [],
    });
    const result = await loadDescribeCellsForClients(client, ["client-1"], {
      armedDraftIds: ["draft-a"],
    });
    assert.deepEqual(result, { status: "unreadable" });
    assert.equal(formatDescribeUnreadable(), "cells unreadable");
    assert.doesNotMatch(formatDescribeUnreadable(), /n=0/);
  });

  it("a decisions error is unreadable, not no metric yet", async () => {
    const { client } = makeClient({
      launched: [launched({ meta_adset_id: "ad-1" })],
      decisions: { error: { message: "boom decisions" } },
    });
    const result = await loadDescribeCellsForClients(client, ["client-1"], {
      armedDraftIds: ["draft-a"],
    });
    assert.deepEqual(result, { status: "unreadable" });
  });

  it("non-operator launched read pins user_id", async () => {
    const { client, launchedEqs } = makeClient({
      launched: [
        launched({ meta_adset_id: "mine", user_id: "owner-1" }),
        launched({ meta_adset_id: "theirs", user_id: "other" }),
      ],
      decisions: [],
    });
    const result = await loadDescribeCellsForClients(client, ["client-1"], {
      viewer: { userId: "owner-1", isOperator: false },
      armedDraftIds: ["draft-a"],
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.ok(launchedEqs.some((eq) => eq.col === "user_id" && eq.val === "owner-1"));
    assert.equal(result.cells[0]?.n, 1);
    assert.deepEqual(result.cells[0]?.metaAdsetIds, ["mine"]);
  });
});
