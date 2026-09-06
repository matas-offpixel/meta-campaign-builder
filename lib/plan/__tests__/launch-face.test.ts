import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { EMPTY_IDENTITY_NAMES } from "../identity-chips.ts";
import { VIZ_STATE_WORD, VIZ_TICKET_LINE_WORD } from "../../viz/tokens.ts";
import {
  LAUNCH_INFO_VARIANT,
  decisionsChangesLabel,
  formatChannelNeedsYou,
  formatHistoryEmpty,
  formatIdentitySentence,
  formatIdentityTip,
  formatLaunchBlockerSentence,
  formatLaunchCreatesLine,
  formatLaunchedLine,
  formatMissingMomentTip,
  formatPurchaseTicketLine,
  formatResumeWord,
  formatSkippedShare,
  formatStartingPoint,
  formatTargetFromShows,
  identityAccountLabel,
  launchChannelStateWord,
  launchReadingUnit,
  readyLaunchAdapters,
} from "../launch-face.ts";

describe("LAUNCH identity sentence", () => {
  it("resolved name is verbatim", () => {
    const names = {
      ...EMPTY_IDENTITY_NAMES,
      metaAdAccount: { "1073273492854557": "ELECTRIC STUDIOS SHEFFIELD" },
    };
    assert.equal(
      formatIdentitySentence({
        metaId: "1073273492854557",
        metaConnected: true,
        tiktokConnected: false,
        googleConnected: false,
        names,
      }),
      "Running as ELECTRIC STUDIOS SHEFFIELD on Meta · TikTok account not connected — connect · Google account not connected — connect",
    );
  });

  it("unresolved name renders the id", () => {
    assert.equal(
      identityAccountLabel("1073273492854557", EMPTY_IDENTITY_NAMES),
      "act_1073273492854557",
    );
    assert.match(
      formatIdentitySentence({
        metaId: "act_1967530076312",
        metaConnected: true,
        tiktokConnected: true,
        googleConnected: true,
        names: EMPTY_IDENTITY_NAMES,
      }),
      /^Running as act_1967530076312 on Meta$/,
    );
  });

  it("ⓘ shows both accounts when the event's own id differs (G30)", () => {
    const tip = formatIdentityTip({
      metaId: "1073273492854557",
      eventMetaAdAccountId: "606252931141334",
      destinationUrl: "https://dod-newcastle.com",
      clientName: "Electric Brixton",
    });
    assert.match(tip, /Electric Brixton/);
    assert.match(tip, /1073273492854557/);
    assert.match(tip, /606252931141334/);
    assert.match(tip, /dod-newcastle\.com/);
  });
});

describe("LAUNCH unit by phase", () => {
  const gen = "2026-09-04T13:00:00.000Z";
  it("signup before general sale, purchase after, thousand reached when kind ≠ event", () => {
    assert.equal(
      launchReadingUnit({ now: new Date("2026-09-03T12:00:00.000Z"), generalSaleAt: gen }),
      "reg",
    );
    assert.equal(
      launchReadingUnit({ now: new Date("2026-09-04T13:00:00.000Z"), generalSaleAt: gen }),
      "purchase",
    );
    assert.equal(
      launchReadingUnit({ now: new Date("2026-09-05T12:00:00.000Z"), generalSaleAt: gen }),
      "purchase",
    );
    assert.equal(
      launchReadingUnit({ now: new Date("2026-09-03T12:00:00.000Z"), kind: "brand" }),
      "view",
    );
  });
});

describe("LAUNCH target rungs", () => {
  it("n = 0 is Off Pixel's starting point, dashed, no band", () => {
    assert.equal(formatStartingPoint("reg"), "£1.60 per signup · Off Pixel's starting point");
    assert.equal(formatTargetFromShows(0, "NX"), "£1.60 per signup · Off Pixel's starting point");
  });

  it("n = 1 is from 1 other show, no band", () => {
    assert.equal(formatTargetFromShows(1, "NX"), "from 1 other show at NX");
  });

  it("n ≥ 3 is from N other shows at the venue", () => {
    assert.equal(formatTargetFromShows(5, "NX"), "from 5 other shows at NX");
  });
});

