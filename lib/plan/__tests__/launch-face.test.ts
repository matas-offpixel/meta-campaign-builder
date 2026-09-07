import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { EMPTY_IDENTITY_NAMES } from "../identity-chips.ts";
import { VIZ_STATE_WORD, VIZ_TICKET_LINE_WORD } from "../../viz/tokens.ts";
import { IDLE_PLAN_LAUNCH } from "../types.ts";
import {
  LAUNCH_INFO_VARIANT,
  decisionsChangesLabel,
  formatChannelNeedsYou,
  formatHistoryEmpty,
  formatIdentitySentence,
  formatIdentityTip,
  planIdentityMetaId,
  formatLaunchBlockerSentence,
  formatLaunchCreatesLine,
  formatLaunchStampTip,
  formatLaunchedLine,
  LAUNCH_STAMP_PLAN_START_TIP,
  formatMissingMomentTip,
  formatPurchaseTicketLine,
  formatResumeWord,
  formatRunningFact,
  formatSkippedShare,
  formatStartingPoint,
  formatTargetFromShows,
  formatTicketsAt,
  identityAccountLabel,
  launchBlockedLine,
  launchBlockers,
  launchControlsVisible,
  launchChannelRunning,
  launchChannelRowView,
  launchChannelStateWord,
  launchReadingUnit,
  launchTargetInfoHeader,
  launchTargetView,
  LAUNCH_NO_READS,
  planLaunchStamp,
  planLaunchedAt,
  readyLaunchAdapters,
} from "../launch-face.ts";
import { planBenchmark, type BenchmarkRow } from "../benchmarks.ts";
import { formatChannelFacts } from "../../viz/channel-row.ts";
import {
  collectPlanPreflightBlockers,
  planPreflightBlockerCount,
  planPreflightBlockerCounts,
  type PlanPreflightIssue,
} from "../preflight.ts";
import { drawerFixFromPreflight } from "../list.ts";

function nxRow(
  event_id: string,
  event_code: string,
  event_date: string,
  cost: number,
): BenchmarkRow {
  return {
    client_id: "eb",
    venue_key: "nx newcastle",
    event_id,
    event_code,
    event_date,
    unit: "signup",
    channel: "meta",
    cost,
  };
}

const NX_WINDOWED_ROWS: BenchmarkRow[] = [
  nxRow("djez", "NX26-DJEZ", "2026-10-02", 1.67),
  nxRow("eed", "NX26-EED", "2026-11-13", 1.32),
  nxRow("folamour", "NX26-FOLAMOUR", "2026-10-23", 0.82),
  nxRow("ipc", "NX26-IPC", "2026-11-21", 0.87),
  nxRow("mf", "NX26-MF", "2026-10-16", 2.75),
];

