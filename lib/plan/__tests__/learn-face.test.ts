import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { VIZ_CLIENT_SAFE, VIZ_LOCKED_CLIENT_CREATIVE } from "../../viz/tokens.ts";
import {
  E1_CLOSED_RUNS,
  LEARN_NO_PREDICTION,
  LEARN_PACE_KEPT,
  formatArchiveHeader,
  formatCountLock,
  formatDateLock,
  formatLearnSentence,
  formatPastIdentity,
  learnControlsVisible,
  learnFaceSentences,
  nextTimeFromRuns,
  planIsClosed,
} from "../learn-face.ts";

describe("LEARN E-states — sentences", () => {
  const states = ["E1", "E2", "E3", "E4", "E5", "E6", "E7"] as const;

  for (const state of states) {
    it(`${state} renders its sentence`, () => {
      const sentences = learnFaceSentences(state);
      assert.ok(sentences.length > 0, `${state} has no sentence`);
      for (const sentence of sentences) {
        assert.doesNotMatch(sentence, /\d{4}-\d{2}-\d{2}/);
        assert.doesNotMatch(sentence, /VIZ_STATUS_LABEL|VIZ_ACTION_LABEL/);
      }
    });
  }

  it("E1 sentence is built from the prediction row", () => {
    assert.equal(
      formatLearnSentence({
        predicted: 2.03,
        unitWord: "signup",
        n: 5,
        venueLabel: "NX",
        eventName: "D.O.D",
        actual: 0.51,
        nextTime: 1.75,
        nextN: 6,
      }),
      "We assumed £2.03 per signup from 5 other shows at NX; D.O.D came in at £0.51 before general sale; the next NX plan will assume £1.75 (6 other shows)",
    );
  });

  it("next-time median with the closed run added is £1.75, band £1.04–£2.10", () => {
    const next = nextTimeFromRuns(E1_CLOSED_RUNS);
    assert.equal(next.n, 6);
    assert.equal(next.value, 1.75);
    assert.deepEqual(next.band, [1.04, 2.1]);
  });

  it("E2 has no prediction stored", () => {
    assert.equal(
      LEARN_NO_PREDICTION,
      "no prediction was stored for this plan — it launched before predictions were kept",
    );
  });

  it("E3 date-lock is days; count-lock is (1 of 3)", () => {
    assert.equal(formatDateLock("D.O.D", 89), "opens when D.O.D closes (89 days)");
    assert.equal(formatCountLock("NX", 1, 3), "opens after your 3rd NX show (1 so far)");
    const source = readFileSync("components/plan/canvas-learn.tsx", "utf8");
    assert.match(source, /progress: locked\.days != null \? \{ days: locked\.days \}/);
    assert.match(source, /n: locked\.n, of: locked\.of/);
  });

  it("E6 client role removes the next-time column only", () => {
    assert.deepEqual(learnControlsVisible("client"), { nextTimeColumn: false });
    assert.deepEqual(learnControlsVisible("operator"), { nextTimeColumn: true });
    assert.equal(VIZ_CLIENT_SAFE(VIZ_LOCKED_CLIENT_CREATIVE), VIZ_LOCKED_CLIENT_CREATIVE);
  });

  it("E7 archive header uses formatVizDay", () => {
    assert.equal(formatArchiveHeader("2026-09-06T12:00:00.000Z"), "closed when you archived it, Sun 6 Sep");
  });

  it("past-tense identity", () => {
    assert.equal(
      formatPastIdentity({
        metaName: "ELECTRIC STUDIOS SHEFFIELD",
        tiktokRan: false,
        googleRan: false,
      }),
      "Ran as ELECTRIC STUDIOS SHEFFIELD on Meta · TikTok and Google did not run",
    );
  });

  it("pace kept", () => {
    assert.equal(LEARN_PACE_KEPT, "£35 per day, kept");
  });

  it("closed after the show or on archive", () => {
    const now = new Date("2026-09-06T12:00:00.000Z");
    assert.equal(planIsClosed({ status: "live", eventDate: "2026-08-01", now }), true);
    assert.equal(planIsClosed({ status: "live", eventDate: "2026-12-01", now }), false);
    assert.equal(planIsClosed({ status: "archived", eventDate: null, now }), true);
    assert.equal(planIsClosed({ status: "live", eventDate: null, now }), false);
  });
});

describe("LEARN surface guards", () => {
  it("canvas-learn uses card ⓘ and the predictions type, not evaluate.ts", () => {
    const source = readFileSync("components/plan/canvas-learn.tsx", "utf8");
    assert.match(source, /LEARN_INFO_VARIANT|variant=["']card["']/);
    assert.match(source, /CampaignPlanPrediction/);
    assert.doesNotMatch(source, /evaluate\.ts|lib\/optimisation\/evaluate/);
    assert.doesNotMatch(source, /VIZ_STATUS_LABEL|VIZ_ACTION_LABEL/);
    assert.doesNotMatch(source, /\d{4}-\d{2}-\d{2}T/);
    const tips = source.match(/<InfoTip/g) ?? [];
    assert.equal(tips.length, 1);
  });

  it("workspace mounts LEARN after close", () => {
    const source = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(source, /CanvasLearn/);
    assert.match(source, /isLearnFace/);
  });
});
