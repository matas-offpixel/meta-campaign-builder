import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { actionCount, loadAll, loadCycleSupply, loadOnSaleEvents, resultOf } from "../load.ts";
import { ONSALE_PHASE, PRESALE_PHASE } from "../phase-config.ts";
import { isOnSale, isShowWeek } from "../on-sale.ts";
import { addLines, audienceLines, buildProposal, chooseObjective, claimLines, pauseLines, whyLines, type AdInput, type AdSetInput, type CampaignInput, type ClusterInput } from "../rules.ts";
import { inputsSnapshot, isOnsaleRefreshEnabled, postPendingProposals, refreshRunLog, runOnsaleRefresh, writeProposal, type RunRefreshInput } from "../runner.ts";
import { cycleKindOf, nextCycleAfter, planRun, scheduledRunKind, shortDay, weekLabel, windowFor } from "../schedule.ts";
import { slackMessage } from "../slack.ts";

// ── R1 schedule ──────────────────────────────────────────────────────────────

describe("on-sale refresh: schedule (R1)", () => {
  it("payday cycle Mondays and content cycle Mondays, for P26-BDAY's autumn", () => {
    // Paydays: Fri 30 Oct, Fri 27 Nov. Cycles start Mon 26 Oct, 9 Nov, 23 Nov.
    assert.equal(cycleKindOf("2026-10-26"), "payday");
    assert.equal(cycleKindOf("2026-11-09"), "content");
    assert.equal(cycleKindOf("2026-11-23"), "payday");
    assert.equal(cycleKindOf("2026-12-07"), "content");
  });

  it("a cycle Monday is the cycle refresh, the Monday between the mid-cycle check, any other day nothing", () => {
    assert.equal(scheduledRunKind("2026-11-09"), "cycle");
    assert.equal(scheduledRunKind("2026-11-16"), "mid_cycle");
    assert.equal(scheduledRunKind("2026-11-23"), "cycle");
    assert.equal(scheduledRunKind("2026-11-12"), null);
  });

  it("a scheduled run reads the last full Monday–Sunday week; a shadow run reads the seven days to the day before", () => {
    assert.deepEqual(windowFor("2026-11-16", "mid_cycle", ONSALE_PHASE), { start: "2026-11-09", end: "2026-11-15" });
    assert.deepEqual(windowFor("2026-11-12", "shadow", ONSALE_PHASE), { start: "2026-11-05", end: "2026-11-11" });
    assert.deepEqual(windowFor("2026-11-12", "shadow", PRESALE_PHASE), { start: "2026-11-05", end: "2026-11-11" });
  });

  it("the plan for a hand-started Thursday run, and the stop at show week", () => {
    const plan = planRun({ day: "2026-11-12", eventDate: "2026-12-27", config: ONSALE_PHASE, shadow: true });
    assert.equal(plan.runKind, "shadow");
    assert.equal(plan.cycleMonday, "2026-11-09");
    assert.equal(plan.cycleKind, "content");
    assert.equal(plan.nextCheck, "2026-11-16");
    assert.equal(plan.nextCheckKind, "mid_cycle");
    assert.equal(plan.nextCycle, "2026-11-23");
    assert.equal(plan.showWeek, false);
    const lastCheck = planRun({ day: "2026-12-14", eventDate: "2026-12-27", config: ONSALE_PHASE });
    assert.equal(lastCheck.runKind, "mid_cycle");
    assert.equal(lastCheck.nextCheck, null, "Mon 21 Dec is show week: no next check");
    const showWeek = planRun({ day: "2026-12-21", eventDate: "2026-12-27", config: ONSALE_PHASE });
    assert.equal(showWeek.showWeek, true);
    assert.equal(shortDay("2026-11-16"), "Mon 16 Nov");
    assert.deepEqual(nextCycleAfter("2026-11-09"), { monday: "2026-11-23", kind: "payday" });
    assert.deepEqual(nextCycleAfter("2026-11-23"), { monday: "2026-12-07", kind: "content" });
    assert.equal(weekLabel("2026-11-09"), "w/c 9 Nov");
  });
});

// ── R2 / R3 / R5 rules ───────────────────────────────────────────────────────

const PLAN = planRun({ day: "2026-11-12", eventDate: "2026-12-27", config: ONSALE_PHASE, shadow: true });

function ad(overrides: Partial<AdInput> & Pick<AdInput, "adId" | "adsetId" | "name">): AdInput {
  return { firstDay: "2026-10-30", lastDay: "2026-11-11", weekSpend: 10, weekResults: 1, totalSpend: 40, totalResults: 5, convertScore: 50, significant: false, ...overrides };
}

function adSet(overrides: Partial<AdSetInput> & Pick<AdSetInput, "adsetId" | "name">): AdSetInput {
  return { adsetIds: [overrides.adsetId], firstDay: "2026-10-30", lastDay: "2026-11-11", weekSpend: 40, weekResults: 5, totalSpend: 100, totalResults: 12, delivering: true, ...overrides };
}

function campaign(overrides: Partial<CampaignInput> = {}): CampaignInput {
  return {
    eventId: "e1",
    eventCode: "P26-BDAY",
    eventName: "Puzzle 4th Birthday",
    campaignKey: "[P26-BDAY] Puzzle - 27 Dec - On Sale",
    campaignIds: ["c1", "c2"],
    onSaleDay: "2026-10-30",
    plan: PLAN,
    resultEvent: "initiate_checkout",
    weekSpend: 200,
    weekResults: 26,
    totalSpend: 734.22,
    totalResults: 96,
    totalFirstDay: "2026-10-29",
    ads: [],
    adSets: [],
    clusters: [],
    supply: [],
    claims: [],
    budgetGbp: null,
    spendToDateGbp: 1800,
    ticketingLinked: false,
    ticketingProvider: null,
    last14: { ic: 26, purchases: 1, lpv: 374 },
    sinceOnSale: { ic: 106, purchases: 1, fromDay: "2026-10-30" },
    ...overrides,
  };
}

