import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { evaluateAdSet } from "../../optimisation/evaluate.ts";
import type { BudgetGuardrails, OptimisationRule } from "../../types.ts";
import { formatPaceSentence } from "../../viz/pace.ts";
import { VIZ_CLIENT_SAFE, VIZ_LOCKED_CLIENT_CREATIVE, VIZ_TICKET_LINE_WORD } from "../../viz/tokens.ts";
import {
  ADJUST_APPLY_NEXT_CHECK,
  ADJUST_LIFETIME_TIP,
  ADJUST_LOG_TITLE,
  ADJUST_NO_READS,
  ADJUST_NO_USUAL,
  ADJUST_OPERATOR_APPLY_PATH,
  ADJUST_PAGE_VIEWS_EMPTY,
  ADJUST_PHASE_LABEL,
  ADJUST_CHANNEL_NOT_CONNECTED,
  ADJUST_NO_PURCHASES,
  ADJUST_PLACEMENT_EMPTY,
  ADJUST_PLACEMENT_FACEBOOK,
  ADJUST_PLACEMENT_LINES,
  adjustPrimaryReadingUnit,
  formatDecisionClock,
  adjustControlsVisible,
  adjustFaceView,
  formatAgainstUsual,
  formatGbp,
  formatChannelEarnedNothing,
  formatCreativeLocked,
  formatLeftAlone,
  formatLogDid,
  formatLogEmpty,
  formatMetaSays,
  formatCreativeStale,
  formatNoUsual,
  formatUsualFromShows,
  formatOurTagNotMeasured,
  formatPurchaseDisagreement,
  formatRefusal,
  formatSuggestion,
  formatTicketLine,
  formatUndoUntil,
  nextCheckClock,
  adjustFaceSentences,
  elapsedLondonDays,
  plannedSpendByToday,
  writeGatesOpen,
  adjustLogFromDecisions,
  emptyAdjustReads,
} from "../adjust-face.ts";
import { planLaunchedAt } from "../launch-face.ts";
import { IDLE_PLAN_LAUNCH } from "../types.ts";
import { planBenchmark, type BenchmarkRow } from "../benchmarks.ts";