const DOD_ROLLUP = {
  date: "2026-09-05",
  ad_spend: 554,
  meta_regs: 1086,
  meta_purchases: 0,
  meta_reach: 0,
  tiktok_spend: 0,
  tiktok_results: 0,
  google_ads_spend: 0,
  google_ads_conversions: 0,
};

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

  it("launched D.O.D names the draft account, not the client default (G30)", () => {
    const launchedMeta = {
      ...IDLE_PLAN_LAUNCH,
      status: "live" as const,
      platformCampaignId: "120251576269510755",
      draftId: "draft-dod",
      platformAdAccountId: "act_606252931141334",
    };
    const metaId = planIdentityMetaId({
      launchedMeta,
      resolvedMetaId: "act_1073273492854557",
    });
    assert.equal(
      formatIdentitySentence({
        metaId,
        metaConnected: true,
        tiktokConnected: true,
        googleConnected: true,
        names: EMPTY_IDENTITY_NAMES,
      }),
      "Running as act_606252931141334 on Meta",
    );
    assert.equal(
      formatIdentitySentence({
        metaId,
        metaConnected: true,
        tiktokConnected: true,
        googleConnected: true,
        names: {
          ...EMPTY_IDENTITY_NAMES,
          metaAdAccount: { "606252931141334": "NX Promoter" },
        },
      }),
      "Running as NX Promoter on Meta",
    );
    const tip = formatIdentityTip({
      metaId,
      clientDefaultMetaId: "1073273492854557",
      destinationUrl: "https://dod-newcastle.com",
      clientName: "Electric Brixton",
    });
    assert.match(tip, /Electric Brixton/);
    assert.match(tip, /act_606252931141334/);
    assert.match(tip, /client default act_1073273492854557/);
    assert.match(tip, /tickets at dod-newcastle\.com/);
    assert.doesNotMatch(tip, /https:\/\//);
    assert.equal(formatTicketsAt("https://dod-newcastle.com/"), "tickets at dod-newcastle.com");
  });

  it("launched with a null ledger falls back to the linked draft, never the resolver (D.O.D)", () => {
    const launchedMeta = {
      ...IDLE_PLAN_LAUNCH,
      status: "live" as const,
      platformCampaignId: "120251576269510755",
      draftId: "645ed600-0000-4000-8000-000000000000",
      platformAdAccountId: null,
    };
    const metaId = planIdentityMetaId({
      launchedMeta,
      draftAdAccountId: "act_606252931141334",
      resolvedMetaId: "act_1073273492854557",
    });
    assert.equal(metaId, "act_606252931141334");
    assert.equal(
      planIdentityMetaId({
        launchedMeta,
        draftAdAccountId: null,
        resolvedMetaId: "act_1073273492854557",
      }),
      null,
    );
  });

  it("draft plan identity is the resolver id; ⓘ names the other client default", () => {
    const metaId = planIdentityMetaId({
      launchedMeta: IDLE_PLAN_LAUNCH,
      resolvedMetaId: "act_606252931141334",
    });
    assert.equal(
      formatIdentitySentence({
        metaId,
        metaConnected: true,
        tiktokConnected: true,
        googleConnected: true,
        names: EMPTY_IDENTITY_NAMES,
      }),
      "Running as act_606252931141334 on Meta",
    );
    assert.match(
      formatIdentityTip({
        metaId,
        clientDefaultMetaId: "1073273492854557",
      }),
      /client default act_1073273492854557/,
    );
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
    assert.equal(
      launchReadingUnit({
        now: new Date("2026-09-03T12:00:00.000Z"),
        generalSaleAt: gen,
        presaleAt: "2026-09-01T10:00:00.000Z",
      }),
      "purchase",
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
    assert.equal(formatSkippedShare(0, "google"), "Google · 0% of the budget — skipped");
  });

  it("reads: undefined renders no state word", () => {
    const view = launchChannelRowView({
      reads: undefined,
      skipped: false,
      waiting: false,
      blockerCount: 0,
      status: "idle",
      adapter: "tiktok",
    });
    assert.equal(view.pending, true);
    assert.equal(view.stateWord, null);
    assert.equal(view.runningFact, null);
    const channels = readFileSync("components/plan/canvas-channels.tsx", "utf8");
    assert.match(channels, /readsPending \? \{ reads: undefined \}/);
    assert.match(channels, /data-pending=\{true\}/);
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(workspace, /readsPending=\{readsPending\}/);
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
    assert.equal(
      formatLaunchedLine("2026-07-24T09:14:00.000Z", "paused"),
      "paused · launched Fri 24 Jul · 10:14",
    );
    assert.equal(
      formatLaunchedLine("2026-09-05T09:14:00.000Z", "live"),
      "live · launched Sat 5 Sep · 10:14",
    );
  });

  it("daily canvas ⓘ is the card form; identity chips leave the header", () => {
    const header = readFileSync("components/plan/canvas-header.tsx", "utf8");
    const budget = readFileSync("components/plan/canvas-budget.tsx", "utf8");
    const target = readFileSync("components/plan/canvas-target.tsx", "utf8");
    const launch = readFileSync("components/plan/canvas-launch.tsx", "utf8");
    const row = readFileSync("components/viz/channel-row.tsx", "utf8");
    const windowBar = readFileSync("components/viz/window-bar.tsx", "utf8");
    assert.doesNotMatch(header, /PlanIdentityChips/);
    assert.match(header, /venueName/);
    assert.match(header, /formatIdentitySentence/);
    assert.match(header, /decisionsChangesLabel|changes ▸/);
    for (const source of [header, budget, target, launch, row, windowBar]) {
      assert.match(source, /variant=\{?["']card["']\}?|LAUNCH_INFO_VARIANT/);
    }
    assert.equal(LAUNCH_INFO_VARIANT, "card");
  });

  it("client role hides the Launch button only", () => {
    assert.deepEqual(launchControlsVisible("client"), {
      launch: false,
      unitPicker: false,
      drawerEdit: false,
    });
    assert.deepEqual(launchControlsVisible("operator"), {
      launch: true,
      unitPicker: true,
      drawerEdit: true,
    });
    const launch = readFileSync("components/plan/canvas-launch.tsx", "utf8");
    assert.match(launch, /launchControlsVisible/);
    assert.match(launch, /formatLaunchCreatesLine|creates/);
  });
});

describe("LAUNCH review round 1 — surface wiring", () => {
  it("target view is one source: n = 0 starting point, never a preset, unit word matches", () => {
    assert.equal(
      planBenchmark({
        rows: [],
        clientId: "eb",
        venueKey: "nx newcastle",
        venueLabel: "NX Newcastle",
        unit: "signup",
      }),
      undefined,
    );
    const view = launchTargetView({
      now: new Date("2026-09-03T12:00:00.000Z"),
      generalSaleAt: "2026-09-04T13:00:00.000Z",
      venueName: "NX Newcastle",
    });
    assert.equal(view.unit, "reg");
    assert.equal(view.unitWord, "signup");
    assert.equal(view.chipValue, 1.6);
    assert.equal(view.evidence, "£1.60 per signup · Off Pixel's starting point");
    assert.equal(view.lineKind, "estimated");
    assert.equal(view.benchmark, undefined);
    assert.equal(view.showComputedToday, false);
    assert.doesNotMatch(view.evidence, /this venue/);
    const target = readFileSync("components/plan/canvas-target.tsx", "utf8");
    assert.match(target, /launchTargetView/);
    assert.match(target, /view\.evidence/);
    assert.match(target, /per \{view\.unitWord\}/);
    assert.doesNotMatch(target, /historyN/);
    assert.doesNotMatch(target, /this venue/);
  });

  it("presale earlier than general sale flips the phase unit and mounts the tickets line", () => {
    const view = launchTargetView({
      now: new Date("2026-09-03T12:00:00.000Z"),
      generalSaleAt: "2026-09-04T13:00:00.000Z",
      presaleAt: "2026-09-01T10:00:00.000Z",
    });
    assert.equal(view.unit, "purchase");
    assert.equal(view.unitWord, "purchase");
    assert.equal(view.infoHeader, "ESTIMATED · META'S PURCHASE COUNT, YOUR SPEND");
    assert.match(view.purchaseLine!, /not entered yet/);
    assert.equal(
      launchTargetInfoHeader("view"),
      "ESTIMATED · META'S REACH, YOUR SPEND",
    );
    const target = readFileSync("components/plan/canvas-target.tsx", "utf8");
    assert.match(target, /presaleAt/);
    assert.match(target, /view\.purchaseLine/);
    assert.match(target, /onUnit/);
    assert.match(target, /<details/);
  });

  it("needs you counts blockers only; running fact is cost per reading unit", () => {
    assert.deepEqual(
      launchBlockers([
        { kind: "blocker" },
        { kind: "advisory" },
        { kind: "blocker" },
      ]),
      [{ kind: "blocker" }, { kind: "blocker" }],
    );
    assert.equal(formatRunningFact({ cost: 0.51, unit: "reg" }), "£0.51 per signup");
    assert.equal(
      formatRunningFact({ cost: 0.51, unit: "reg", usual: 1.32 }),
      "£0.51 per signup · under your usual £1.32",
    );
    const running = launchChannelRunning([DOD_ROLLUP], "reg", 1.32);
    const dodWalk = launchChannelRunning(
      [
        {
          date: "2026-09-05",
          ad_spend: 715,
          meta_regs: 1222,
          meta_purchases: 0,
          meta_reach: 0,
          tiktok_spend: 0,
          tiktok_results: 0,
          google_ads_spend: 0,
          google_ads_conversions: 0,
        },
      ],
      "reg",
      1.32,
    );
    assert.equal(
      formatRunningFact({
        cost: dodWalk.byAdapter.meta!.cost,
        unit: "reg",
        usual: 1.32,
      }),
      "£0.59 per signup · under your usual £1.32",
    );
    assert.equal(launchChannelRunning([DOD_ROLLUP], "purchase").byAdapter.meta, null);
    assert.equal(running.empty, false);
    assert.ok(running.byAdapter.meta);
    assert.equal(
      formatRunningFact({
        cost: running.byAdapter.meta!.cost,
        unit: "reg",
        usual: 1.32,
      }),
      "£0.51 per signup · under your usual £1.32",
    );
    assert.equal(launchChannelRunning([], "reg").empty, true);
    assert.equal(LAUNCH_NO_READS, "no reads yet");
    const channels = readFileSync("components/plan/canvas-channels.tsx", "utf8");
    assert.match(channels, /launchBlockers/);
    assert.match(channels, /launchChannelRowView/);
    assert.match(channels, /formatChannelNeedsYou/);
    assert.doesNotMatch(channels, /BlockerBadge/);
    assert.doesNotMatch(channels, /StatusDot/);
    assert.match(channels, /blockerCounts\?\.\[row\.adapter\]/);
    assert.doesNotMatch(channels, /cost per mille|cost per click/);
    assert.doesNotMatch(channels, /platformSplit/);
    const face = readFileSync("lib/plan/launch-face.ts", "utf8");
    assert.match(face, /LAUNCH_NO_READS/);
    assert.match(face, /stateWord\} · \$\{formatRunningFact/);
  });

  it("header launched stamp ignores idle prepare-draft rows", () => {
    assert.equal(
      planLaunchedAt({
        meta: { ...IDLE_PLAN_LAUNCH, createdAt: "2026-07-24T09:14:00.000Z" },
        tiktok: { ...IDLE_PLAN_LAUNCH },
        google: { ...IDLE_PLAN_LAUNCH },
      }),
      null,
    );
    assert.equal(
      planLaunchedAt({
        meta: {
          ...IDLE_PLAN_LAUNCH,
          status: "live",
          platformCampaignId: "120",
          createdAt: "2026-08-26T13:51:00.000Z",
        },
        tiktok: { ...IDLE_PLAN_LAUNCH },
        google: { ...IDLE_PLAN_LAUNCH },
      }),
      null,
    );
    const live = planLaunchStamp({
      meta: {
        ...IDLE_PLAN_LAUNCH,
        status: "live",
        platformCampaignId: "120",
        launchedAt: "2026-09-05T09:14:00.000Z",
        launchedAtSource: "ledger",
      },
      tiktok: { ...IDLE_PLAN_LAUNCH },
      google: { ...IDLE_PLAN_LAUNCH },
    });
    assert.equal(live?.at, "2026-09-05T09:14:00.000Z");
    assert.equal(live?.word, "live");
    assert.equal(live?.source, "ledger");
    assert.equal(
      formatLaunchedLine(live!.at!, live!.word),
      "live · launched Sat 5 Sep · 10:14",
    );
    assert.equal(formatLaunchStampTip(live?.source), null);
    const backfilled = planLaunchStamp({
      meta: {
        ...IDLE_PLAN_LAUNCH,
        status: "live",
        platformCampaignId: "120",
        launchedAt: "2026-08-26T13:51:00.000Z",
        launchedAtSource: "plan_start",
      },
      tiktok: { ...IDLE_PLAN_LAUNCH },
      google: { ...IDLE_PLAN_LAUNCH },
    });
    assert.equal(backfilled?.source, "plan_start");
    assert.equal(formatLaunchStampTip(backfilled?.source), LAUNCH_STAMP_PLAN_START_TIP);
    const stampFn = readFileSync("lib/plan/launch-face.ts", "utf8");
    assert.match(stampFn, /row\.launchedAt/);
    assert.doesNotMatch(stampFn, /planLaunchStamp[\s\S]*row\.createdAt/);
    const header = readFileSync("components/plan/canvas-header.tsx", "utf8");
    assert.match(header, /formatLaunchStampTip/);
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(workspace, /planLaunchStamp\(plan\.launches\)/);
    assert.doesNotMatch(workspace, /launchedAt=\{plan\.createdAt\}/);
  });

  it("unit override wins on a draft and locks once launched", () => {
    const view = launchTargetView({
      now: new Date("2026-09-03T12:00:00.000Z"),
      generalSaleAt: "2026-09-04T13:00:00.000Z",
      unit: "purchase",
    });
    assert.equal(view.unit, "purchase");
    assert.equal(view.unitWord, "purchase");
    const target = readFileSync("components/plan/canvas-target.tsx", "utf8");
    assert.match(target, /unit,/);
    assert.match(target, /disabled=\{launched\}/);
  });

  it("A2 is a line without a band; A4 is the view band with the target as marker", () => {
    const a2 = launchTargetView({
      now: new Date("2026-09-03T12:00:00.000Z"),
      generalSaleAt: "2026-09-04T13:00:00.000Z",
      venueName: "NX Newcastle",
      venueKey: "nx newcastle",
      clientId: "eb",
      excludeEventId: "dod",
      benchmarkRows: [NX_WINDOWED_ROWS[1]!],
    });
    assert.equal(a2.benchmark?.n, 1);
    assert.equal(a2.benchmark?.band, undefined);
    assert.equal(a2.lineKind, "estimated");
    assert.equal(a2.evidence, "from 1 other show at NX Newcastle");

    const a4 = launchTargetView({
      now: new Date("2026-09-03T12:00:00.000Z"),
      generalSaleAt: "2026-09-04T13:00:00.000Z",
      venueName: "NX Newcastle",
      venueKey: "nx newcastle",
      clientId: "eb",
      excludeEventId: "dod",
      operatorTarget: 0.51,
      benchmarkRows: NX_WINDOWED_ROWS,
    });
    assert.equal(a4.benchmark?.n, 5);
    assert.equal(a4.benchmark?.value, 1.32);
    assert.deepEqual(a4.benchmark?.band, [0.87, 1.67]);
    assert.equal(a4.chipValue, 0.51);
    assert.equal(a4.lineKind, "measured");
    const chip = readFileSync("components/viz/metric-chip.tsx", "utf8");
    assert.match(chip, /marker=\{value \?\? benchmark\.value\}/);
  });

  it("header identity is planIdentityMetaId; ⓘ names the client default", () => {
    const header = readFileSync("components/plan/canvas-header.tsx", "utf8");
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    const page = readFileSync("app/(dashboard)/plan/[id]/page.tsx", "utf8");
    assert.match(header, /planIdentityMetaId/);
    assert.match(header, /draftAdAccountId: launchedMeta.draftAdAccountId/);
    assert.match(header, /formatIdentitySentence/);
    assert.match(workspace, /draftAdAccountId: plan.launches.meta.draftAdAccountId/);
    assert.match(workspace, /clientDefaultMetaId=\{selectedEvent\?\.metaAdAccountId/);
    const load = readFileSync("lib/plan/load.ts", "utf8");
    assert.match(load, /from\("campaign_drafts"\)/);
    assert.match(load, /draft_json/);
    assert.match(load, /settings\?\.adAccountId/);
    assert.match(page, /loadDraftAdAccountId/);
    assert.match(page, /eventMetaAdAccountId: event\.meta_ad_account_id/);
    const tip = formatIdentityTip({
      metaId: "act_606252931141334",
      clientDefaultMetaId: "1073273492854557",
    });
    assert.match(tip, /client default act_1073273492854557/);
  });

  it("usual outline is the client preset; skip and history name the channel", () => {
    const budget = readFileSync("components/plan/canvas-budget.tsx", "utf8");
    assert.match(budget, /usual: \{[\s\S]*PLAN_SPLIT_PRESETS\[1\]/);
    assert.match(budget, /formatHistoryEmpty\("tiktok"/);
    assert.match(budget, /formatHistoryEmpty\("google"/);
    assert.match(budget, /formatSkippedShare\(0, segment\.platform\)/);
    assert.equal(
      formatHistoryEmpty("google", "Junction 2"),
      "no Google history yet for Junction 2 — opens after your first Google run",
    );
  });

  it("blocked line is derived from the issue list, never a string sniff", () => {
    assert.equal(
      launchBlockedLine({
        hasEvent: false,
        busy: false,
        windowOk: true,
        issues: [],
        blockerCount: 0,
      }),
      "choose an event",
    );
    assert.equal(
      launchBlockedLine({
        hasEvent: true,
        busy: true,
        windowOk: true,
        issues: [],
        blockerCount: 0,
      }),
      "launch in progress",
    );
    assert.equal(
      launchBlockedLine({
        hasEvent: true,
        busy: false,
        windowOk: true,
        issues: [
          {
            adapter: "tiktok",
            id: "plan:unconnected_share",
            field: "account",
            message: "TikTok has 29% of the budget but no account — connect, or set TikTok to 0",
            blocking: true,
          },
        ],
        blockerCount: 0,
      }),
      "TikTok has 29% of the budget but no account — connect, or set TikTok to 0",
    );
    const launch = readFileSync("components/plan/canvas-launch.tsx", "utf8");
    assert.doesNotMatch(launch, /includes\(["']no account["']\)/);
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(workspace, /launchBlockedLine/);
  });

  it("ⓘ uses the ratified derive sentence; Ads Manager reason stays on the handle", () => {
    const canvas = readFileSync("lib/plan/canvas.ts", "utf8");
    assert.match(canvas, /start from your Meta campaign ↻/);
    assert.doesNotMatch(canvas, /Preflight still has blockers/);
    assert.doesNotMatch(canvas, /derived from the Meta draft, never authored first/);
    const channels = readFileSync("components/plan/canvas-channels.tsx", "utf8");
    assert.doesNotMatch(channels, /resumeTips/);
    assert.match(channels, /title=\{PLAN_CANVAS_COPY\.resumeElsewhere\}/);
    assert.doesNotMatch(channels, /SectionAnchor|kind="derive"/);
    assert.match(channels, /PLAN_CANVAS_COPY\.derive/);
    const row = readFileSync("components/viz/channel-row.tsx", "utf8");
    assert.match(row, /<InfoTip variant="card" label=\{tip\}/);
  });

  it("waiting is one spelling", () => {
    const row = readFileSync("lib/viz/channel-row.ts", "utf8");
    assert.match(row, /waiting for Meta/);
    assert.doesNotMatch(row, /waiting for \$\{glyph\}/);
    const channels = readFileSync("components/plan/canvas-channels.tsx", "utf8");
    assert.match(channels, /hideWaitingText/);
  });

  it("list fold, channel row and launch button share one preflight count, split per adapter", () => {
    const issues: PlanPreflightIssue[] = [
      { adapter: "meta", id: "meta:page", field: "page", message: "page", blocking: true },
      { adapter: "meta", id: "meta:pixel", field: "pixel", message: "pixel", blocking: true },
      { adapter: "google", id: "google:keywords", field: "keywords", message: "kw", blocking: false },
    ];
    const counts = planPreflightBlockerCounts(issues);
    const total = planPreflightBlockerCount(issues);
    assert.deepEqual(counts, { meta: 2, tiktok: 0, google: 0 });
    assert.equal(total, counts.meta + counts.tiktok + counts.google);
    assert.equal(collectPlanPreflightBlockers(issues).length, total);
    assert.equal(drawerFixFromPreflight(issues)?.count, total);
    assert.equal(
      formatChannelNeedsYou(counts.meta, "Meta"),
      "2 things to fix before Meta can run →",
    );
    assert.equal(
      launchChannelStateWord({
        skipped: false,
        waiting: false,
        blockerCount: counts.tiktok,
        status: "idle",
      }),
      VIZ_STATE_WORD.ready,
    );
    assert.equal(
      launchChannelStateWord({
        skipped: true,
        waiting: false,
        blockerCount: counts.google,
        status: "idle",
      }),
      VIZ_STATE_WORD.ready,
    );
    assert.equal(
      formatLaunchBlockerSentence({ windowOk: true, blockerCount: total }),
      "2 things to fix before you can launch",
    );
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(workspace, /blockerCounts=\{planPreflightBlockerCounts\(issues\)\}/);
    assert.match(workspace, /blockerCount: planPreflightBlockerCount\(issues\)/);
    assert.match(workspace, /launchChannelRunning\(rollupDays, channelReadingUnit, usual\)/);
    assert.match(workspace, /channelReadingUnit = launchStamp \? adjustPhaseUnit : readingUnit/);
    const channels = readFileSync("components/plan/canvas-channels.tsx", "utf8");
    assert.doesNotMatch(channels, /sharedBlockerCount/);
  });

  it("row facts singularise by count", () => {
    assert.equal(
      formatChannelFacts([
        { n: 0, noun: "audiences" },
        { n: 1, noun: "creatives" },
        { n: 1, noun: "ad sets" },
      ]),
      "0 audiences · 1 creative · 1 ad set",
    );
  });

  it("header is the event name; tickets at lives in the ⓘ; dest edit is in details", () => {
    const header = readFileSync("components/plan/canvas-header.tsx", "utf8");
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(workspace, /planHeaderName\(plan\.name, selectedEvent\)/);
    assert.match(workspace, /planTitle=\{plan\.name\}/);
    assert.match(header, /planTitle/);
    assert.match(header, /formatTicketsAt|tickets at|destinationUrl/);
    assert.match(header, /<details/);
    assert.doesNotMatch(header, /SegmentedControl/);
  });

  it("budget chrome is words, not a pill; target edit lives under ▸ details", () => {
    const budget = readFileSync("components/plan/canvas-budget.tsx", "utf8");
    assert.match(budget, /per day/);
    assert.match(budget, /for the run/);
    assert.doesNotMatch(budget, /SegmentedControl/);
    assert.match(budget, /presets=\{undefined\}/);
    assert.doesNotMatch(
      budget,
      /text-muted-foreground\}>\s*\{mode === "lifetime" \? "for the run" : "per day"\}/,
    );
    assert.match(budget, /inline-flex items-baseline/);
    assert.doesNotMatch(budget, /text-right/);
    const target = readFileSync("components/plan/canvas-target.tsx", "utf8");
    assert.match(target, /▸ details/);
    assert.match(target, /your usual/);
    assert.doesNotMatch(target, /aria-label="edit target"/);
    assert.doesNotMatch(target, />preset</);
  });

  it("pins dashed thumb, end · now, in 2h, and no StatusDot on the row", () => {
    const thumb = readFileSync("components/viz/event-thumb.tsx", "utf8");
    assert.match(thumb, /border-dashed/);
    assert.doesNotMatch(thumb, /eventInitials|initials/);
    const rail = readFileSync("components/viz/window-bar.tsx", "utf8");
    assert.match(rail, /rail\.endNoun/);
    assert.match(rail, /VIZ_TYPE_NUM\.label/);
    assert.doesNotMatch(rail, /VIZ_TYPE\.micro/);
    const row = readFileSync("components/viz/channel-row.tsx", "utf8");
    assert.doesNotMatch(row, /StatusDot/);
  });

  it("usual outline is a hairline over the segments with the usual percentages", () => {
    const split = readFileSync("components/viz/split-bar.tsx", "utf8");
    assert.match(split, /data-split-outline=\{name\}/);
    assert.match(split, /data-outline-pcts=\{pcts\.join\("/);
    assert.match(split, /data-outline-left=\{rect\.left\}/);
    assert.match(split, /data-outline-width=\{rect\.width\}/);
    assert.match(split, /bg-foreground\/60/);
    const budget = readFileSync("components/plan/canvas-budget.tsx", "utf8");
    assert.match(budget, /PLAN_SPLIT_PRESETS\[1\]!\.pct/);
  });
});