describe("on-sale refresh: objective and the why line (R3)", () => {
  it("IC at 10+ in 14 days on the event's campaigns, the pixel count as the fallback, else LPV", () => {
    assert.equal(chooseObjective({ last14: { ic: 26, purchases: 0, lpv: 0 } }, ONSALE_PHASE), "initiate_checkout");
    assert.equal(chooseObjective({ last14: { ic: 3, purchases: 0, lpv: 500 } }, ONSALE_PHASE), "landing_page_view");
    assert.equal(chooseObjective({ last14: { ic: 3, purchases: 0, lpv: 500 } }, ONSALE_PHASE, 12), "initiate_checkout");
  });

  it("the why line quotes the counts verbatim and says Purchase is not proposed under 15 in 14 days", () => {
    const why = whyLines(campaign(), "initiate_checkout", ONSALE_PHASE);
    assert.equal(why.objective, "Initiate Checkout — 106 reached the pixel since 30 Oct. Last 14 days: 26 IC, 1 purchase.");
    assert.equal(why.purchase, "Purchase campaign not proposed — 1 purchase on the pixel in 2 weeks.");
    assert.equal(why.purchaseNarrow, "No Purchase campaign: 1 purchase on the pixel in 2 weeks.");
    assert.equal(why.moves, "Budget moves stay inside each campaign.");
    assert.equal(why.ticketing, "No linked ticketing: the pixel's purchases can't be checked against real sales.", "F9: ticketing is an input said under Objective");
    assert.equal(whyLines(campaign({ ticketingLinked: true }), "initiate_checkout", ONSALE_PHASE).ticketing, null);
    const signal = whyLines(campaign({ last14: { ic: 30, purchases: 15, lpv: 400 } }), "initiate_checkout", ONSALE_PHASE);
    assert.equal(signal.purchase, "Purchase signal: 15 purchases on the pixel in 14 days. Purchase campaign and cross-campaign moves aren't proposed yet.", "G3");
    assert.equal(signal.purchaseNarrow, "Purchase signal: 15 in 14 days.");
    assert.equal(signal.moves, "Budget moves stay inside each campaign.", "G3: cross-campaign moves are P4's");
    const lpv = whyLines(campaign({ last14: { ic: 4, purchases: 0, lpv: 900 } }), "landing_page_view", ONSALE_PHASE);
    assert.match(lpv.objective, /^Landing Page View — the pixel logged 4 Initiate Checkout in 14 days, under 10\. Last 14 days: 900 LPV, 0 purchases\.$/);
    const purchase = whyLines(campaign({ last14: { ic: 40, purchases: 18, lpv: 0 } }), "initiate_checkout", ONSALE_PHASE);
    assert.equal(purchase.purchase, "Purchase signal: 18 purchases on the pixel in 14 days. Purchase campaign and cross-campaign moves aren't proposed yet.", "G3");
    assert.equal(purchase.moves, "Budget moves stay inside each campaign.");
  });
});

describe("on-sale refresh: pause creative (R2)", () => {
  // Campaign cost per IC this week: £200 / 26 = £7.69. Pause spend bar 2× = £15.38.
  const ads = [
    ad({ adId: "a1", adsetId: "s1", name: "Weak", convertScore: 1, significant: true, totalSpend: 60, totalResults: 2 }),
    ad({ adId: "a1b", adsetId: "s2", name: "Weak", convertScore: 1, significant: true, totalSpend: 20, totalResults: 1 }),
    ad({ adId: "a2", adsetId: "s1", name: "Mid", convertScore: 50, significant: true, totalSpend: 60, totalResults: 8 }),
    ad({ adId: "a3", adsetId: "s1", name: "Strong", convertScore: 90, significant: true, totalSpend: 60, totalResults: 12 }),
    ad({ adId: "a4", adsetId: "s2", name: "Young", convertScore: 2, significant: true, totalSpend: 60, totalResults: 1, firstDay: "2026-11-09" }),
    ad({ adId: "a5", adsetId: "s2", name: "Cheap", convertScore: 3, significant: true, totalSpend: 9, totalResults: 0 }),
    ad({ adId: "a6", adsetId: "s2", name: "Unsure", convertScore: 4, significant: false, totalSpend: 60, totalResults: 0 }),
  ];
  const sets = [adSet({ adsetId: "s1", name: "Lineup — Primary" }), adSet({ adsetId: "s2", name: "Adv+" })];

  it("qualifies on significant + bottom third + 7 days + 2× spend; the rest go to Watch", () => {
    const { lines, watch } = pauseLines(campaign({ ads, adSets: sets }), ONSALE_PHASE);
    assert.deepEqual(lines.map((line) => line.title), ["Weak"]);
    assert.deepEqual(lines[0]!.target, { creative: "Weak", adIds: ["a1", "a1b"] });
    assert.equal(lines[0]!.write?.kind, "ad_status");
    assert.equal((lines[0]!.evidence as { ads: number }).ads, 2);
    const watched = watch.map((item) => item.title);
    assert.ok(watched.includes("Young"), "under 7 days");
    assert.ok(watched.includes("Unsure"), "not significant");
    assert.ok(!watched.includes("Cheap"), "under the spend bar is not even watched");
    assert.ok(!watched.includes("Strong"), "F5: significant and outside the bottom third is not shown");
    assert.ok(!watched.includes("Mid"), "F5: significant and outside the bottom third is not shown");
    assert.ok(!watched.includes("Weak"), "proposed, not watched");
    assert.equal(lines[0]!.narrow.writeText, null, "F2's wording drops the write line at 393");
    assert.match(lines[0]!.narrow.detail, /^£80\.00 · 3 IC/);
  });

  it("F6: the mid-cycle check proposes no pauses; Watch still shows", () => {
    const mid = planRun({ day: "2026-11-16", eventDate: "2026-12-27", config: ONSALE_PHASE });
    const { lines, watch, note } = pauseLines(campaign({ ads, adSets: sets, plan: mid }), ONSALE_PHASE);
    assert.deepEqual(lines, []);
    assert.equal(note, "No pauses on a mid-cycle check.");
    assert.ok(watch.some((item) => item.title === "Unsure"));
    assert.ok(watch.every((item) => item.narrow.startsWith(`${item.title} · £`)));
  });

  it("never the last delivering ad in an ad set, at most three pauses", () => {
    const alone = pauseLines(campaign({ ads: [ad({ adId: "only", adsetId: "s1", name: "Only", convertScore: 1, significant: true, totalSpend: 80 }), ad({ adId: "x", adsetId: "s2", name: "X", convertScore: 90, significant: true, totalSpend: 80 }), ad({ adId: "y", adsetId: "s2", name: "Y", convertScore: 60, significant: true, totalSpend: 80 })], adSets: sets }), ONSALE_PHASE);
    assert.equal(alone.lines.length, 0);
    assert.ok(alone.watch.some((item) => item.title === "Only" && /last delivering ad/.test(item.detail)));
    const many = Array.from({ length: 12 }, (_, i) => ad({ adId: `m${i}`, adsetId: i % 2 ? "s1" : "s2", name: `M${i}`, convertScore: i, significant: true, totalSpend: 80, totalResults: 1 }));
    const capped = pauseLines(campaign({ ads: many, adSets: sets }), ONSALE_PHASE);
    assert.equal(capped.lines.length, ONSALE_PHASE.maxPauses);
  });
});