describe("ADJUST J-states — sentences", () => {
  it("J1 day 0 — no reads and empty log", () => {
    assert.equal(ADJUST_NO_READS, "no reads yet — Meta's first day arrives at 08:00 tomorrow");
    assert.equal(adjustFaceSentences("J1")[1], formatLogEmpty());
  });

  it("J2 / J24 pace is sums, never a percentage", () => {
    const sentence = formatPaceSentence(558, 350);
    assert.equal(sentence, "£558 spent since launch · plan said £350 by today");
    assert.doesNotMatch(sentence, /%/);
  });

  it("J23 kept reading carries before general sale", () => {
    assert.equal(ADJUST_PHASE_LABEL, "before general sale");
  });

  it("J7 no usual", () => {
    assert.equal(ADJUST_NO_USUAL, "no usual yet — opens after your first finished show");
    assert.equal(formatNoUsual(null), ADJUST_NO_USUAL);
    assert.equal(formatNoUsual(""), ADJUST_NO_USUAL);
  });

  it("J8 two-source lines never merge; gap is unsigned", () => {
    assert.equal(
      formatPurchaseDisagreement({ metaPurchases: 74, tickets: 558 }),
      "Meta says 74 purchases · tickets 558 · Meta counts 484 fewer",
    );
    assert.equal(
      formatPurchaseDisagreement({ metaPurchases: 2656, tickets: 558 }),
      "Meta says 2,656 purchases · tickets 558 · 2,098 unexplained",
    );
    assert.doesNotMatch(formatPurchaseDisagreement({ metaPurchases: 74, tickets: 558 }), /-/);
  });

  it("J12 channel that earned nothing", () => {
    assert.equal(
      formatChannelEarnedNothing({
        channel: "Meta",
        unitWord: "signup",
        spend: 6657,
        spendSharePct: 99,
      }),
      "Pause Meta — 0 signups on £6,657 (99% of spend) since launch.",
    );
  });

  it("J16 suggestion from evaluate via VIZ_ACTION_WORD.suggest", () => {
    assert.equal(
      formatSuggestion({
        action: "scale_up",
        adSetName: "Tech House Pages",
        deltaPercent: 15,
        cost: 1.1,
        unitWord: "signup",
        usual: 2.03,
        results: 38,
        windowWord: "this week",
      }),
      'Raise "Tech House Pages" by 15% — £1.10 per signup, under your usual £2.03, 38 signups this week.',
    );
  });

  it("J18 refusal uses the rule's reason", () => {
    assert.equal(
      formatRefusal("Disco Pages", 5, 3, "signup"),
      '"Disco Pages" left alone — 3 of 5 signups needed',
    );
  });

  it("J19 creative locked; J22 client-safe", () => {
    assert.equal(formatCreativeLocked("operator", "Tue 26 Aug"), formatCreativeStale("Tue 26 Aug"));
    assert.equal(formatCreativeLocked("client", "Tue 26 Aug"), VIZ_LOCKED_CLIENT_CREATIVE);
    assert.equal(VIZ_LOCKED_CLIENT_CREATIVE, "not measured yet — creative results are scored after your first finished show");
    assert.doesNotMatch(VIZ_CLIENT_SAFE("creative_scores table and ENABLE_AI_AUTOTAG"), /table|ENABLE_/i);
  });

  it("placements not-yet; tickets source not recorded", () => {
    assert.equal(ADJUST_PLACEMENT_FACEBOOK, "facebook · — · not read yet");
    assert.equal(ADJUST_PLACEMENT_EMPTY, "instagram · — · not read yet");
    assert.deepEqual([...ADJUST_PLACEMENT_LINES], [
      "facebook · — · not read yet",
      "instagram · — · not read yet",
    ]);
    assert.equal(VIZ_TICKET_LINE_WORD.unknown, "source not recorded");
    assert.match(formatTicketLine("none"), /not entered yet/);
    assert.equal(formatTicketLine("unknown", 553), "553 tickets · source not recorded");
    assert.equal(
      formatPurchaseDisagreement({ metaPurchases: 0, tickets: 0, ticketSource: "none" }),
      "Meta says 0 purchases · tickets not entered yet",
    );
    assert.doesNotMatch(
      formatPurchaseDisagreement({ metaPurchases: 0, tickets: 0, ticketSource: "none" }),
      /tickets 0/,
    );
  });

  it("funnel two lines stay two lines", () => {
    assert.equal(formatMetaSays(1086, "signups"), "Meta says 1,086 signups");
    assert.match(formatOurTagNotMeasured("dod-newcastle.com"), /dod-newcastle\.com/);
    assert.doesNotMatch(formatMetaSays(1086, "signups"), /our tag/);
  });

  it("log grouping collapse and past tense", () => {
    assert.equal(ADJUST_LOG_TITLE, "changes · last 7 days");
    assert.equal(formatLeftAlone(36), "36 ad sets left alone");
    assert.equal(formatLogDid({ action: "scale_up", adSetName: "Venue" }), 'Raised "Venue"');
  });

  it("undo time comes from the cron schedule, not a constant 13:00", () => {
    const atNoonUtc = new Date("2026-09-06T11:00:00.000Z");
    assert.equal(nextCheckClock(atNoonUtc), "13:00");
    assert.equal(formatUndoUntil("13:00"), "undo until the next check at 13:00");
    const source = readFileSync("lib/plan/adjust-face.ts", "utf8");
    assert.match(source, /0, 4, 8, 12, 16, 20/);
    const vercel = readFileSync("vercel.json", "utf8");
    assert.match(vercel, /optimisation-tick[\s\S]*0 \*\/4 \* \* \*/);
  });

  it("client role strips exactly the three controls", () => {
    const client = adjustControlsVisible("client");
    assert.deepEqual(client, { suggestion: false, doIt: false, notNow: false, undo: false });
    const operator = adjustControlsVisible("operator");
    assert.deepEqual(operator, { suggestion: true, doIt: true, notNow: true, undo: true });
  });

  it("cost against usual", () => {
    assert.equal(
      formatAgainstUsual(0.51, "signup", 2.03),
      "£0.51 per signup · under your usual £2.03",
    );
  });
});

