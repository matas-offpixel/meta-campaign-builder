import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { metricChipBenchmarkFromRuns } from "../benchmarks.ts";
import {
  PREDICTIONS_REMOVAL,
  PREDICTIONS_TABLE,
  lineKindFromBenchmark,
  planWindowActual,
  predictionFromBenchmark,
  rungFromBenchmark,
} from "../predictions.ts";

describe("prediction row from a benchmark", () => {
  it("n ≥ 3 is venue + measured + the median", () => {
    const benchmark = metricChipBenchmarkFromRuns({
      runs: [
        { eventId: "a", eventCode: "A", eventDate: "2026-10-02", cost: 1.46 },
        { eventId: "b", eventCode: "B", eventDate: "2026-10-16", cost: 2.03 },
        { eventId: "c", eventCode: "C", eventDate: "2026-10-23", cost: 2.12 },
      ],
      venueLabel: "NX",
    });
    const row = predictionFromBenchmark({
      userId: "u1",
      planId: "p1",
      unit: "reg",
      benchmark,
      startingPoint: 1.6,
    });
    assert.equal(row.metric, "cost_per_unit");
    assert.equal(row.unit, "reg");
    assert.equal(row.value, 2.03);
    assert.equal(row.lineKind, "measured");
    assert.equal(row.benchmarkRung, "venue");
    assert.equal(row.n, 3);
    assert.equal(row.sourceKind, "meta_said");
  });

  it("no benchmark is the starting point, not_yet, n = 0", () => {
    const row = predictionFromBenchmark({
      userId: "u1",
      planId: "p1",
      unit: "reg",
      benchmark: undefined,
      startingPoint: 1.6,
    });
    assert.equal(row.value, 1.6);
    assert.equal(row.lineKind, "not_yet");
    assert.equal(row.benchmarkRung, "starting_point");
    assert.equal(row.n, 0);
    assert.equal(rungFromBenchmark(undefined), "starting_point");
    assert.equal(lineKindFromBenchmark(undefined), "not_yet");
  });
});

describe("§1.5 removal — predictions table", () => {
  it("Launch writes the row; archive can stamp actual", () => {
    const launch = readFileSync("app/api/plan/launch/route.ts", "utf8");
    assert.match(launch, /writePredictionsAtLaunch/);
    const dispose = readFileSync("lib/plan/dispose.ts", "utf8");
    assert.match(dispose, /writePredictionActualsAtClose/);
    assert.match(dispose, /closedReason: "archived"/);
    assert.equal(
      planWindowActual({ spend: 554, regs: 1086, purchases: 0, reach: 0, unit: "reg" }),
      0.51,
    );
  });

  it("166 is the audit DDL and says the window is days", () => {
    const sql = readFileSync("supabase/migrations/166_campaign_plan_predictions.sql", "utf8");
    assert.match(sql, /create table if not exists campaign_plan_predictions/);
    assert.match(sql, /The prediction window is days/);
    assert.match(sql, /start_time \/ end_time/);
    assert.equal(PREDICTIONS_TABLE, "campaign_plan_predictions");
    assert.match(PREDICTIONS_REMOVAL, /campaign_plan_predictions/);
  });
});
