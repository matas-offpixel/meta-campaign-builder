/**
 * The canvas view model, one describe per zone. Run:
 * node --test lib/plan/__tests__/canvas.test.ts
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  PLAN_CANVAS_COPY,
  PLAN_DRAWER_SECTIONS,
  anchorForIssue,
  countDecisionsSince,
  decisionsHandleLabel,
  planCanvasMenuItemSpecs,
  planCanvasState,
  planChannelRows,
  planLastOpenedKey,
  planLaunchButton,
  resumeSupport,
} from "../canvas.ts";
import {
  PLAN_SPLIT_PRESETS,
  planDefaultWindow,
  planEffectiveTargetUnit,
  planSplitAmountsLine,
  planSplitSegments,
  planSplitToBudget,
  planTargetChip,
  planWindowFromHandles,
  planWindowHandles,
  planWindowMoments,
} from "../canvas-inputs.ts";
import { resolvePreset } from "../../optimisation/presets.ts";
import { resolvePlanDestination } from "../destination.ts";
import { derivePlanName, planHeaderName } from "../plan-name.ts";
import {
  PLAN_TARGET_UNITS,
  PLAN_TARGET_UNIT_TABLE,
  objectiveForTargetUnit,
} from "../target-unit.ts";
import { budgetedLaunchAdapters } from "../types.ts";
import {
  FIXTURE_HREFS,
  FIXTURE_LIVE_SPEND,
  FIXTURE_NOW,
  basePlan,
  blockingIssues,
  factsBundle,
  launchedPlan,
  readyPlan,
  waitingPlan,
} from "./canvas-fixtures.ts";

const DOD = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Defected On Deck",
  clientId: "c1",
  clientName: "Defected",
  venueName: "Printworks",
  eventDate: "2026-09-27",
  presaleAt: "2026-09-08T10:00:00.000Z",
  generalSaleAt: "2026-09-11T10:00:00.000Z",
  eventCode: "DOD26",
  ticketUrl: "https://tickets.example.com/dod26",
  signupUrl: null,
};

function rowsFor(
  plan = readyPlan(),
  issues = [] as ReturnType<typeof blockingIssues>,
  extra: { delivering?: boolean } = {},
) {
  return planChannelRows({
    plan,
    issues,
    facts: factsBundle(),
    hrefs: FIXTURE_HREFS,
    ...extra,
  });
}

// ── Zone A ────────────────────────────────────────────────────────────

describe("zone A · header", () => {
  it("names the plan from the event, never from an input", () => {
    // Before presale, DOD is in its announce phase.
    const name = derivePlanName(DOD, new Date("2026-09-04T12:00:00.000Z"));
    assert.match(name, /^Defected On Deck/);
    // A plan named before this PR keeps the name it was given.
    assert.equal(planHeaderName("Legacy name", DOD), "Legacy name");
    assert.equal(planHeaderName("", null), "New plan");
  });

  it("takes the destination off the event and refuses an override", () => {
    const resolved = resolvePlanDestination(DOD, "reg", "https://typed.example.com");
    assert.equal(resolved.url, DOD.ticketUrl);
    assert.equal(resolved.source, "ticket_url");

    // Only an event with neither URL may be overridden by hand.
    const bare = { ...DOD, ticketUrl: null, signupUrl: null };
    const manual = resolvePlanDestination(bare, "reg", "https://typed.example.com");
    assert.equal(manual.url, "https://typed.example.com");
    assert.equal(manual.source, "manual");
    assert.equal(resolvePlanDestination(bare, "reg", null).source, "none");
  });

  it("counts only the decisions taken since the plan was last opened", () => {
    const decisions = [
      { decidedAt: "2026-09-03T09:00:00.000Z" },
      { decidedAt: "2026-09-04T09:00:00.000Z" },
      { decidedAt: "2026-09-04T18:00:00.000Z" },
    ];
    assert.equal(countDecisionsSince(decisions, null), 3);
    assert.equal(countDecisionsSince(decisions, "2026-09-04T00:00:00.000Z"), 2);
    assert.equal(countDecisionsSince(decisions, "2026-09-05T00:00:00.000Z"), 0);
    assert.equal(decisionsHandleLabel(2), "◐ 2 ▸");
    assert.equal(decisionsHandleLabel(0), null);
    assert.match(planLastOpenedKey("p1"), /p1/);
  });

  it("puts every retired verb in the overflow menu", () => {
    const items = planCanvasMenuItemSpecs({
      status: "draft",
      disposal: "delete",
      hasMetaDraft: false,
      unregisteredAssets: 3,
    });
    const visible = items.filter((item) => !item.hidden).map((item) => item.id);
    assert.deepEqual(visible, [
      "from-existing",
      "register-assets",
      "duplicate",
      "template",
      "delete",
    ]);
    assert.match(
      items.find((item) => item.id === "register-assets")!.label,
      /Register 3 existing assets/,
    );

    // Once Meta is prepared there is nothing left to seed from.
    const prepared = planCanvasMenuItemSpecs({
      status: "archived",
      disposal: "archive",
      hasMetaDraft: true,
      unregisteredAssets: 0,
    });
    assert.equal(prepared.find((item) => item.id === "from-existing")!.hidden, true);
    assert.equal(prepared.find((item) => item.id === "unarchive")!.hidden, false);
  });
});

// ── Zone B ────────────────────────────────────────────────────────────

describe("zone B · window", () => {
  it("reads its moments off the event, in event order", () => {
    const moments = planWindowMoments(DOD, FIXTURE_NOW);
    assert.deepEqual(
      moments.map((moment) => moment.id),
      ["now", "presale", "gen-sale", "show"],
    );
    assert.ok(moments[1]!.at < moments[2]!.at);
    assert.ok(moments[2]!.at < moments[3]!.at);
  });

  it("defaults start to now and end to the show", () => {
    const dates = planDefaultWindow(DOD, FIXTURE_NOW);
    assert.equal(dates.endDate, DOD.eventDate);
    assert.equal(dates.startDate, "2026-09-04");
  });

  it("keeps the start buffer so Meta never sees a past start", () => {
    const handles = planWindowHandles(
      { startDate: null, startTime: null, endDate: DOD.eventDate, endTime: null },
      DOD,
      FIXTURE_NOW,
    );
    assert.ok(handles.start.getTime() > FIXTURE_NOW.getTime());
    assert.match(PLAN_CANVAS_COPY.window, /buffer/);
  });

  it("round-trips the handles back to the four stored fields", () => {
    const dates = planWindowFromHandles({
      start: new Date(2026, 8, 4, 18, 15),
      end: new Date(2026, 8, 27, 23, 59),
    });
    assert.deepEqual(dates, {
      startDate: "2026-09-04",
      startTime: "18:15",
      endDate: "2026-09-27",
      endTime: "23:59",
    });
  });
});

// ── Zone C ────────────────────────────────────────────────────────────

describe("zone C · budget", () => {
  it("derives the split bar from the stored pounds and back", () => {
    const budget = basePlan().intent.budget;
    const segments = planSplitSegments(budget);
    assert.equal(
      segments.reduce((sum, segment) => sum + segment.pct, 0),
      100,
    );
    assert.deepEqual(planSplitToBudget(segments, 120), {
      totalDaily: 120,
      metaDaily: 96,
      tiktokDaily: 18,
      googleDaily: 6,
    });
    assert.equal(planSplitAmountsLine(budget), "96 · 18 · 6");
  });

  it("a platform at 0% is skipped, which is what the toggle used to say", () => {
    const zeroed = planSplitToBudget(
      [
        { platform: "meta", pct: 100 },
        { platform: "tiktok", pct: 0 },
        { platform: "google", pct: 0 },
      ],
      120,
    );
    assert.deepEqual(budgetedLaunchAdapters(zeroed), ["meta"]);

    const rows = planChannelRows({
      plan: { ...readyPlan(), intent: { ...readyPlan().intent, budget: zeroed } },
      issues: blockingIssues(),
      facts: factsBundle(),
      hrefs: FIXTURE_HREFS,
    });
    const tiktok = rows.find((row) => row.adapter === "tiktok")!;
    assert.equal(tiktok.skipped, true);
    // Skipped rows carry no blockers — there is nothing to fix on an off row.
    assert.deepEqual(tiktok.blockers, []);
    assert.equal(tiktok.draftId, "tiktok-draft");
  });

  it("offers the same presets the splitter already had", () => {
    assert.equal(PLAN_SPLIT_PRESETS.length, 4);
    for (const preset of PLAN_SPLIT_PRESETS) {
      assert.equal(
        preset.pct.reduce((sum, pct) => sum + pct, 0),
        100,
        preset.label,
      );
    }
  });
});

// ── Zone D ────────────────────────────────────────────────────────────

describe("zone D · target", () => {
  it("renders the plan's own target as manual entry", () => {
    const chip = planTargetChip({ value: 1.2, unit: "reg", benchmark: 2.5 });
    assert.equal(chip.label, "◎ £1.20 / reg");
    assert.equal(chip.provenance, "manual entry");
    assert.equal(chip.seeded, false);
  });

  it("falls back to the preset benchmark rather than an empty field", () => {
    const chip = planTargetChip({ value: null, unit: "reg", benchmark: 2.5 });
    assert.equal(chip.label, "◎ £2.50 / reg");
    assert.equal(chip.seeded, true);
    assert.notEqual(chip.provenance, "manual entry");
    assert.match(PLAN_CANVAS_COPY.targetSeed, /benchmark/);
  });

  /**
   * Real plans predate `target_unit` (the DOD plan has NULL for both
   * columns), so the objective supplies the unit rather than every
   * pre-165 plan reading `— · no unit`.
   */
  it("infers the unit from the objective for plans that predate 165", () => {
    assert.deepEqual(planEffectiveTargetUnit(null, "registration"), {
      unit: "reg",
      inferred: true,
    });
    assert.deepEqual(planEffectiveTargetUnit(null, "traffic"), {
      unit: "lpv",
      inferred: true,
    });
    // A stored unit always wins over the objective's default.
    assert.deepEqual(planEffectiveTargetUnit("click", "registration"), {
      unit: "click",
      inferred: false,
    });
    // Engagement is the one intent with nothing to price.
    assert.deepEqual(planEffectiveTargetUnit(null, "engagement"), {
      unit: null,
      inferred: false,
    });
    assert.match(PLAN_CANVAS_COPY.unitInferred, /objective/);
  });

  it("engagement has no unit, so the objective is picked directly", () => {
    const chip = planTargetChip({ value: null, unit: null, benchmark: null });
    assert.equal(chip.label, "— · no unit");
    assert.equal(chip.needsObjective, true);
    assert.match(PLAN_CANVAS_COPY.noUnit, /objective/);
    assert.match(PLAN_CANVAS_COPY.unitChangesObjective, /preflight/);
  });

  /**
   * The unit is the objective picker. Zone D deleted the objective select
   * because these five units already name five objectives, and the preset
   * is resolved per client × objective — so a unit change re-resolves it.
   */
  it("changing the unit changes the objective the preset resolves on", () => {
    const objectives = PLAN_TARGET_UNITS.map((unit) => objectiveForTargetUnit(unit));
    assert.deepEqual(objectives, [
      "registration",
      "traffic",
      "traffic",
      "purchase",
      "awareness",
    ]);
    // Every unit reaches an objective a preset can be resolved for.
    for (const objective of objectives) {
      assert.equal(resolvePreset("c1", objective, []).source, "industry seed");
    }
    // `click` and `lpv` share `traffic`, so the same preset with a
    // different denominator — which is why the unit, not the objective,
    // is what the chip shows.
    assert.equal(objectiveForTargetUnit("click"), objectiveForTargetUnit("lpv"));
    assert.notEqual(
      PLAN_TARGET_UNIT_TABLE.click.optimisationGoal,
      PLAN_TARGET_UNIT_TABLE.lpv.optimisationGoal,
    );
  });
});