describe("ADJUST J-states — every §3.3 state has a render sentence", () => {
  const states = [
    "J1",
    "J2",
    "J3",
    "J5",
    "J7",
    "J8",
    "J9",
    "J12",
    "J14",
    "J16",
    "J17",
    "J18",
    "J19",
    "J22",
    "J23",
    "J24",
  ] as const;

  for (const state of states) {
    it(`${state} renders its sentence`, () => {
      const sentences = adjustFaceSentences(state);
      assert.ok(sentences.length > 0, `${state} has no sentence`);
      for (const sentence of sentences) {
        assert.doesNotMatch(sentence, /\d{4}-\d{2}-\d{2}/);
        assert.doesNotMatch(sentence, /VIZ_STATUS_LABEL|VIZ_ACTION_LABEL/);
      }
    });
  }

  it("planned-by-today is daily × elapsed London days", () => {
    const since = new Date("2026-08-27T12:00:00.000Z");
    const now = new Date("2026-09-06T12:00:00.000Z");
    assert.equal(elapsedLondonDays(since, now), 10);
    assert.equal(plannedSpendByToday(35, since, now), 350);
  });

  it("log grouping collapses maintain rows and keeps refusals", () => {
    const days = adjustLogFromDecisions(
      [
        {
          decidedAt: "2026-09-06T12:00:00.000Z",
          action: "maintain",
          reasonText: "in band",
          resultCount: 8,
          applied: false,
          dryRun: true,
        },
        {
          decidedAt: "2026-09-06T12:01:00.000Z",
          action: "maintain",
          reasonText: "in band",
          resultCount: 4,
          applied: false,
          dryRun: true,
        },
        {
          decidedAt: "2026-09-06T12:02:00.000Z",
          action: "insufficient_conversions",
          reasonText: "3/5 conversions in the 7d window for ad set — insufficient evidence, no budget change.",
          resultCount: 3,
          applied: false,
          dryRun: true,
          adsetName: "Disco Pages",
        },
      ],
      "signup",
      new Date("2026-09-06T13:00:00.000Z"),
    );
    assert.equal(days.length, 1);
    assert.equal(days[0]!.rows.some((row) => row.kind === "collapse" && row.count === 2), true);
    assert.equal(
      days[0]!.rows.some((row) => row.kind === "refusal" && row.adSetName === "Disco Pages"),
      true,
    );
  });

  it("do it is absent unless the three write gates are open", () => {
    assert.equal(writeGatesOpen({ writesEnabled: true, enabled: true, live: true }), true);
    assert.equal(writeGatesOpen({ writesEnabled: false, enabled: true, live: true }), false);
    assert.equal(writeGatesOpen({ writesEnabled: true, enabled: true, live: false }), false);
  });
});

