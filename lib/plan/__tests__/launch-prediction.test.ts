import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { metricChipBenchmarkFromRuns } from "../benchmarks.ts";
import {
  choosePredictionPlanId,
  draftPredictionSkipReason,
  predictionRowForLaunch,
  predictionUnitForDraft,
} from "../launch-prediction.ts";

describe("launch prediction", () => {
  it("uses the benchmark median, and the starting point when there is no usual yet", () => {
    const benchmark = metricChipBenchmarkFromRuns({
      runs: [
        { eventId: "a", eventCode: "A", eventDate: "2026-10-02", cost: 1.2 },
        { eventId: "b", eventCode: "B", eventDate: "2026-10-16", cost: 1.6 },
        { eventId: "c", eventCode: "C", eventDate: "2026-10-23", cost: 2.4 },
      ],
      venueLabel: "NX",
    });
    const measured = predictionRowForLaunch({
      userId: "u",
      planId: "p",
      unit: "reg",
      benchmark,
    });
    assert.equal(measured.value, 1.6);
    assert.equal(measured.benchmarkRung, "venue");
    assert.equal(measured.n, 3);

    const none = predictionRowForLaunch({
      userId: "u",
      planId: "p",
      unit: "reg",
      benchmark: undefined,
    });
    assert.equal(none.value, 1.6);
    assert.equal(none.lineKind, "not_yet");
    assert.equal(none.benchmarkRung, "starting_point");
  });

  it("a draft unit is the preset, else the objective, else nothing", () => {
    assert.equal(predictionUnitForDraft({ objective: "engagement", presetUnit: "lpv" }), "lpv");
    assert.equal(predictionUnitForDraft({ objective: "registration" }), "reg");
    assert.equal(predictionUnitForDraft({ objective: "initiate_checkout" }), "purchase");
    assert.equal(predictionUnitForDraft({ objective: "traffic" }), "click");
    assert.equal(predictionUnitForDraft({ objective: "awareness" }), "view");
    assert.equal(predictionUnitForDraft({ objective: "engagement" }), null);
  });

  it("skips a draft with no event, no unit, or no single plan", () => {
    assert.equal(draftPredictionSkipReason({ eventId: "", unit: "reg", planId: "p", eventPlanCount: 1 }), "no event");
    assert.equal(draftPredictionSkipReason({ eventId: "e", unit: null, planId: "p", eventPlanCount: 1 }), "no unit");
    assert.equal(draftPredictionSkipReason({ eventId: "e", unit: "reg", planId: null, eventPlanCount: 0 }), "no plan");
    assert.equal(
      draftPredictionSkipReason({ eventId: "e", unit: "reg", planId: null, eventPlanCount: 2 }),
      "more than one plan",
    );
    assert.equal(draftPredictionSkipReason({ eventId: "e", unit: "reg", planId: "p", eventPlanCount: 2 }), null);
    assert.equal(choosePredictionPlanId("linked", ["a", "b"]), "linked");
    assert.equal(choosePredictionPlanId(null, ["only"]), "only");
    assert.equal(choosePredictionPlanId(null, ["a", "b"]), null);
  });

  it("the plan route writes whenever the unit is set, and a standalone launch uses the same writer", () => {
    const plan = readFileSync("app/api/plan/launch/route.ts", "utf8");
    assert.match(plan, /writePlanLaunchPrediction/);
    assert.match(plan, /prediction skipped: no unit/);
    assert.doesNotMatch(plan, /benchmark: undefined/);
    const standalone = readFileSync("app/api/meta/launch-campaign/route.ts", "utf8");
    assert.equal((standalone.match(/writeDraftLaunchPrediction/g) ?? []).length, 2);
    const writer = readFileSync("lib/plan/launch-prediction.ts", "utf8");
    assert.match(writer, /planBenchmark\(/);
    assert.match(writer, /LAUNCH_STARTING_POINT/);
  });
});