// ── Zone E ────────────────────────────────────────────────────────────

describe("zone E · channel rows", () => {
  it("waits for Meta rather than claiming the derived rows are blocked", () => {
    const rows = rowsFor(waitingPlan(), blockingIssues());
    const meta = rows.find((row) => row.adapter === "meta")!;
    assert.equal(meta.waiting, false);

    for (const adapter of ["tiktok", "google"] as const) {
      const row = rows.find((r) => r.adapter === adapter)!;
      assert.equal(row.waiting, true, adapter);
      assert.equal(row.state, "waiting", adapter);
      assert.equal(row.waitingFor, "meta", adapter);
    }
  });

  it("is ready with no blockers and blocked with them", () => {
    const ready = rowsFor();
    assert.deepEqual(
      ready.map((row) => row.status),
      ["ready", "ready", "ready"],
    );

    const blocked = rowsFor(readyPlan(), blockingIssues());
    const meta = blocked.find((row) => row.adapter === "meta")!;
    assert.equal(meta.status, "blocked");
    assert.equal(meta.state, "blocked");
    assert.equal(meta.blockers.length, 2);
  });

  it("gives every blocker the drawer coordinate PR 4 will use", () => {
    const meta = rowsFor(readyPlan(), blockingIssues()).find(
      (row) => row.adapter === "meta",
    )!;
    assert.deepEqual(
      meta.blockers.map((row) => row.anchor),
      [
        { drawer: "meta", section: "f-audiences" },
        { drawer: "meta", section: "f-creatives" },
      ],
    );
    // Every section id a row can point at is one the drawer will define.
    for (const [drawer, sections] of Object.entries(PLAN_DRAWER_SECTIONS)) {
      for (const section of sections) {
        assert.equal(anchorForIssue({
          adapter: drawer as "meta",
          id: section,
          field: section,
          message: section,
          blocking: true,
        }).drawer, drawer);
      }
    }
  });

  it("carries the counts the drawer will keep showing", () => {
    const rows = rowsFor();
    assert.deepEqual(rows.find((row) => row.adapter === "meta")!.facts, [
      { n: 6, noun: "audiences" },
      { n: 12, noun: "creatives" },
      { n: 4, noun: "ad sets" },
    ]);
    assert.equal(rows.find((row) => row.adapter === "tiktok")!.derived, true);
    assert.equal(rows.find((row) => row.adapter === "meta")!.derived, false);
  });

  it("reads paused once launched and live once delivering", () => {
    const launched = rowsFor(launchedPlan());
    assert.deepEqual(
      launched.map((row) => row.status),
      ["paused", "paused", "paused"],
    );

    const live = rowsFor(launchedPlan(), [], { delivering: true });
    assert.deepEqual(
      live.map((row) => row.status),
      ["live", "live", "live"],
    );
  });

  it("only Meta can be resumed from this app", () => {
    assert.equal(resumeSupport("meta").supported, true);
    assert.equal(resumeSupport("meta").reason, null);
    for (const adapter of ["tiktok", "google"] as const) {
      assert.equal(resumeSupport(adapter).supported, false);
      assert.match(resumeSupport(adapter).reason!, /Ads Manager/);
    }
  });
});

