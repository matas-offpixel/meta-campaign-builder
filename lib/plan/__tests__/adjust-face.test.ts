import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { formatPaceSentence } from "../../viz/pace.ts";
import { VIZ_CLIENT_SAFE, VIZ_LOCKED_CLIENT_CREATIVE, VIZ_TICKET_LINE_WORD } from "../../viz/tokens.ts";
import {
  ADJUST_LOG_EMPTY,
  ADJUST_LOG_TITLE,
  ADJUST_NO_READS,
  ADJUST_NO_USUAL,
  ADJUST_PHASE_LABEL,
  ADJUST_PLACEMENT_EMPTY,
  ADJUST_CREATIVE_STALE,
  adjustControlsVisible,
  formatAgainstUsual,
  formatChannelEarnedNothing,
  formatCreativeLocked,
  formatLeftAlone,
  formatLogDid,
  formatMetaSays,
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
} from "../adjust-face.ts";

describe("ADJUST J-states — sentences", () => {
  it("J1 day 0 — no reads and empty log", () => {
    assert.equal(ADJUST_NO_READS, "no reads yet — Meta's first day arrives at 08:00 tomorrow");
    assert.equal(ADJUST_LOG_EMPTY, "nothing yet — the first check is at 13:00");
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
    assert.equal(ADJUST_NO_USUAL, "no usual yet — opens after your first finished NX show");
  });

  it("J8 two-source lines never merge; gap is unsigned", () => {
    assert.equal(
      formatPurchaseDisagreement({ metaPurchases: 74, tickets: 558 }),
      "Meta says 74 purchases · tickets 558 · Meta counts 484 fewer",
    );
    assert.equal(
      formatPurchaseDisagreement({ metaPurchases: 2656, tickets: 558 }),
      "Meta says 2,656 purchases · tickets 558 · Meta counts 2,098 more",
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
    assert.equal(formatCreativeLocked("operator"), ADJUST_CREATIVE_STALE);
    assert.equal(formatCreativeLocked("client"), VIZ_CLIENT_SAFE(ADJUST_CREATIVE_STALE));
    assert.equal(VIZ_LOCKED_CLIENT_CREATIVE, "not measured yet — creative results are scored after your first finished show");
    assert.doesNotMatch(VIZ_CLIENT_SAFE("creative_scores table and ENABLE_AI_AUTOTAG"), /table|ENABLE_/i);
  });

  it("placements not-yet; tickets source not recorded", () => {
    assert.equal(ADJUST_PLACEMENT_EMPTY, "instagram · — · not read yet");
    assert.equal(VIZ_TICKET_LINE_WORD.unknown, "source not recorded");
    assert.match(formatTicketLine("none"), /not entered yet/);
    assert.equal(formatTicketLine("unknown", 553), "553 tickets · source not recorded");
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
          reasonText: 'Ad set "Disco Pages" below minimum',
          resultCount: 3,
          applied: false,
          dryRun: true,
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
    assert.match(source, /ADJUST_PHASE_LABEL/);
    assert.match(source, /ADJUST_PLACEMENT_EMPTY/);
    assert.match(source, /formatCreativeLocked\(role\)/);
    assert.match(source, /adjustControlsVisible/);
  });

  it("workspace mounts ADJUST as the live morning read", () => {
    const source = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(source, /CanvasAdjust/);
    assert.match(source, /state === "live" \|\| state === "launched"/);
    assert.match(source, /stages=\{undefined\}/);
  });
});
