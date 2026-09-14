import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
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

function makeClient(opts: {
  launched: LaunchedFixture[] | { error: { message: string } };
  decisions: DecisionFixture[] | { error: { message: string } };
  cap?: number;
}): { client: SupabaseClient; launchedEqs: Array<{ col: string; val: unknown }> } {
  const cap = opts.cap ?? DESCRIBE_PAGE_SIZE;
  const launchedEqs: Array<{ col: string; val: unknown }> = [];

  const client = {
    from(table: string) {
      let filterCol: string | null = null;
      let filterIds: string[] = [];
      let eqCol: string | null = null;
      let eqVal: unknown = null;
      let orderCol: string | null = null;
      let orderAsc = true;
      let rangeFrom = 0;
      let rangeTo = cap - 1;

      const run = () => {
        const source = table === "launched_ad_sets" ? opts.launched : opts.decisions;
        if (source && typeof source === "object" && "error" in source) {
          return { data: null, error: source.error };
        }
        let rows = [...(source as Array<Record<string, unknown>>)];
        if (filterCol) {
          rows = rows.filter((row) => filterIds.includes(String(row[filterCol!])));
        }
        if (eqCol) {
          rows = rows.filter((row) => row[eqCol!] === eqVal);
        }
        if (orderCol) {
          rows.sort((a, b) => {
            const av = String(a[orderCol!]);
            const bv = String(b[orderCol!]);
            return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
          });
        }
        return { data: rows.slice(rangeFrom, rangeTo + 1), error: null };
      };

      const api = {
        select() {
          return api;
        },
        in(col: string, ids: string[]) {
          filterCol = col;
          filterIds = ids;
          return api;
        },
        eq(col: string, val: unknown) {
          if (table === "launched_ad_sets") launchedEqs.push({ col, val });
          eqCol = col;
          eqVal = val;
          return api;
        },
        order(col: string, orderOpts?: { ascending?: boolean }) {
          orderCol = col;
          orderAsc = orderOpts?.ascending !== false;
          return api;
        },
        range(from: number, to: number) {
          rangeFrom = from;
          rangeTo = to;
          return api;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return api;
    },
  };

  return { client: client as unknown as SupabaseClient, launchedEqs };
}

describe("loadDescribeCellsForClients", () => {
  it("1,500 decision rows produce the latest per ad set, not the first 1,000", async () => {
    const decisions: DecisionFixture[] = [];
    for (let i = 0; i < 1500; i++) {
      const n = i + 1;
      const hour = Math.floor(i / 3600)
        .toString()
        .padStart(2, "0");
      const min = Math.floor((i % 3600) / 60)
        .toString()
        .padStart(2, "0");
      const sec = (i % 60).toString().padStart(2, "0");
      decisions.push({
        adset_id: "ad-1",
        metric: "cpr",
        metric_value: n,
        decided_at: `2026-01-01T${hour}:${min}:${sec}.000Z`,
      });
    }

    const { client } = makeClient({
      launched: [launched({ meta_adset_id: "ad-1" })],
      decisions,
    });
    const result = await loadDescribeCellsForClients(client, ["client-1"], {
      now: new Date("2026-09-14T12:00:00.000Z"),
      viewer: { userId: "owner-1", isOperator: true },
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.cells[0]?.metricMax, 1500);
    assert.equal(result.cells[0]?.metricMin, 1500);
    assert.equal(result.cells[0]?.metricMedian, 1500);
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
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.cells[0]?.n, 1501);
  });

  it("a launched_ad_sets error is unreadable, not n=0", async () => {
    const { client } = makeClient({
      launched: { error: { message: "boom launched" } },
      decisions: [],
    });
    const result = await loadDescribeCellsForClients(client, ["client-1"]);
    assert.deepEqual(result, { status: "unreadable" });
    assert.equal(formatDescribeUnreadable(), "cells unreadable");
    assert.doesNotMatch(formatDescribeUnreadable(), /n=0/);
  });

  it("a decisions error is unreadable, not no metric yet", async () => {
    const { client } = makeClient({
      launched: [launched({ meta_adset_id: "ad-1" })],
      decisions: { error: { message: "boom decisions" } },
    });
    const result = await loadDescribeCellsForClients(client, ["client-1"]);
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
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.ok(launchedEqs.some((eq) => eq.col === "user_id" && eq.val === "owner-1"));
    assert.equal(result.cells[0]?.n, 1);
    assert.deepEqual(result.cells[0]?.metaAdsetIds, ["mine"]);
  });
});