// ── Zone G ────────────────────────────────────────────────────────────

describe("zone G · one button", () => {
  const open = { gateEnabled: true, hasEvent: true, hasDestination: true, busy: false };

  it("is waiting until a Meta draft exists", () => {
    const plan = waitingPlan();
    assert.equal(
      planCanvasState({ plan, rows: rowsFor(plan), liveSpend: null }),
      "waiting",
    );
  });

  it("is blocked while preflight has blockers, and says so", () => {
    const plan = readyPlan();
    const rows = rowsFor(plan, blockingIssues());
    assert.equal(planCanvasState({ plan, rows, liveSpend: null }), "blocked");

    const button = planLaunchButton({
      ...open,
      state: "blocked",
      rows,
      preflightOk: false,
    });
    assert.equal(button.kind, "launch");
    assert.equal(button.disabled, true);
    assert.equal(button.reason, PLAN_CANVAS_COPY.blockers);
  });

  it("is ready, and only then is the button live", () => {
    const plan = readyPlan();
    const rows = rowsFor(plan);
    assert.equal(planCanvasState({ plan, rows, liveSpend: null }), "ready");

    const button = planLaunchButton({ ...open, state: "ready", rows, preflightOk: true });
    assert.equal(button.label, "⏸ Launch");
    assert.equal(button.disabled, false);
    assert.equal(button.reason, null);
  });

  it("never enables launch with the fan-out killswitch off", () => {
    const rows = rowsFor();
    const button = planLaunchButton({
      ...open,
      gateEnabled: false,
      state: "ready",
      rows,
      preflightOk: true,
    });
    assert.equal(button.disabled, true);
    assert.match(button.reason!, /ENABLE_PLAN_FANOUT/);
  });

  it("becomes Resume 3 once the platforms hold paused campaigns", () => {
    const plan = launchedPlan();
    const rows = rowsFor(plan);
    assert.equal(planCanvasState({ plan, rows, liveSpend: null }), "launched");
    assert.equal(planCanvasState({ plan, rows, liveSpend: 0 }), "launched");

    const button = planLaunchButton({ ...open, state: "launched", rows, preflightOk: true });
    assert.equal(button.kind, "resume");
    assert.equal(button.label, "▷ Resume 3");
    assert.equal(button.resumeCount, 3);
    assert.equal(button.disabled, false);
  });

  it("is live once the rollups show spend", () => {
    const plan = launchedPlan();
    const rows = rowsFor(plan, [], { delivering: true });
    assert.equal(
      planCanvasState({ plan, rows, liveSpend: FIXTURE_LIVE_SPEND }),
      "live",
    );

    // Nothing to press on a delivering plan, so no button is rendered.
    const button = planLaunchButton({ ...open, state: "live", rows, preflightOk: true });
    assert.equal(button.kind, "none");
    assert.equal(button.resumeCount, 0);
    assert.equal(button.reason, null);
  });

  /**
   * The mixed state the real DOD plan is in: Meta delivering, TikTok and
   * Google never prepared. `Resume` must count only what is actually
   * paused, and the plan is still LIVE.
   */
  it("counts only the paused rows when one platform is delivering", () => {
    const plan = launchedPlan();
    const partly = {
      ...plan,
      launches: {
        ...plan.launches,
        tiktok: { ...plan.launches.tiktok, status: "idle" as const, platformCampaignId: null },
      },
    };
    const rows = planChannelRows({
      plan: partly,
      issues: [],
      facts: factsBundle(),
      hrefs: FIXTURE_HREFS,
    });
    assert.equal(planCanvasState({ plan: partly, rows, liveSpend: 633.09 }), "live");
    const button = planLaunchButton({ ...open, state: "live", rows, preflightOk: true });
    assert.equal(button.kind, "resume");
    assert.equal(button.label, "▷ Resume 2");
  });
});