describe("on-sale refresh: audiences and budget (R2, R5)", () => {
  // Campaign week cost per IC £7.69.
  const sets = [
    adSet({ adsetId: "ret", name: "Retargeting – No Suggest", weekSpend: 60, weekResults: 7 }),
    adSet({ adsetId: "adv", name: "Adv+", weekSpend: 40, weekResults: 7 }),
    adSet({ adsetId: "ll", name: "1% Lookalike – Data — Primary", weekSpend: 5, weekResults: 3 }),
    adSet({ adsetId: "lineup", name: "Lineup — Primary", weekSpend: 28.36, weekResults: 2 }), // £14.18, 1.84×: watch
    adSet({ adsetId: "bad", name: "Boiler Room, Mixmag", weekSpend: 40, weekResults: 2, firstDay: "2026-10-30" }), // £20, 2.6×, 5.2× spend: drop
    adSet({ adsetId: "new", name: "Fresh", weekSpend: 40, weekResults: 1, firstDay: "2026-11-08" }), // young: watch
    adSet({ adsetId: "edm", name: "Electronic dance music, Electronic music", delivering: false, lastDay: "2026-11-06", weekSpend: 0, weekResults: 0, totalSpend: 36.85, totalResults: 12 }), // £3.07, 0.4×: bring back
    adSet({ adsetId: "old", name: "Tech house", delivering: false, lastDay: "2026-11-03", weekSpend: 0, weekResults: 0, totalSpend: 42, totalResults: 4 }), // 4 IC: no
  ];

  it("drops at 7 days, 3× spend and 2× cost, never retargeting; watches the ad set at 1.84×; brings back the stopped set at 0.4×", () => {
    const { lines, watch, note } = audienceLines(campaign({ adSets: sets }), ONSALE_PHASE);
    const kinds = lines.map((line) => `${line.kind}:${line.title}`);
    assert.ok(kinds.includes("drop_audience:Boiler Room, Mixmag"));
    assert.ok(kinds.includes("bring_back_audience:Electronic dance music, Electronic music"));
    assert.ok(!kinds.some((kind) => kind.startsWith("bring_back_audience:Tech house")));
    assert.ok(!kinds.some((kind) => kind.startsWith("missing_default")), "retargeting and the lookalike are there");
    assert.equal(note, "");
    const bring = lines.find((line) => line.kind === "bring_back_audience")!;
    assert.equal(bring.addsSpend, true);
    assert.equal(bring.blockedReason, "Adds spend: set this event's budget to accept this.");
    assert.match(bring.detail, /^Stopped 6 Nov · £36\.85 · 12 IC · £3\.07 each, 0\.4× the campaign$/);
    assert.deepEqual(bring.narrow, { detail: "£36.85 · 12 IC · £3.07 each, 0.4×", writeText: null }, "F2's wording at 393");
    assert.deepEqual(bring.target, { adsetId: "edm", adsetIds: ["edm"], name: "Electronic dance music, Electronic music" });
    assert.ok(watch.some((item) => item.title === "Lineup — Primary" && /1\.84× the campaign \(drops at 2×\)/.test(item.detail)));
    assert.ok(watch.some((item) => item.title === "Fresh" && /live 4 days/.test(item.detail)));
  });

  it("the move is capped at 20 % of the remaining budget and blocked with no budget", () => {
    const withBudget = audienceLines(campaign({ adSets: sets, budgetGbp: 4500, spendToDateGbp: 1800 }), ONSALE_PHASE);
    const move = withBudget.lines.find((line) => line.kind === "move_budget")!;
    assert.ok(move, "a move from the worst delivering set to the best");
    assert.equal(move.title, "Fresh → Adv+", "from the worst delivering cost to the best with at least 5 results in the week");
    assert.ok(!/1% Lookalike/.test(move.title), "3 results in the week is under the receiving floor of 5");
    assert.equal((move.evidence as { capGbp: number }).capGbp, 540);
    assert.ok((move.evidence as { amountGbp: number }).amountGbp <= 540);
    assert.equal(move.blockedReason, null);
    assert.ok(!withBudget.lines.some((line) => line.blockedReason));
    const noBudget = audienceLines(campaign({ adSets: sets }), ONSALE_PHASE);
    assert.match(noBudget.lines.find((line) => line.kind === "move_budget")!.blockedReason ?? "", /set this event's budget/);
  });

  it("F8 / G1: a cluster comes back on the client's own results only — perClient cost index ≤ 0.83 at confidence ≥ ok, never the pooled index", () => {
    const own = (over: Partial<ClusterInput>): ClusterInput => ({ id: "c", name: "C", client: "Puzzle", index: 0.7, confidence: 0.5, confidenceWord: "ok", usedOnEvent: false, ...over });
    const clusters = [
      own({ id: "c-good", name: "Techno heads", index: 0.7, confidence: 1, confidenceWord: "strong" }),
      own({ id: "c-edge", name: "Edge", index: 0.83 }),
      own({ id: "c-dear", name: "Dear", index: 1.2 }),
      own({ id: "c-thin", name: "Thin", index: 0.5, confidence: 0, confidenceWord: "thin" }),
      own({ id: "c-used", name: "Used", index: 0.5, usedOnEvent: true }),
      own({ id: "c-pooled", name: "Pooled only", client: null, index: null, confidence: 0, confidenceWord: "thin" }),
    ];
    assert.equal(ONSALE_PHASE.bringBackClusterCprIndexAtMost, 0.83);
    const { lines } = audienceLines(campaign({ clusters, budgetGbp: 4500, adSets: [adSet({ adsetId: "ret", name: "Retargeting" }), adSet({ adsetId: "ll", name: "1% LL" })] }), ONSALE_PHASE);
    const back = lines.filter((line) => line.ruleId === "bring_back.client_cluster");
    assert.deepEqual(back.map((line) => line.title), ["Techno heads", "Edge"]);
    assert.equal(back[0]!.detail, "Ran for Puzzle at 0.7× its cost per registration · confidence strong · not used on this event");
    assert.deepEqual(back[0]!.evidence, { client: "Puzzle", stage: "registration", cprIndex: 0.7, confidence: "strong", atMost: 0.83 });
    assert.equal(back[1]!.narrow.detail, "0.83× Puzzle's cost per registration · confidence ok");
  });

  it("missing standing defaults are proposed when no delivering ad set is retargeting or the lookalike", () => {
    const { lines } = audienceLines(campaign({ adSets: [adSet({ adsetId: "a", name: "Adv+" }), adSet({ adsetId: "b", name: "Wide" })] }), ONSALE_PHASE);
    assert.deepEqual(lines.filter((line) => line.kind === "missing_default").map((line) => line.ruleId), ["missing_default.retargeting", "missing_default.registrations_lookalike"]);
  });

});

describe("on-sale refresh: supply (R2)", () => {
  const supply = (name: string, mix: "ugc" | "cta" | "no_cta", extra: Partial<CampaignInput["supply"][number]> = {}) => ({ fileId: name, name, owner: "Enzo Siragusa", kind: "video" as const, mix, path: `Enzo Siragusa / Videos / ${mix.toUpperCase()}`, alreadyInCampaign: false, matchedBy: "lab_launch" as const, ...extra });

  it("the content cycle leads with UGC and No CTA two in three, caps at six, skips files already in the campaign, and the mid-cycle check adds nothing", () => {
    const files = [supply("c1", "cta"), supply("c2", "cta"), supply("c3", "cta"), supply("u1", "ugc"), supply("u2", "ugc"), supply("n1", "no_cta"), supply("n2", "no_cta"), supply("u3", "ugc"), supply("in", "ugc", { alreadyInCampaign: true })];
    const lines = addLines(campaign({ supply: files }), ONSALE_PHASE);
    assert.equal(lines.length, 6);
    const leads = lines.filter((line) => /UGC|NO_CTA/.test(line.detail)).length;
    assert.equal(leads, 4, "2 in 3 of 6");
    assert.ok(!lines.some((line) => line.title === "in"));
    assert.match(lines[0]!.detail, /content cycle/);
    assert.equal((lines[0]!.evidence as { matchedBy: string }).matchedBy, "lab_launch", "F7: how the duplicate check was made");
    assert.deepEqual(lines[0]!.narrow, { detail: `${lines[0]!.title.startsWith("u") ? "Enzo Siragusa / Videos / UGC" : "Enzo Siragusa / Videos / NO_CTA"} · content cycle`, writeText: "New ad in each delivering ad set · live" });
    const payday = addLines(campaign({ supply: files, plan: planRun({ day: "2026-11-23", eventDate: "2026-12-27", config: ONSALE_PHASE }) }), ONSALE_PHASE);
    assert.equal(payday.filter((line) => / \/ CTA$/.test(line.detail.split(" · ")[0]!)).length, 3, "the payday cycle takes every CTA file first (3 of 6)");
    assert.match(payday[0]!.detail, /payday cycle/);
    const mid = addLines(campaign({ supply: files, plan: planRun({ day: "2026-11-16", eventDate: "2026-12-27", config: ONSALE_PHASE }) }), ONSALE_PHASE);
    assert.equal(mid.length, 0);
  });

  it("an approved claim with no render is a supply line pointing to the Lab", () => {
    const lines = claimLines(
      campaign({
        claims: [
          { id: "w1", claim: "EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT\n3RD RELEASE SELLING FAST", approvedAt: "2026-11-11T15:59:00Z", runsFrom: "2026-11-11T15:59:00Z", runsTo: null, renderId: null },
          { id: "w2", claim: "Rendered", approvedAt: "2026-11-01T00:00:00Z", runsFrom: null, runsTo: null, renderId: "r1" },
          { id: "w3", claim: "Later", approvedAt: "2026-11-01T00:00:00Z", runsFrom: "2026-12-01T00:00:00Z", runsTo: null, renderId: null },
        ],
      }),
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.title, "“EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT / 3RD RELEASE SELLING FAST”");
    assert.equal(lines[0]!.detail, "Approved · live since 11 Nov · no render yet");
    assert.equal(lines[0]!.writeText, "Make it in the Lab: it joins the 23 Nov payday cycle's adds");
    assert.equal(lines[0]!.supply, true);
    assert.equal(lines[0]!.write, null);
  });
});

describe("on-sale refresh: the proposal (R2, R5)", () => {
  it("under 20 results the proposal carries supply only and says so", () => {
    const proposal = buildProposal(
      campaign({
        weekResults: 12,
        ads: [ad({ adId: "a", adsetId: "s", name: "Weak", convertScore: 1, significant: true, totalSpend: 80 }), ad({ adId: "b", adsetId: "s", name: "Ok", convertScore: 80, significant: true, totalSpend: 80 })],
        adSets: [adSet({ adsetId: "s", name: "Boiler", weekSpend: 100, weekResults: 1 })],
        supply: [{ fileId: "f", name: "clip", owner: "Enzo", kind: "video", mix: "ugc", path: "Enzo / Videos / UGC", alreadyInCampaign: false, matchedBy: "lab_launch" }],
      }),
      ONSALE_PHASE,
    );
    assert.equal(proposal.enoughData, false);
    assert.equal(proposal.notEnoughData, "Not enough data this week (12 IC, under 20) — next check Mon 16 Nov.");
    assert.deepEqual(proposal.lines.map((line) => line.kind), ["add_creative"]);
    assert.equal(proposal.blockers.length, 1, "F9: only the budget blocks; ticketing is said under Objective");
    assert.equal(proposal.blockers[0]!.text, "This event has no marketing budget, so nothing that adds spend can be accepted.");
    assert.equal(proposal.why.ticketing, "No linked ticketing: the pixel's purchases can't be checked against real sales.");
    assert.equal(proposal.notes.adds, "Files uploaded by hand in Ads Manager aren't matched.");
    assert.equal(proposal.campaignSummary, "29 Oct – 11 Nov · £734.22 · 96 IC · £7.65 each");
  });

  it("with a budget set, no blocker and no blocked line", () => {
    const proposal = buildProposal(campaign({ budgetGbp: 4500, ticketingLinked: true, adSets: [adSet({ adsetId: "edm", name: "EDM", delivering: false, lastDay: "2026-11-06", totalSpend: 36.85, totalResults: 12 }), adSet({ adsetId: "ret", name: "Retargeting" }), adSet({ adsetId: "ll", name: "1% LL" })] }), ONSALE_PHASE);
    assert.equal(proposal.blockers.length, 0);
    assert.ok(proposal.lines.every((line) => line.blockedReason == null));
  });
});

// ── load helpers ─────────────────────────────────────────────────────────────

describe("on-sale refresh: the one on-sale predicate (G2)", () => {
  it("not cancelled, the show ahead, and status on_sale or the general sale passed; the loader and the panel mount share it", () => {
    const today = "2026-11-12";
    assert.equal(isOnSale({ status: "on_sale", event_date: "2026-12-04", general_sale_at: null }, today), true, "Worakls: on_sale with no general sale date");
    assert.equal(isOnSale({ status: "upcoming", event_date: "2026-12-11", general_sale_at: "2026-11-06T14:00:00Z" }, today), true, "Locklead: general sale passed");
    assert.equal(isOnSale({ status: "upcoming", event_date: "2026-12-11", general_sale_at: "2026-11-20T14:00:00Z" }, today), false, "sale still ahead");
    assert.equal(isOnSale({ status: "upcoming", event_date: "2026-12-11", general_sale_at: null }, today), false, "no date, not on sale");
    assert.equal(isOnSale({ status: "cancelled", event_date: "2026-12-11", general_sale_at: "2026-11-06T14:00:00Z" }, today), false, "cancelled drops out");
    assert.equal(isOnSale({ status: "on_sale", event_date: "2026-11-11", general_sale_at: null }, today), false, "the show has happened");
    assert.equal(isOnSale({ status: "on_sale", event_date: "2026-11-12", general_sale_at: null }, today), true, "show day still counts");
    assert.equal(isShowWeek("2026-12-27", "2026-12-21"), true);
    assert.equal(isShowWeek("2026-12-27", "2026-12-20"), false);
    assert.equal(isShowWeek(null, "2026-12-20"), false);
  });

  it("the loader reads every non-cancelled event still ahead and keeps the predicate's, archived clients out", async () => {
    const rows = [
      { id: "w", name: "Worakls", event_code: "20261204CSA", event_date: "2026-12-04", general_sale_at: null, status: "on_sale", client_id: "lp", budget_marketing: null, drive_folder_id: null },
      { id: "l", name: "Locklead", event_code: "NX26-LOCKLEAD", event_date: "2026-12-11", general_sale_at: "2026-11-06T14:00:00Z", status: "upcoming", client_id: "eb", budget_marketing: null, drive_folder_id: null },
      { id: "n", name: "Not yet", event_code: "X", event_date: "2026-12-11", general_sale_at: "2026-12-01T14:00:00Z", status: "upcoming", client_id: "eb", budget_marketing: null, drive_folder_id: null },
      { id: "a", name: "Archived", event_code: "Y", event_date: "2026-12-11", general_sale_at: "2026-11-01T14:00:00Z", status: "on_sale", client_id: "old", budget_marketing: null, drive_folder_id: null },
    ];
    const { db, calls } = fakeDb((call) => {
      if (call.table === "clients") return { data: [{ id: "old" }], error: null };
      return { data: rows, error: null };
    });
    const events = await loadOnSaleEvents(db, "2026-11-12");
    assert.deepEqual(events.map((event) => event.id), ["w", "l"]);
    const read = calls.find((call) => call.table === "events")!;
    assert.deepEqual(op(read, "gte"), ["event_date", "2026-11-12"]);
    assert.deepEqual(op(read, "neq"), ["status", "cancelled"]);
    assert.equal(op(read, "not"), undefined, "no general_sale_at filter in the query: the predicate decides");
  });
});

describe("on-sale refresh: loading", () => {
  it("F3: every paged read is ordered by its unique key and deduped, so overlapping pages never double a row", async () => {
    const pageA = Array.from({ length: 1000 }, (_, i) => ({ date: "2026-11-01", meta_ad_id: `a${String(i).padStart(4, "0")}`, spend: 1 }));
    const pageB = [...pageA.slice(990), ...Array.from({ length: 5 }, (_, i) => ({ date: "2026-11-02", meta_ad_id: `b${i}`, spend: 1 }))];
    let page = 0;
    const { db, calls } = fakeDb(() => ({ data: page++ === 0 ? pageA : pageB, error: null }));
    const rows = await loadAll<{ date: string; meta_ad_id: string; spend: number }>(db, "ad_daily_insights", "date, meta_ad_id, spend", ["date", "meta_ad_id"]);
    assert.equal(rows.length, 1005, "the 10 repeated rows are dropped");
    assert.equal(rows.reduce((sum, row) => sum + row.spend, 0), 1005);
    for (const call of calls) {
      assert.deepEqual(call.ops.filter(([name]) => name === "order").map(([, args]) => args[0]), ["date", "meta_ad_id"]);
      assert.ok(op(call, "range"));
    }
  });

  it("results read Meta's canonical IC action, LPV from its column", () => {
    const row = { meta_ad_id: "a", meta_adset_id: "s", meta_campaign_id: "c", ad_account_id: "act", date: "2026-11-10", ad_name: null, adset_name: null, campaign_name: null, spend: 1, landing_page_views: 7, purchases: 0, actions: [{ action_type: "omni_initiated_checkout", value: "3" }, { action_type: "offsite_conversion.fb_pixel_initiate_checkout", value: "3" }, { action_type: "initiate_checkout", value: "3" }] };
    assert.equal(actionCount(row.actions, "omni_initiated_checkout"), 3);
    assert.equal(resultOf(row, "initiate_checkout"), 3, "the pixel and onsite rows are parts of the omni total, not added to it");
    assert.equal(resultOf(row, "landing_page_view"), 7);
  });

  it("the cycle's Drive folders: one listing per owner type folder, a UGC / CTA / No CTA folder inside sets the mix, the legacy UGC folder counts as UGC", async () => {
    const calls: string[] = [];
    const drive = {
      driveId: "d",
      async listChildren(parentId: string) {
        calls.push(parentId);
        if (parentId === "enzo-videos") return [{ id: "ugc-folder", name: "UGC", mimeType: "application/vnd.google-apps.folder" }, { id: "loose", name: "P26-BDAY_enzo-siragusa-9_quote-on-sale_r1_9x16.mp4", mimeType: "video/mp4" }];
        if (parentId === "ugc-folder") return [{ id: "q1", name: "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16.mp4", mimeType: "video/mp4" }, { id: "q4", name: "P26-BDAY_enzo-siragusa-4_quote-on-sale_r1_9x16.mp4", mimeType: "video/mp4" }];
        if (parentId === "legacy") return [{ id: "old", name: "clip.mov", mimeType: "video/quicktime" }];
        return [];
      },
    } as unknown as Parameters<typeof loadCycleSupply>[0];
    const folders = [
      { event_id: "e1", key: "03/3/wc/2026-11-09", name: "w/c 9 Nov", drive_folder_id: "cycle" },
      { event_id: "e1", key: "03/3/wc/2026-11-09/owner/artist:x", name: "Enzo Siragusa", drive_folder_id: "enzo" },
      { event_id: "e1", key: "03/3/wc/2026-11-09/owner/artist:x/videos", name: "Videos", drive_folder_id: "enzo-videos" },
      { event_id: "e1", key: "03/3/wc/2026-11-09/ugc", name: "UGC", drive_folder_id: "legacy" },
      { event_id: "e2", key: "03/3/wc/2026-11-09/owner/promoter/videos", name: "Videos", drive_folder_id: "other-event" },
    ];
    const result = await loadCycleSupply(drive, folders, "e1", "2026-11-09", new Set(["q4"]));
    assert.equal(result.driveCalls, 3);
    assert.deepEqual(calls, ["enzo-videos", "ugc-folder", "legacy"]);
    assert.deepEqual(
      result.files.map((file) => [file.name.replace(".mp4", "").replace(".mov", ""), file.mix, file.path, file.alreadyInCampaign]),
      [
        ["P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16", "ugc", "Enzo Siragusa / Videos / UGC", false],
        ["P26-BDAY_enzo-siragusa-4_quote-on-sale_r1_9x16", "ugc", "Enzo Siragusa / Videos / UGC", true],
        ["P26-BDAY_enzo-siragusa-9_quote-on-sale_r1_9x16", "unknown", "Enzo Siragusa / Videos", false],
        ["clip", "ugc", "UGC", false],
      ],
    );
    const none = await loadCycleSupply(null, folders, "e1", "2026-11-09", new Set());
    assert.deepEqual(none, { files: [], driveCalls: 0, reason: "Drive is not configured" });
  });
});

// ── runner, Slack, migration ─────────────────────────────────────────────────

describe("on-sale refresh: runner", () => {
  const event = { id: "e1", name: "Puzzle 4th Birthday", event_code: "P26-BDAY", event_date: "2026-12-27", general_sale_at: "2026-10-30T12:00:00Z", status: "on_sale", client_id: "c1", budget_marketing: 4500, drive_folder_id: "f" };
  const loaders = {
    events: async () => [event],
    insights: async (_db: unknown) => ({ rows: [], context: { launchedAds: new Map(), launchedAdSets: new Map(), codedEvents: [] } }),
    aux: async () => ({ scores: [], clusters: [], launchedAdSets: [], warnings: [], ticketing: [], driveFolders: [], renderDriveIds: new Set<string>() }),
    inputs: async (args: { event: typeof event }) => ({
      event: args.event,
      plan: PLAN,
      campaigns: [
        campaign({
          budgetGbp: 4500,
          adSets: [adSet({ adsetId: "ret", name: "Retargeting" }), adSet({ adsetId: "ll", name: "1% LL" }), adSet({ adsetId: "edm", name: "EDM", delivering: false, lastDay: "2026-11-06", weekSpend: 0, weekResults: 0, totalSpend: 36.85, totalResults: 12 })],
        }),
        // A campaign that stopped before the window's end is skipped, not proposed into no ad set.
        campaign({ campaignKey: "[P26-BDAY] SIGNUP V3", adSets: [adSet({ adsetId: "old", name: "Old", delivering: false, lastDay: "2026-11-06" })] }),
      ],
      driveCalls: 2,
      driveReason: null,
    }),
  } as unknown as NonNullable<RunRefreshInput["loaders"]>;

  it("the killswitch: unset or not exactly '1' → skippedReason, no read", async () => {
    assert.equal(isOnsaleRefreshEnabled({}), false);
    assert.equal(isOnsaleRefreshEnabled({ ENABLE_ONSALE_REFRESH: "true" }), false);
    assert.equal(isOnsaleRefreshEnabled({ ENABLE_ONSALE_REFRESH: "1" }), true);
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    const result = await runOnsaleRefresh({ env: {}, db });
    assert.deepEqual(result, { ok: true, skippedReason: "killswitch" });
    assert.equal(calls.length, 0);
  });

  it("a dry run computes the proposal and writes nothing, Slack included", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    let notified = 0;
    const result = await runOnsaleRefresh({ env: {}, db, dryRun: true, shadowDay: "2026-11-12", loaders, notify: async () => ((notified += 1), { sent: true }) });
    if ("skippedReason" in result) throw new Error("dry run must not hit the killswitch");
    assert.equal(result.proposals.length, 1);
    assert.deepEqual(result.skipped.filter((skip) => skip.eventCode).map((skip) => skip.reason), ["[P26-BDAY] SIGNUP V3: stopped — no spend since 2026-11-06"]);
    assert.ok(result.skipped.some((skip) => /Drive: .* — no add lines this run/.test(skip.reason)), "no Drive credentials in the test env");
    assert.equal(result.proposals[0]!.written, false);
    assert.equal(result.proposals[0]!.proposal.lines.length > 0, true);
    assert.equal(result.driveCalls, 2);
    assert.equal(notified, 0);
    assert.ok(calls.every((call) => !op(call, "upsert") && !op(call, "insert") && !op(call, "update") && !op(call, "delete")));
    assert.deepEqual(refreshRunLog(result as unknown as Record<string, unknown>), { rows: 0, detail: { events: 1, lines: result.proposals[0]!.proposal.lines.length, driveCalls: 2, pending: 0, posted: 0, errors: 0 } });
  });

  it("a live run stores the proposal with its lines and inputs, expires the previous proposal's unanswered lines, posts once", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.table === "onsale_refresh_proposals" && op(call, "upsert")) return { data: { id: "p1" }, error: null };
      if (call.table === "onsale_refresh_proposals" && op(call, "select") && op(call, "neq")) return { data: [{ id: "p0" }], error: null };
      return { data: [], error: null };
    });
    const posted: string[] = [];
    const result = await runOnsaleRefresh({ env: { ENABLE_ONSALE_REFRESH: "1" }, db, shadowDay: "2026-11-12", loaders, userId: "op", notify: async (opts) => ((posted.push(opts.dedupeKey ?? "")), { sent: true }) });
    if ("skippedReason" in result) throw new Error("enabled");
    assert.deepEqual(result.errors, []);
    assert.equal(result.proposals[0]!.written, true);
    assert.equal(result.proposals[0]!.proposalId, "p1");
    const upsert = calls.find((call) => call.table === "onsale_refresh_proposals" && op(call, "upsert"))!;
    const row = op(upsert, "upsert")![0] as Record<string, unknown>;
    assert.equal(row.mode, "shadow");
    assert.equal(row.run_kind, "shadow");
    assert.equal(row.window_end, "2026-11-11");
    assert.equal((row.inputs as { budgetGbp: number }).budgetGbp, 4500);
    assert.deepEqual(op(upsert, "upsert")![1], { onConflict: "event_id,campaign_key,run_kind,window_end" });
    const lines = calls.find((call) => call.table === "onsale_refresh_lines" && op(call, "insert"))!;
    const inserted = op(lines, "insert")![0] as Record<string, unknown>[];
    assert.ok(inserted.length > 0);
    assert.ok(inserted.every((line) => line.state === "to_review" && line.proposal_id === "p1" && line.user_id === "op"));
    assert.ok(inserted.every((line) => typeof (line.narrow as { detail?: string }).detail === "string"), "F10: every line stores its 393 wording");
    const expired = calls.find((call) => call.table === "onsale_refresh_lines" && op(call, "update"))!;
    assert.deepEqual(op(expired, "update"), [{ state: "expired" }]);
    assert.deepEqual(op(expired, "in"), ["proposal_id", ["p0"]]);
    assert.deepEqual(posted, ["onsale_refresh:p1"]);
    assert.ok(calls.some((call) => call.table === "onsale_refresh_proposals" && op(call, "update")?.[0] && "slack_posted_at" in (op(call, "update")![0] as object)));
    // No Meta, no ad set, no ad status write anywhere.
    assert.ok(calls.every((call) => !["ads", "adsets", "campaigns"].includes(call.table)));
  });

  it("F2: ?post=pending posts the proposals business hours held back, marks slack_posted_at only when sent, and leaves the rest", async () => {
    const pending = [
      { id: "p1", event_id: "e1", campaign_key: "[P26-BDAY] On Sale", run_kind: "shadow", run_day: "2026-11-12", cycle_monday: "2026-11-09", cycle_kind: "content", window_start: "2026-11-05", window_end: "2026-11-11", mode: "shadow", objective: "initiate_checkout", why: whyLines(campaign(), "initiate_checkout", ONSALE_PHASE), blockers: [], enough_data: true, not_enough_data: null, campaign_summary: null, watch: { creatives: [], audiences: [] }, notes: { pauses: "", drops: "", adds: "" }, events: { id: "e1", name: "Puzzle 4th Birthday", event_code: "P26-BDAY", event_date: "2026-12-27" } },
      { id: "p2", event_id: "e2", campaign_key: "[NX] On Sale", run_kind: "shadow", run_day: "2026-11-12", cycle_monday: "2026-11-09", cycle_kind: "content", window_start: "2026-11-05", window_end: "2026-11-11", mode: "shadow", objective: "initiate_checkout", why: whyLines(campaign(), "initiate_checkout", ONSALE_PHASE), blockers: [], enough_data: true, not_enough_data: null, campaign_summary: null, watch: { creatives: [], audiences: [] }, notes: { pauses: "", drops: "", adds: "" }, events: { id: "e2", name: "NX", event_code: "NX-1", event_date: "2026-12-05" } },
    ];
    const { db, calls } = fakeDb((call) => {
      if (call.table === "onsale_refresh_proposals" && op(call, "is")) return { data: pending, error: null };
      if (call.table === "onsale_refresh_lines") return { data: [{ kind: "add_creative" }, { kind: "add_creative" }], error: null };
      return { data: [], error: null };
    });
    const keys: string[] = [];
    const result = await postPendingProposals({ db, now: new Date("2026-11-16T10:05:00Z"), appUrl: "https://app.example", notify: async (opts) => ((keys.push(opts.dedupeKey ?? "")), opts.dedupeKey === "onsale_refresh:p1" ? { sent: true } : { sent: false, reason: "outside_business_hours" }) });
    assert.deepEqual(keys, ["onsale_refresh:p1", "onsale_refresh:p2"]);
    assert.deepEqual(result.posted, ["p1"]);
    assert.deepEqual(result.skipped, [{ proposalId: "p2", reason: "outside_business_hours" }]);
    assert.equal(result.ok, true);
    const pendingRead = calls.find((call) => call.table === "onsale_refresh_proposals" && op(call, "is"))!;
    assert.deepEqual(op(pendingRead, "is"), ["slack_posted_at", null]);
    const marks = calls.filter((call) => call.table === "onsale_refresh_proposals" && op(call, "update"));
    assert.equal(marks.length, 1);
    assert.deepEqual(op(marks[0]!, "eq"), ["id", "p1"]);
    assert.ok("slack_posted_at" in (op(marks[0]!, "update")![0] as object));
  });

  it("the Slack post names the event, the cycle, the shadow count and the panel link, and dedupes on the proposal", () => {
    const message = slackMessage({ proposalId: "p1", eventName: "Puzzle 4th Birthday", eventCode: "P26-BDAY", eventId: "e1", campaignKey: "[P26-BDAY] On Sale", plan: PLAN, mode: "shadow", proposal: buildProposal(campaign(), ONSALE_PHASE) }, "https://app.example");
    assert.equal(message.channel, "ads_automation");
    assert.match(message.text, /^On-sale refresh · Puzzle 4th Birthday \[P26-BDAY\] · w\/c 9 Nov · Shadow — \d+ to review\n/);
    assert.match(message.text, /https:\/\/app\.example\/events\/e1\?tab=overview#onsale-refresh/);
    assert.equal(message.dedupeKey, "onsale_refresh:p1");
    assert.equal(message.respectBusinessHours, undefined, "notify()'s default: business hours for ads_automation");
  });

  it("the snapshot keeps the week, the since-on-sale totals and every ad set, for R6", () => {
    const snapshot = inputsSnapshot(campaign({ adSets: [adSet({ adsetId: "a", name: "A" })] }));
    assert.deepEqual(snapshot.week, { spend: 200, results: 26 });
    assert.equal((snapshot.adSets as unknown[]).length, 1);
    assert.equal((snapshot.sinceOnSale as { ic: number }).ic, 106);
  });

  it("writeProposal throws on a failed insert and writes no lines", async () => {
    const { db, calls } = fakeDb((call) => (call.table === "onsale_refresh_proposals" ? { data: null, error: { message: "down" } } : { data: [], error: null }));
    await assert.rejects(() => writeProposal(db, { userId: "op", event, campaign: campaign(), proposal: buildProposal(campaign(), ONSALE_PHASE) }), /onsale_refresh_proposals: down/);
    assert.ok(!calls.some((call) => call.table === "onsale_refresh_lines"));
  });
});

