import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { VIZ_CLIENT_SAFE, VIZ_LOCKED_CLIENT_CREATIVE } from "../../viz/tokens.ts";
import {
  LEARN_NO_PREDICTION,
  LEARN_PACE_NO_READS,
  formatCountLockSentence,
  formatPaceKept,
  formatPaceValues,
  learnInfoHeader,
  learnPhaseLabel,
  formatArchiveHeader,
  formatCountLock,
  formatDateLock,
  formatLearnSentence,
  formatPastIdentity,
  learnControlsVisible,
  learnFaceSentences,
  learnNextTime,
  learnReadingUnit,
  planIsClosed,
} from "../learn-face.ts";
import { launchUnitWord } from "../launch-face.ts";
import { planBenchmark, runFromViewRow, type BenchmarkRow } from "../benchmarks.ts";

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

  it("next-time median is planBenchmark over the view's window, not a fixture constant", () => {
    const windowed: BenchmarkRow[] = [
      { client_id: "c", venue_key: "nx newcastle", event_id: "djez", event_code: "NX26-DJEZ", event_date: "2026-10-02", unit: "signup", channel: "meta", cost: 2.75 },
      { client_id: "c", venue_key: "nx newcastle", event_id: "mf", event_code: "NX26-MF", event_date: "2026-10-16", unit: "signup", channel: "meta", cost: 1.32 },
      { client_id: "c", venue_key: "nx newcastle", event_id: "folamour", event_code: "NX26-FOLAMOUR", event_date: "2026-10-23", unit: "signup", channel: "meta", cost: 0.87 },
      { client_id: "c", venue_key: "nx newcastle", event_id: "eed", event_code: "NX26-EED", event_date: "2026-11-13", unit: "signup", channel: "meta", cost: 1.67 },
      { client_id: "c", venue_key: "nx newcastle", event_id: "ipc", event_code: "NX26-IPC", event_date: "2026-11-21", unit: "signup", channel: "meta", cost: 0.54 },
      { client_id: "c", venue_key: "nx newcastle", event_id: "dod", event_code: "DOD", event_date: "2026-09-26", unit: "signup", channel: "meta", cost: 0.54 },
    ];
    const prior = planBenchmark({
      rows: windowed,
      clientId: "c",
      venueKey: "nx newcastle",
      venueLabel: "NX",
      unit: "signup",
      excludeEventId: "dod",
    });
    assert.equal(prior?.value, 1.32);
    const doubled = learnNextTime({
      priorRuns: windowed.map(runFromViewRow),
      closed: { eventId: "dod", eventCode: "DOD", eventDate: "2026-09-26", cost: 0.51 },
      venueLabel: "NX",
    });
    assert.equal(doubled?.n, 7);
    const next = learnNextTime({
      priorRuns: windowed.map(runFromViewRow),
      closed: { eventId: "dod", eventCode: "DOD", eventDate: "2026-09-26", cost: 0.51 },
      excludeEventId: "dod",
      venueLabel: "NX",
    });
    assert.ok(next);
    assert.equal(next.n, 6);
    assert.equal(next.value, 1.1);
    assert.deepEqual(next.band, [0.62, 1.58]);
    const source = readFileSync("lib/plan/learn-face.ts", "utf8");
    assert.match(source, /excludeEventId/);
    assert.match(readFileSync("components/plan/plan-workspace.tsx", "utf8"), /excludeEventId: selectedEvent\.id/);
    assert.doesNotMatch(source, /E1_CLOSED_RUNS|nextTimeFromRuns/);
  });

  it("E2 has no prediction stored", () => {
    assert.equal(
      LEARN_NO_PREDICTION,
      "no prediction was stored for this plan — it launched before predictions were kept",
    );
  });

  it("E3 date-lock is days; count-lock is (1 of 3)", () => {
    assert.equal(formatDateLock("D.O.D", 89), "opens when D.O.D closes (89 days)");
    assert.equal(formatCountLock("NX", 1, 3), "opens after your 3rd NX show (1 of 3)");
    assert.equal(formatCountLock(null, 1, 3), "opens after your 3rd show (1 of 3)");
    assert.equal(formatCountLockSentence(null, 3), "opens after your 3rd show");
    assert.doesNotMatch(formatCountLock("NX", 1, 3), /so far/);
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

  it("pace kept is built from the plan daily", () => {
    assert.equal(formatPaceKept(35), "£35 per day, kept");
    assert.equal(
      formatPaceValues({
        planSaid: 3465,
        spent: 5544,
        eventName: "D.O.D",
        nextDaily: 35,
      }),
      "the plan said £3,465 · D.O.D spent £5,544 · next time £35 per day, kept",
    );
    assert.equal(
      formatPaceValues({
        planSaid: 3465,
        spent: null,
        eventName: "D.O.D",
        nextDaily: 35,
      }),
      "the plan said £3,465 · D.O.D spent no reads yet · next time £35 per day, kept",
    );
    assert.equal(LEARN_PACE_NO_READS, "no reads yet");
    assert.doesNotMatch(
      readFileSync("components/plan/plan-workspace.tsx", "utf8"),
      /paceSpent=\{liveSpend \?\? 0\}/,
    );
    assert.equal(learnInfoHeader("signup"), "ESTIMATED · META'S SIGNUP COUNT, YOUR SPEND");
    assert.equal(learnInfoHeader("purchase"), "ESTIMATED · META'S PURCHASE COUNT, YOUR SPEND");
    assert.equal(learnInfoHeader("thousand reached"), "ESTIMATED · META'S REACH, YOUR SPEND");
    assert.equal(learnPhaseLabel("signup"), "before general sale");
    assert.equal(learnPhaseLabel("purchase"), "after general sale");
    const canvas = readFileSync("components/plan/canvas-learn.tsx", "utf8");
    assert.match(canvas, /learnInfoHeader\(unitWord\)/);
    assert.match(canvas, /learnPhaseLabel\(unitWord\)/);
    assert.doesNotMatch(canvas, /META'S SIGNUP COUNT, YOUR SPEND"/);
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

  it("LEARN reads the launch-phase unit, never target_unit", () => {
    const dod = learnReadingUnit({
      launchedAt: "2026-08-27T09:00:00.000Z",
      now: new Date("2026-12-04T12:00:00.000Z"),
      generalSaleAt: "2026-09-04T13:00:00.000Z",
      presaleAt: "2026-08-14T13:00:00.000Z",
      kind: "event",
    });
    assert.equal(dod, "reg");
    assert.equal(launchUnitWord(dod), "signup");
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    const mount = readFileSync("components/plan/plan-frame-mount.tsx", "utf8");
    assert.match(workspace, /learnReadingUnit/);
    assert.match(mount, /learnReadingUnit/);
    assert.doesNotMatch(workspace, /VIZ_UNIT_WORD\[plan\.intent\.target\.unit\]/);
    assert.doesNotMatch(mount, /fixture\.plan\.intent\.target\.unit/);
  });

  it("workspace mounts LEARN after close and E2 until a prediction row exists", () => {
    const source = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(source, /CanvasLearn/);
    assert.match(source, /isLearnFace/);
    assert.match(source, /prediction=\{learnPrediction\}/);
    assert.doesNotMatch(source, /prediction=\{null\}/);
  });

  it("Locked children are the exhibit skeleton, not the word Locked", () => {
    const source = readFileSync("components/plan/canvas-learn.tsx", "utf8");
    assert.match(source, /LearnLockedSkeleton/);
    assert.match(source, /text-foreground\/35/);
    assert.match(source, /border-dashed/);
    assert.doesNotMatch(source, />Locked</);
    assert.doesNotMatch(source, /venueLabel = "NX"/);
  });

  it("page reads campaign_plan_predictions; archive writes actual", () => {
    const page = readFileSync("app/(dashboard)/plan/[id]/page.tsx", "utf8");
    assert.match(page, /loadPlanPredictions/);
    const route = readFileSync("app/api/plan/[id]/route.ts", "utf8");
    assert.match(route, /loadPlanWindowActual/);
    assert.match(route, /planLaunchedAt\(plan\.launches\)/);
    assert.match(route, /untilDate: todayIsoDate\(\)/);
    assert.match(route, /archiveCampaignPlan\(supabase, id, user.id, actual/);
    const predictions = readFileSync("lib/plan/predictions.ts", "utf8");
    assert.match(predictions, /export function planWindowActual/);
    assert.doesNotMatch(predictions, /rollup-sync-events/);
  });
});
