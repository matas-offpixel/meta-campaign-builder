import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { closeDueShowPredictions, showCloseCutoffDate } from "../show-close.ts";

const NOW = new Date("2026-09-06T12:00:00.000Z");

function memoryDb(seed: {
  predictions: Array<Record<string, unknown>>;
  plans: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  launches?: Array<Record<string, unknown>>;
  rollups?: Array<Record<string, unknown>>;
}) {
  const predictions = seed.predictions.map((row) => ({ ...row }));
  const writes: Array<Record<string, unknown>> = [];

  function rowsFor(table: string): Array<Record<string, unknown>> {
    if (table === "campaign_plan_predictions") return predictions;
    if (table === "campaign_plans") return seed.plans;
    if (table === "events") return seed.events;
    if (table === "event_daily_rollups") return seed.rollups ?? [];
    if (
      table === "campaign_plan_meta_launch" ||
      table === "campaign_plan_tiktok_launch" ||
      table === "campaign_plan_google_launch"
    ) {
      return (seed.launches ?? []).filter((row) => row.table === table || !row.table);
    }
    return [];
  }

  function query(table: string) {
    let filtered = rowsFor(table);
    const api = {
      select() {
        return api;
      },
      eq(col: string, value: string) {
        filtered = filtered.filter((row) => String(row[col]) === value);
        return api;
      },
      in(col: string, values: string[]) {
        filtered = filtered.filter((row) => values.includes(String(row[col])));
        return api;
      },
      is(col: string, value: null) {
        filtered = filtered.filter((row) => row[col] == null);
        return api;
      },
      gte(col: string, value: string) {
        filtered = filtered.filter((row) => String(row[col]) >= value);
        return api;
      },
      lte(col: string, value: string) {
        filtered = filtered.filter((row) => String(row[col]) <= value);
        return api;
      },
      maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
      then(
        resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
      },
    };
    return api;
  }

  return {
    predictions,
    writes,
    from(table: string) {
      return {
        ...query(table),
        update: (row: Record<string, unknown>) => ({
          eq: (col: string, value: string) => ({
            is: async (isCol: string) => {
              let count = 0;
              for (const existing of predictions) {
                if (String(existing[col]) !== value) continue;
                if (existing[isCol] != null) continue;
                Object.assign(existing, row);
                writes.push({ ...row, plan_id: value });
                count += 1;
              }
              return { error: null, count };
            },
          }),
        }),
      };
    },
  };
}

function liveFixture(overrides: {
  eventDate: string;
  actualAt?: string | null;
  closedReason?: string | null;
  status?: string;
} = { eventDate: "2026-09-05" }) {
  return memoryDb({
    predictions: [
      {
        plan_id: "plan-1",
        unit: "reg",
        actual: null,
        actual_at: overrides.actualAt ?? null,
        closed_reason: overrides.closedReason ?? null,
      },
    ],
    plans: [
      {
        id: "plan-1",
        status: overrides.status ?? "live",
        event_id: "event-1",
        target_unit: "reg",
      },
    ],
    events: [{ id: "event-1", event_date: overrides.eventDate }],
    launches: [
      {
        table: "campaign_plan_meta_launch",
        plan_id: "plan-1",
        status: "live",
        platform_campaign_id: "120",
        created_at: "2026-08-27T09:00:00.000Z",
        launched_at: "2026-08-27T09:00:00.000Z",
      },
    ],
    rollups: [
      {
        event_id: "event-1",
        date: "2026-08-27",
        ad_spend: 554,
        tiktok_spend: 0,
        google_ads_spend: 0,
        meta_regs: 1086,
        meta_purchases: 0,
        meta_reach: 0,
      },
    ],
  });
}

describe("show-close cutoff is yesterday London", () => {
  it("6 Sep UTC is 5 Sep", () => {
    assert.equal(showCloseCutoffDate(NOW), "2026-09-05");
  });
});

describe("closeDueShowPredictions", () => {
  it("writes the plan-window actual once when the show was yesterday", async () => {
    const db = liveFixture({ eventDate: "2026-09-05" });
    const first = await closeDueShowPredictions(db, NOW);
    assert.equal(first.considered, 1);
    assert.equal(first.written, 1);
    assert.equal(db.predictions[0]?.actual, 0.51);
    assert.equal(db.predictions[0]?.closed_reason, "show");
    assert.ok(db.predictions[0]?.actual_at);

    const second = await closeDueShowPredictions(db, NOW);
    assert.equal(second.considered, 0);
    assert.equal(second.written, 0);
    assert.equal(db.writes.length, 1);
  });

  it("a plan archived first keeps archived", async () => {
    const db = liveFixture({
      eventDate: "2026-09-05",
      actualAt: "2026-09-04T18:00:00.000Z",
      closedReason: "archived",
      status: "archived",
    });
    db.predictions[0]!.actual = 0.6;
    const result = await closeDueShowPredictions(db, NOW);
    assert.equal(result.written, 0);
    assert.equal(db.predictions[0]?.closed_reason, "archived");
    assert.equal(db.predictions[0]?.actual, 0.6);
  });

  it("a show still ahead of yesterday is left open", async () => {
    const db = liveFixture({ eventDate: "2026-09-06" });
    const result = await closeDueShowPredictions(db, NOW);
    assert.equal(result.written, 0);
    assert.equal(db.predictions[0]?.actual_at, null);
  });
});

describe("show-close cron wiring", () => {
  it("rollup-sync-events runs the pass even when no events are eligible", () => {
    const cron = readFileSync("app/api/cron/rollup-sync-events/route.ts", "utf8");
    assert.match(cron, /closeDueShowPredictions/);
    assert.match(cron, /eligibleIds\.length === 0/);
    assert.doesNotMatch(cron, /evaluate\.ts/);
  });
});