describe("LAUNCH split / channels / button", () => {
  it("history: null uses the empty sentence", () => {
    assert.equal(
      formatHistoryEmpty("tiktok", "Junction 2"),
      "no TikTok history yet for Junction 2 — opens after your first TikTok run",
    );
  });

  it("0% is skipped", () => {
    assert.equal(formatSkippedShare(0), "0% of the budget — skipped");
  });

  it("each channel state word", () => {
    assert.equal(
      launchChannelStateWord({ skipped: false, waiting: false, blockerCount: 0, status: "idle" }),
      VIZ_STATE_WORD.ready,
    );
    assert.equal(
      launchChannelStateWord({ skipped: false, waiting: false, blockerCount: 6, status: "idle" }),
      VIZ_STATE_WORD.needsYou,
    );
    assert.equal(
      formatChannelNeedsYou(6, "TikTok"),
      "6 things to fix before TikTok can run →",
    );
    assert.equal(
      launchChannelStateWord({ skipped: false, waiting: true, blockerCount: 0, status: "idle" }),
      "waiting for Meta",
    );
    assert.equal(
      launchChannelStateWord({ skipped: false, waiting: false, blockerCount: 0, status: "live" }),
      VIZ_STATE_WORD.running,
    );
    assert.equal(
      launchChannelStateWord({ skipped: false, waiting: false, blockerCount: 0, status: "paused" }),
      VIZ_STATE_WORD.paused,
    );
  });

  it("button line for 1 / 2 / 3 ready channels and each blocker", () => {
    assert.equal(formatLaunchCreatesLine(["meta"]), "creates 1 campaign, paused, on Meta");
    assert.equal(
      formatLaunchCreatesLine(["meta", "tiktok"]),
      "creates 2 campaigns, paused, on Meta · TikTok",
    );
    assert.equal(
      formatLaunchCreatesLine(["meta", "tiktok", "google"]),
      "creates 3 campaigns, paused, on Meta · TikTok · Google",
    );
    assert.deepEqual(
      readyLaunchAdapters([
        { adapter: "meta", skipped: false, waiting: false, blockers: [], status: "idle" },
        { adapter: "tiktok", skipped: true, waiting: false, blockers: [], status: "idle" },
        { adapter: "google", skipped: false, waiting: false, blockers: [{ kind: "blocker" }], status: "idle" },
      ]),
      ["meta"],
    );
    assert.equal(
      formatLaunchBlockerSentence({ windowOk: false, blockerCount: 0 }),
      "set start and end",
    );
    assert.equal(
      formatLaunchBlockerSentence({
        windowOk: true,
        blockerCount: 0,
        unconnected: "TikTok has 29% of the budget but no account — connect, or set TikTok to 0",
      }),
      "TikTok has 29% of the budget but no account — connect, or set TikTok to 0",
    );
    assert.equal(
      formatLaunchBlockerSentence({ windowOk: true, blockerCount: 6 }),
      "6 things to fix before you can launch",
    );
  });

  it("A15 resume words per platform", () => {
    assert.equal(formatResumeWord("meta"), "resume ▷");
    assert.equal(formatResumeWord("tiktok"), "resume in TikTok Ads Manager ↗");
    assert.equal(formatResumeWord("google"), "resume in Google Ads ↗");
  });

  it("A6 missing-moment tick", () => {
    assert.equal(formatMissingMomentTip(), "not set on the event");
  });

  it("purchase unit is two lines including source not recorded", () => {
    assert.match(formatPurchaseTicketLine("none"), /not entered yet/);
    assert.equal(VIZ_TICKET_LINE_WORD.unknown, "source not recorded");
  });
});

describe("LAUNCH chrome", () => {
  it("◐ 40 ▸ becomes 40 changes ▸; A15 launched line uses formatVizDay", () => {
    assert.equal(decisionsChangesLabel(40), "40 changes ▸");
    assert.equal(decisionsChangesLabel(0), null);
    assert.equal(formatLaunchedLine("2026-07-24T09:14:00.000Z"), "paused · launched Fri 24 Jul · 10:14");
  });

  it("daily canvas ⓘ is the card form; identity chips leave the header", () => {
    const header = readFileSync("components/plan/canvas-header.tsx", "utf8");
    const budget = readFileSync("components/plan/canvas-budget.tsx", "utf8");
    const target = readFileSync("components/plan/canvas-target.tsx", "utf8");
    const launch = readFileSync("components/plan/canvas-launch.tsx", "utf8");
    const channels = readFileSync("components/plan/canvas-channels.tsx", "utf8");
    const windowBar = readFileSync("components/viz/window-bar.tsx", "utf8");
    assert.doesNotMatch(header, /PlanIdentityChips/);
    assert.match(header, /venueName/);
    assert.match(header, /formatIdentitySentence/);
    assert.match(header, /decisionsChangesLabel|changes ▸/);
    for (const source of [header, budget, target, launch, channels, windowBar]) {
      assert.match(source, /variant=\{?["']card["']\}?|LAUNCH_INFO_VARIANT/);
    }
    assert.equal(LAUNCH_INFO_VARIANT, "card");
  });

  it("client role hides the Launch button only", () => {
    const launch = readFileSync("components/plan/canvas-launch.tsx", "utf8");
    assert.match(launch, /role\s*[:=]\s*["']client["']|role === "client"|role !== "client"/);
    assert.match(launch, /formatLaunchCreatesLine|creates/);
  });
});