// ── grep-guard ────────────────────────────────────────────────────────

function planComponentFiles(): string[] {
  const dir = "components/plan";
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile() && path.endsWith(".tsx"));
}

describe("components/plan grep-guard", () => {
  it("stands no paragraphs and no CardDescription", () => {
    for (const file of planComponentFiles()) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /<p[\s>]/, `${file} has a <p>`);
      assert.doesNotMatch(source, /CardDescription/, `${file} has a CardDescription`);
    }
  });

  /**
   * Sentences belong in `InfoTip` or in `lib/plan` constants, so the
   * components stay glyphs and numbers. A literal is allowed through
   * only when it is the value of an `InfoTip`-shaped prop.
   */
  it("stands no long string literal outside an InfoTip prop", () => {
    const allowedProp = /(?:label|tip|title|reason|aria-label|emptyText|placeholder)=$/;
    for (const file of planComponentFiles()) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/"([^"\n]{61,})"/g)) {
        const before = source.slice(0, match.index);
        const isClassName = /className=(\{`)?$/.test(before) || /class(Name)?="?$/.test(before);
        const isImport = /from\s*$/.test(before);
        if (isClassName || isImport || allowedProp.test(before)) continue;
        assert.fail(`${file} stands a ${match[1].length}-char literal: ${match[1]}`);
      }
    }
  });

  it("does not import the controls this PR retired", () => {
    for (const file of planComponentFiles()) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(
        source,
        /plan-datetime-field|plan-budget-controls|pipeline-stepper|PipelineStepper/,
        `${file} still reaches for a retired control`,
      );
    }
  });
});