describe("ADJUST surface guards", () => {
  it("canvas-adjust uses card ⓘ and does not import evaluate.ts", () => {
    const source = readFileSync("components/plan/canvas-adjust.tsx", "utf8");
    assert.match(source, /ADJUST_INFO_VARIANT|variant=["']card["']/);
    assert.doesNotMatch(source, /evaluate\.ts|lib\/optimisation\/evaluate/);
    assert.doesNotMatch(source, /VIZ_STATUS_LABEL|VIZ_ACTION_LABEL/);
    assert.doesNotMatch(source, /\d{4}-\d{2}-\d{2}T/);
    assert.match(source, /max-md:flex max-md:flex-col/);
    assert.match(source, /min-h-11/);
    assert.match(source, /end not set/);
    assert.match(source, /adjustFaceView/);
    assert.match(source, /ADJUST_PLACEMENT_LINES/);
    assert.match(source, /adjustControlsVisible/);
    assert.match(source, /by creative name/);
    assert.doesNotMatch(source, />Locked</);
  });

  it("workspace mounts ADJUST as the live morning read", () => {
    const source = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(source, /CanvasAdjust/);
    assert.match(source, /adjustPrimaryReadingUnit/);
    assert.doesNotMatch(source, /unitWord=\{unitWord\}/);
    assert.match(source, /state === "live" \|\| state === "launched"/);
    assert.match(source, /stages=\{undefined\}/);
    assert.match(source, /metaSignups=\{adjustReads/);
    assert.match(source, /planLaunchedAt/);
    assert.match(source, /from "@\/lib\/plan\/launch-face"/);
  });

  it("idle prepare-draft row does not set the ADJUST window start", () => {
    assert.equal(
      planLaunchedAt({
        meta: { ...IDLE_PLAN_LAUNCH, createdAt: "2026-07-24T09:14:00.000Z" },
        tiktok: { ...IDLE_PLAN_LAUNCH },
        google: { ...IDLE_PLAN_LAUNCH },
      }),
      null,
    );
    const adjustFace = readFileSync("lib/plan/adjust-face.ts", "utf8");
    assert.doesNotMatch(adjustFace, /export function planLaunchedAt/);
    const page = readFileSync("app/(dashboard)/plan/[id]/page.tsx", "utf8");
    assert.match(page, /sinceDate: launchedAt \? launchedAt\.slice\(0, 10\) : null/);
    assert.match(page, /from "@\/lib\/plan\/launch-face"/);
    assert.match(page, /loadPlanBenchmarkRows/);
    assert.doesNotMatch(readFileSync("lib/plan/adjust-reads.ts", "utf8"), /loadPlanBenchmarkRows/);
    assert.match(readFileSync("lib/plan/launch-reads.ts", "utf8"), /export async function loadPlanBenchmarkRows/);
  });
});

describe("ADJUST review round 1 — the view the surface calls", () => {
  const NOW = new Date("2026-09-06T12:00:00.000+01:00");
  const EVALUATE_RULE: OptimisationRule = {
    id: "r1",
    name: "Primary Rule Set — Cost per Registration",
    metric: "cpr",
    timeWindow: "7d",
    enabled: true,
    priority: "primary",
    thresholds: [
      {
        id: "t1",
        operator: "below",
        value: 1,
        action: "increase_budget",
        actionValue: 30,
        label: "Below £1 CPR → scale aggressively (+30%)",
      },
    ],
  };
  const EVALUATE_GUARDRAILS: BudgetGuardrails = {
    baseCampaignBudget: 100,
    maxExpansionPercent: 50,
    hardBudgetCeiling: 150,
    ceilingBehaviour: "stop",
  };
  const EVALUATE_SCALE_UP = evaluateAdSet({
    rules: [EVALUATE_RULE],
    guardrails: EVALUATE_GUARDRAILS,
    currentBudgetPence: 10000,
    liveMetric: { name: "cpr", value: 0.8, window: "7d", resultCount: 38 },
    lastTouchedAt: null,
    impressions: 1000,
  }).reason;
  const EVALUATE_REFUSAL = evaluateAdSet({
    rules: [EVALUATE_RULE],
    guardrails: EVALUATE_GUARDRAILS,
    currentBudgetPence: 10000,
    liveMetric: { name: "cpr", value: 0.8, window: "7d", resultCount: 3 },
    lastTouchedAt: null,
    impressions: 1000,
  }).reason;

  it("log uses evaluate.ts reason strings and the draft ad-set name, not the rule label", () => {
    const face = adjustFaceView({
      spent: 558,
      planned: 350,
      metaSignups: 1086,
      metaPurchases: null,
      tickets: null,
      ticketSource: "none",
      now: NOW,
      decisions: [
        {
          decidedAt: "2026-09-06T10:00:00.000Z",
          action: "scale_up",
          reasonText: EVALUATE_SCALE_UP,
          resultCount: 38,
          applied: false,
          dryRun: true,
          adsetId: "120",
          adsetName: "Tech House Pages",
          budgetBeforePence: 10000,
          budgetAfterPence: 13000,
          metricValue: 0.8,
          metricWindow: "7d",
        },
        {
          decidedAt: "2026-09-06T10:01:00.000Z",
          action: "insufficient_conversions",
          reasonText: EVALUATE_REFUSAL,
          resultCount: 3,
          applied: false,
          dryRun: true,
          adsetId: "121",
          adsetName: "Disco Pages",
        },
      ],
    });
    const rendered = face.logDays.flatMap((day) =>
      day.rows.map((row) =>
        row.kind === "did"
          ? formatLogDid(row)
          : row.kind === "refusal"
            ? formatRefusal(row.adSetName, row.needed, row.have, row.unitWord)
            : formatLeftAlone(row.count),
      ),
    );
    assert.equal(
      rendered.some((line) => line === `Raised "Tech House Pages" by 30% at ${formatDecisionClock("2026-09-06T10:00:00.000Z")}`),
      true,
    );
    assert.equal(
      rendered.some((line) => line === '"Disco Pages" left alone — 3 of 5 signups needed'),
      true,
    );
    assert.equal(rendered.some((line) => line.includes("Below £1 CPR")), false);
    assert.match(EVALUATE_SCALE_UP, /matched "Below £1 CPR/);
    assert.match(EVALUATE_REFUSAL, /insufficient evidence, no budget change/);
  });

  it("not now survives closed gates; do it is absent with no apply path", () => {
    assert.equal(ADJUST_OPERATOR_APPLY_PATH, false);
    const face = adjustFaceView({
      spent: 558,
      planned: 350,
      metaSignups: 1086,
      metaPurchases: null,
      tickets: null,
      ticketSource: "none",
      now: NOW,
      writeGates: { writesEnabled: false, enabled: true, live: false },
      operatorApplyPath: false,
      decisions: [
        {
          decidedAt: "2026-09-06T10:00:00.000Z",
          action: "scale_up",
          reasonText: EVALUATE_SCALE_UP,
          resultCount: 38,
          applied: false,
          dryRun: true,
          adsetName: "Tech House Pages",
          budgetBeforePence: 10000,
          budgetAfterPence: 11500,
          metricValue: 1.1,
          metricWindow: "7d",
        },
      ],
    });
    assert.match(face.suggestionSentence ?? "", /Raise "Tech House Pages"/);
    assert.equal(face.notNow, true);
    assert.equal(face.doIt, false);
    assert.equal(face.applyTip, ADJUST_APPLY_NEXT_CHECK);
  });

  it("D.O.D fixture reads £0.51 per signup on 1,086", () => {
    const face = adjustFaceView({
      spent: 558,
      planned: 350,
      metaSignups: 1086,
      metaPurchases: 16,
      tickets: null,
      ticketSource: "none",
      now: NOW,
      launchedAt: "2026-08-27T12:00:00.000Z",
      generalSaleAt: "2026-09-04T00:00:00.000+01:00",
      venueName: "NX",
    });
    assert.equal(face.signupLine, "£0.51 per signup");
    assert.match(face.stageLines.join("\n"), /Meta says 1,086 signups/);
    assert.doesNotMatch(face.signupLine ?? "", /£—/);
  });

  it("J24 rail draws with end unset and start at the launch ledger", () => {
    const launchedAt = "2026-08-27T09:00:00.000Z";
    const face = adjustFaceView({
      spent: 558,
      planned: 350,
      metaSignups: 1086,
      metaPurchases: null,
      tickets: null,
      ticketSource: "none",
      now: NOW,
      launchedAt,
      endSet: false,
      windowStart: new Date("2026-01-01T00:00:00.000Z"),
    });
    assert.equal(face.windowEmpty, false);
    assert.equal(face.endLabel, "end not set");
    assert.equal(face.windowStart?.toISOString(), new Date(launchedAt).toISOString());
    assert.equal(face.paceTone, "below");
    const onPace = adjustFaceView({
      spent: 350,
      planned: 350,
      metaSignups: 1086,
      metaPurchases: null,
      tickets: null,
      ticketSource: "none",
      now: NOW,
    });
    assert.equal(onPace.paceTone, "none");
  });

  it("venue substitution replaces the NX constant", () => {
    const face = adjustFaceView({
      spent: 558,
      planned: 350,
      metaSignups: 1086,
      metaPurchases: null,
      tickets: null,
      ticketSource: "none",
      now: NOW,
      venueName: "Electric Brixton",
    });
    assert.equal(face.noUsual, formatNoUsual("Electric Brixton"));
    assert.doesNotMatch(face.noUsual ?? "", /\bNX\b/);
    const emptyVenue = adjustFaceView({
      spent: 558,
      planned: 350,
      metaSignups: 1086,
      metaPurchases: null,
      tickets: null,
      ticketSource: "none",
      now: NOW,
    });
    assert.equal(emptyVenue.noUsual, "no usual yet — opens after your first finished show");
  });

  it("J23 renders both readings plus the tickets line", () => {
    const face = adjustFaceView({
      spent: 558,
      planned: 350,
      metaSignups: 1086,
      metaPurchases: 16,
      tickets: null,
      ticketSource: "none",
      now: NOW,
      launchedAt: "2026-08-27T12:00:00.000Z",
      generalSaleAt: "2026-09-04T00:00:00.000+01:00",
    });
    assert.equal(face.signupPhaseLabel, ADJUST_PHASE_LABEL);
    assert.equal(face.signupLine, "£0.51 per signup");
    assert.equal(face.purchaseLine, `Meta says ${formatGbp(558 / 16)} per purchase`);
    assert.match(face.ticketLine, /not entered yet/);
    assert.equal(face.infoHeader, "ESTIMATED · META'S SIGNUP COUNT, YOUR SPEND");
    assert.equal(face.purchaseInfoHeader, "ESTIMATED · META'S PURCHASE COUNT, YOUR SPEND");
    assert.doesNotMatch([face.signupLine, face.purchaseLine].join(" "), /\bESTIMATED\b/);
  });

  it("the five stages render with the source rule", () => {
    const face = adjustFaceView({
      spent: 558,
      planned: 350,
      metaSignups: 1086,
      metaPurchases: null,
      tickets: null,
      ticketSource: "none",
      now: NOW,
      reach: 41200,
      clicks: 2104,
      pageViews: null,
      tagDomain: "dod-newcastle.com",
      channels: [
        { name: "Meta", spend: 318, results: 1086 },
        { name: "TikTok", spend: 240, results: null },
        { name: "Google", spend: 0, results: null },
      ],
    });
    assert.deepEqual(
      face.stageLines.filter((line) => /^(reach|clicks|page views)/.test(line) || line.startsWith("Meta says") || line.startsWith("our tag") || line.startsWith("tickets")),
      [
        "reach · 41,200",
        "clicks · 2,104",
        `page views · ${ADJUST_PAGE_VIEWS_EMPTY}`,
        "Meta says 1,086 signups",
        "our tag: not measured for this show — signups are collected on dod-newcastle.com and are not synced here",
        "tickets: not entered yet — enter ticket sales on the event",
      ],
    );
    assert.equal(face.channelLines[0], "Meta · 100% of results · 57% of spend");
    assert.equal(face.channelLines[2], "Google · no reads yet");
  });

  it("day-0 log empty uses nextCheckClock, not a constant 13:00", () => {
    const atNoonUtc = new Date("2026-09-06T11:00:00.000Z");
    assert.equal(formatLogEmpty(atNoonUtc), `nothing yet — the first check is at ${nextCheckClock(atNoonUtc)}`);
    const later = new Date("2026-09-06T14:00:00.000Z");
    assert.notEqual(formatLogEmpty(later), "nothing yet — the first check is at 13:00");
  });

  it("day 0 with zero rollup rows renders J1, not £0 spent", () => {
    const reads = emptyAdjustReads();
    assert.equal(reads.metaRegs, null);
    const face = adjustFaceView({
      spent: reads.spend,
      planned: 0,
      metaSignups: reads.metaRegs,
      metaPurchases: reads.metaPurchases,
      tickets: reads.tickets,
      ticketSource: "none",
      now: NOW,
    });
    assert.equal(face.noReads, true);
    assert.equal(face.paceSentence, ADJUST_NO_READS);
    assert.doesNotMatch(face.paceSentence, /£0 spent/);
    const source = readFileSync("lib/plan/adjust-reads.ts", "utf8");
    assert.match(source, /rowCount === 0/);
    assert.match(source, /emptyAdjustReads/);
  });

  it("a view plan reads META'S REACH and cost per thousand reached", () => {
    const face = adjustFaceView({
      spent: 558,
      planned: 350,
      metaSignups: 1086,
      metaPurchases: null,
      tickets: null,
      ticketSource: "none",
      now: NOW,
      kind: "brand",
      unitWord: "click",
    });
    assert.equal(face.infoHeader, "ESTIMATED · META'S REACH, YOUR SPEND");
    assert.equal(face.costLabel, "cost per thousand reached");
    assert.equal(face.signupLine, "£0.51 per thousand reached");
    const canvas = readFileSync("components/plan/canvas-adjust.tsx", "utf8");
    assert.match(canvas, /face\.costLabel/);
    assert.match(canvas, /face\.infoHeader/);
  });

  it("adjustFaceView passes the sparkline through", () => {
    const trend = [0.9, 0.7, 0.51];
    const face = adjustFaceView({
      spent: 558,
      planned: 350,
      metaSignups: 1086,
      metaPurchases: null,
      tickets: null,
      ticketSource: "none",
      now: NOW,
      trend,
    });
    assert.deepEqual(face.trend, trend);
    const canvas = readFileSync("components/plan/canvas-adjust.tsx", "utf8");
    assert.match(canvas, /trend=\{face\.trend\}/);
  });

  it("D.O.D usual is the windowed view, lifetime only in the ⓘ", () => {
    const rows: BenchmarkRow[] = [
      row("djez", 1.67),
      row("eed", 1.32),
      row("folamour", 0.82),
      row("ipc", 0.87),
      row("mf", 2.75),
    ];
    const chip = planBenchmark({
      rows,
      clientId: "eb",
      venueKey: "nx newcastle",
      venueLabel: "NX Newcastle",
      unit: "signup",
      excludeEventId: "dod",
    });
    assert.ok(chip);
    const face = adjustFaceView({
      spent: 554,
      planned: 350,
      metaSignups: 1086,
      metaPurchases: null,
      tickets: null,
      ticketSource: "none",
      now: NOW,
      venueName: "NX Newcastle",
      benchmark: chip,
    });
    assert.equal(
      face.signupLine,
      formatUsualFromShows(554 / 1086, "signup", 1.32, "from 5 other shows at NX Newcastle"),
    );
    assert.equal(face.signupLine, "£0.51 per signup · your usual £1.32 — from 5 other shows at NX Newcastle");
    assert.deepEqual(chip.band, [0.87, 1.67]);
    assert.equal(chip.value, 1.32);
    assert.equal(ADJUST_LIFETIME_TIP, "over the whole campaign");
    const canvas = readFileSync("components/plan/canvas-adjust.tsx", "utf8");
    assert.match(canvas, /ADJUST_LIFETIME_TIP/);
    assert.match(canvas, /ADJUST_APPLY_NEXT_CHECK/);
    assert.doesNotMatch(canvas, /tipParts\.join/);
    const source = readFileSync("lib/plan/adjust-face.ts", "utf8");
    assert.doesNotMatch(source, /export function adSetNameFromReason/);
    assert.doesNotMatch(source, /ADJUST_LOG_EMPTY|ADJUST_CREATIVE_STALE/);
  });

  it("D.O.D live walk — stored click is ignored; two readings; signup usual £1.32", () => {
    const rows: BenchmarkRow[] = [
      row("djez", 1.67),
      row("eed", 1.32),
      row("folamour", 0.82),
      row("ipc", 0.87),
      row("mf", 2.75),
    ];
    const chip = planBenchmark({
      rows,
      clientId: "eb",
      venueKey: "nx newcastle",
      venueLabel: "NX Newcastle",
      unit: "signup",
      excludeEventId: "dod",
    });
    assert.ok(chip);
    const face = adjustFaceView({
      spent: 715,
      planned: 350,
      metaSignups: 1222,
      metaPurchases: 0,
      tickets: 0,
      ticketSource: "none",
      now: NOW,
      launchedAt: "2026-08-27T12:00:00.000Z",
      generalSaleAt: "2026-09-04T00:00:00.000+01:00",
      venueName: "NX Newcastle",
      kind: "event",
      targetUnit: "click",
      unitWord: "click",
      benchmark: chip,
      channels: [
        { name: "Meta", spend: 715, results: 1222, connected: true },
        { name: "TikTok", spend: 0, results: null, connected: false },
        { name: "Google", spend: 0, results: null, connected: false },
      ],
      decisions: [
        {
          decidedAt: "2026-09-02T08:00:00.000Z",
          action: "scale_down",
          reasonText: "cpr 1.30",
          resultCount: null,
          applied: true,
          dryRun: false,
          scope: "campaign",
          campaignName: "[NX26-DOD] DOD - Signup - Artist",
          adsetName: null,
          budgetBeforePence: 10000,
          budgetAfterPence: 7500,
          metricValue: 1.3,
          metricWindow: "24h",
        },
        ...Array.from({ length: 12 }, (_, index) => ({
          decidedAt: `2026-09-02T08:0${index % 10}:00.000Z`,
          action: "maintain",
          reasonText: "in band",
          resultCount: 4,
          applied: false,
          dryRun: true,
        })),
      ],
    });
    assert.equal(adjustPrimaryReadingUnit({
      now: NOW,
      generalSaleAt: "2026-09-04T00:00:00.000+01:00",
      launchedAt: "2026-08-27T12:00:00.000Z",
      kind: "event",
    }), "reg");
    assert.equal(face.signupPhaseLabel, ADJUST_PHASE_LABEL);
    assert.equal(
      face.signupLine,
      formatUsualFromShows(715 / 1222, "signup", 1.32, "from 5 other shows at NX Newcastle"),
    );
    assert.equal(
      face.signupLine,
      "£0.59 per signup · your usual £1.32 — from 5 other shows at NX Newcastle",
    );
    assert.doesNotMatch(face.signupLine ?? "", /per click/);
    assert.equal(face.purchaseLine, ADJUST_NO_PURCHASES);
    assert.equal(
      face.purchaseDisagreement,
      "Meta says 0 purchases · tickets not entered yet",
    );
    assert.doesNotMatch(face.purchaseDisagreement ?? "", /tickets 0/);
    assert.equal(face.costLabel, "cost per signup");
    assert.equal(face.infoHeader, "ESTIMATED · META'S SIGNUP COUNT, YOUR SPEND");
    assert.deepEqual(chip.band, [0.87, 1.67]);
    assert.equal(
      face.suggestionSentence,
      'Lower "[NX26-DOD] DOD - Signup - Artist" by 25% — £1.30 per signup, under your usual £1.32, last 24h.',
    );
    assert.doesNotMatch(face.suggestionSentence ?? "", /ad set|0 clicks|per click|£0\.59/);
    const rendered = face.logDays.flatMap((day) =>
      day.rows.map((row) =>
        row.kind === "did"
          ? formatLogDid(row)
          : row.kind === "refusal"
            ? formatRefusal(row.adSetName, row.needed, row.have, row.unitWord)
            : formatLeftAlone(row.count),
      ),
    );
    assert.equal(
      rendered.some(
        (line) =>
          line ===
          `Lowered "[NX26-DOD] DOD - Signup - Artist" by 25% at ${formatDecisionClock("2026-09-02T08:00:00.000Z")}`,
      ),
      true,
    );
    assert.equal(rendered.some((line) => line === "12 ad sets left alone"), true);
    assert.equal(face.channelLines[1], `TikTok · ${ADJUST_CHANNEL_NOT_CONNECTED}`);
    assert.equal(face.channelLines[2], `Google · ${ADJUST_CHANNEL_NOT_CONNECTED}`);
  });
});

function row(event_id: string, cost: number): BenchmarkRow {
  return {
    client_id: "eb",
    venue_key: "nx newcastle",
    event_id,
    event_code: event_id,
    event_date: "2026-10-02",
    unit: "signup",
    channel: "meta",
    cost,
  };
}