describe("on-sale refresh: migration, route and docs", () => {
  it("migration 232: two tables, the kinds and states of R2 / R4, owner read RLS, no apply path", () => {
    const sql = readFileSync("supabase/migrations/232_onsale_refresh.sql", "utf8");
    assert.match(sql, /create table if not exists public\.onsale_refresh_proposals/);
    assert.match(sql, /create table if not exists public\.onsale_refresh_lines/);
    for (const kind of ["add_creative", "claim_ready", "pause_creative", "bring_back_audience", "missing_default", "drop_audience", "move_budget"]) assert.ok(sql.includes(`'${kind}'`), kind);
    for (const state of ["to_review", "accepted", "rejected", "applied", "failed", "expired"]) assert.ok(sql.includes(`'${state}'`), state);
    assert.match(sql, /unique \(event_id, campaign_key, run_kind, window_end\)/);
    assert.match(sql, /narrow\s+jsonb not null default '\{\}'/, "F10: the line's 393 wording");
    assert.match(sql, /for select using \(auth\.uid\(\) = user_id\)/);
    assert.doesNotMatch(sql, /for all using/);
  });

  it("the cron route checks the killswitch before the service-role client, never imports Meta, and the env var is documented", () => {
    const route = readFileSync("app/api/cron/onsale-refresh/route.ts", "utf8");
    const kill = route.indexOf("isOnsaleRefreshEnabled(process.env)");
    assert.ok(kill > 0 && kill < route.indexOf("createServiceRoleClient()"));
    assert.match(route, /skippedReason: "killswitch"/);
    assert.doesNotMatch(route, /lib\/meta\/|graphGet|META_ACCESS_TOKEN/);
    for (const file of ["rules", "schedule", "load", "runner", "slack", "read", "phase-config"]) {
      assert.doesNotMatch(readFileSync(`lib/onsale-refresh/${file}.ts`, "utf8"), /graph\.facebook|graphGet|from "\.\.\/meta\/client/, file);
    }
    const claude = readFileSync("CLAUDE.md", "utf8");
    assert.match(claude, /ENABLE_ONSALE_REFRESH=/);
    assert.match(claude, /\/api\/cron\/onsale-refresh/);
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    assert.deepEqual(
      vercel.crons.filter((cron) => cron.path.startsWith("/api/cron/onsale-refresh")).map((cron) => [cron.path, cron.schedule]),
      [
        ["/api/cron/onsale-refresh", "0 6 * * 1"],
        ["/api/cron/onsale-refresh?post=pending", "5 10 * * 1"],
      ],
      "F1: 06:00 UTC after the 03:30 learning-refresh; F2: the 10:05 catch-up post",
    );
    assert.match(route, /searchParams\.get\("post"\) === "pending"/);
    assert.doesNotMatch(readFileSync("components/dashboard/events/onsale-refresh-panel.tsx", "utf8"), /#creative-lab/, "F10: Open Lab goes to the Lab card's round anchor");
    assert.match(readFileSync("components/dashboard/events/onsale-refresh-panel.tsx", "utf8"), /href="#lab-round"/);
    const detail = readFileSync("components/dashboard/events/event-detail.tsx", "utf8");
    assert.match(detail, /\{!isBrand && isOnSale\(/, "G2: the panel mounts on the shared on-sale predicate, for events that aren't brand campaigns");
    assert.match(detail, /<OnSaleRefreshPanel eventId=\{event\.id\} eventDate=\{event\.event_date \?\? null\} \/>/);
    assert.doesNotMatch(detail, /event\.status === "on_sale" \? <OnSaleRefreshPanel/);
    assert.match(readFileSync("components/dashboard/events/onsale-refresh-panel.tsx", "utf8"), /Show week: the refresh has stopped\./);
  });
});
