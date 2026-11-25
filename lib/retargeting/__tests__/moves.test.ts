/**
 * PR B of docs/design-record/2026-11-17-retargeting-campaign.html: RT3's
 * running rows, RT5's moves, holds and cuts, RT6's footer dates, RT7 (the
 * read carries on through show week) and RT9's "is off". The figures are
 * the record's "Expected figures" (RA, RC).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APPLY_ENV, applyGates } from "../../onsale-refresh/apply-gates.ts";
import { applyAccepted, type AdSetNow, type ApplyDeps, type RefreshMeta } from "../../onsale-refresh/apply.ts";
import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import type { PurchaseRead } from "../../onsale-refresh/purchases.ts";
import { deliveryBand, readRunning, tierOf } from "../delivery.ts";
import { linksFallback } from "../links.ts";
import { costOf, planBudget, roomMinor, type TierFigures } from "../moves.ts";
import { planRetargeting, type LiveRead, type RetargetingInput } from "../plan.ts";
import { liveRead } from "../runner.ts";
import { nextPaydayStart, nextRunIn, nextSteps, STEP_HEIGHTS } from "../steps.ts";
import { NO_MOVE_TODAY, poolBand, retargetingOff } from "../words.ts";

const RA: TierFigures[] = [
  { tier: "bottom", adsetId: "b", budgetMinor: 1200, spendMinor: 8240, purchases: 16, frequency: 4.3, pool: "3,900–4,600" },
  { tier: "mid_bottom", adsetId: "mb", budgetMinor: 600, spendMinor: 4160, purchases: 5, frequency: 2.2, pool: "6,300–7,400" },
  { tier: "mid", adsetId: "m", budgetMinor: 600, spendMinor: 4190, purchases: 2, frequency: 1.6, pool: "180,000–212,000" },
];

// RC (12–18 Nov), after RA's move: £12.00 / £8.99 / £3.01.
const RC: TierFigures[] = [
  { tier: "bottom", adsetId: "b", budgetMinor: 1200, spendMinor: 8310, purchases: 13, frequency: 6.4, pool: "3,900–4,600" },
  { tier: "mid_bottom", adsetId: "mb", budgetMinor: 899, spendMinor: 5530, purchases: 6, frequency: 2.3, pool: "6,300–7,400" },
  { tier: "mid", adsetId: "m", budgetMinor: 301, spendMinor: 3080, purchases: 1, frequency: 1.9, pool: "180,000–212,000" },
];

describe("RT5: moves, holds and cuts", () => {
  it("RA: Bottom is cheapest but held at frequency 4.3; Mid gives £2.99 a day to Mid Bottom", () => {
    assert.deepEqual(RA.map(costOf), [5.15, 8.32, 20.95]);
    assert.equal(roomMinor(RA[1]!), 1080, "Mid Bottom's room: £41.60 ÷ 7 × 4 ÷ 2.2 = £10.80");
    const read = planBudget(RA);
    assert.equal(read.holds.length, 1);
    assert.equal(read.holds[0]!.title, "Bottom held");
    assert.equal(read.holds[0]!.detail, "Cheapest at £5.15 per attributed purchase, but frequency 4.3 on 3,900–4,600. It gets no more until frequency falls under 4.");
    assert.equal(read.holds[0]!.narrow, "Bottom held · frequency 4.3");
    const line = read.line!;
    assert.equal(line.kind, "move");
    assert.equal(line.title, "Mid → Mid Bottom");
    assert.equal(line.detail, "£20.95 per attributed purchase (2) to £8.32 (5) · Mid Bottom frequency 2.2 on 6,300–7,400 · £2.99 a day");
    assert.equal(line.narrow, "£20.95 → £8.32 per attributed purchase · £2.99 a day");
    assert.equal(line.writeText, "Ad-set budget write, both sides");
    assert.equal(line.write.dailyMinor, 299);
    assert.equal(line.write.fromAfterMinor, 301, "Mid keeps £3.01");
    assert.equal(line.write.toAfterMinor, 899, "Mid Bottom £8.99, within its room");
    // The refresh's move apply reads a week's amount and writes amount ÷ 7: exactly £2.99.
    assert.equal(Math.round((line.write.amountGbp * 100) / 7), 299);
  });

  it("RC: a cut at frequency 6.4 is the read's one budget line", () => {
    assert.deepEqual(RC.map(costOf), [6.39, 9.22, 30.8]);
    assert.equal(roomMinor(RC[1]!), 1373, "£55.30 ÷ 7 × 4 ÷ 2.3 = £13.73");
    const read = planBudget(RC);
    const line = read.line!;
    assert.equal(line.kind, "cut");
    assert.equal(line.title, "Bottom → Mid Bottom");
    assert.equal(line.detail, "Frequency 6.4 on 3,900–4,600 · £12.00 → £7.50 a day, back to frequency 4 · £4.50 a day to Mid Bottom (£9.22 per attributed purchase, frequency 2.3)");
    assert.equal(line.narrow, "Frequency 6.4 · £12.00 → £7.50 a day");
    assert.equal(line.writeText, "Ad-set budget write, both sides");
    assert.equal(line.write.dailyMinor, 450);
    assert.equal(line.write.toAfterMinor, 1349);
    assert.deepEqual(read.holds, [], "no move, no hold beside a cut");
  });

  it("a cut with no tier that could receive goes back to the plan, titled \"{tier} → the plan\" (design, 25 Nov)", () => {
    const rows = RC.map((row) => (row.tier === "mid_bottom" ? { ...row, frequency: 4.1 } : row));
    const line = planBudget(rows).line!;
    assert.equal(line.title, "Bottom → the plan");
    assert.equal(line.detail, "Frequency 6.4 on 3,900–4,600 · £12.00 → £7.50 a day, back to frequency 4 · £4.50 a day back to the plan");
    assert.equal(line.writeText, "Ad-set budget write");
    assert.equal(line.write.toAdsetId, null);
  });

  it("Meta's estimate unread: the sentences leave \"on {pool}\" out, never \"on —\" (design, 25 Nov)", () => {
    const rows = RC.map((row) => (row.tier === "mid_bottom" ? { ...row, frequency: 4.1 } : row)).map((row) => ({ ...row, pool: null }));
    const line = planBudget(rows).line!;
    assert.equal(line.detail, "Frequency 6.4 · £12.00 → £7.50 a day, back to frequency 4 · £4.50 a day back to the plan");
    assert.equal(/—/.test(line.detail), false);
  });

  it("a cut never takes a tier under £1.00", () => {
    const line = planBudget([{ tier: "mid", adsetId: "m", budgetMinor: 120, spendMinor: 800, purchases: 1, frequency: 9 }].map((row) => ({ ...row, pool: null })) as TierFigures[]).line!;
    assert.equal(line.write.fromAfterMinor, 100);
    assert.equal(line.write.dailyMinor, 20);
  });

  it("too little to rank: no tier at 3 attributed purchases", () => {
    const read = planBudget(RA.map((row) => ({ ...row, purchases: Math.min(row.purchases, 2) })));
    assert.equal(read.line, null);
    assert.equal(read.note, NO_MOVE_TODAY);
    assert.equal(NO_MOVE_TODAY, "No move today: no tier has 3 attributed purchases in 7 days.");
  });

  it("moves only when the receiver costs no more than 0.75 × the giver", () => {
    // Mid at £10.00 a purchase: £8.32 > 0.75 × £10.00 = £7.50.
    const read = planBudget(RA.map((row) => (row.tier === "mid" ? { ...row, spendMinor: 2000 } : row)));
    assert.equal(read.line, null);
    assert.equal(read.holds.length, 1, "the hold still shows");
  });

  it("caps the amount: the giver keeps £1.00 and the receiver stays within its room", () => {
    const giverFloor = planBudget(RA.map((row) => (row.tier === "mid" ? { ...row, budgetMinor: 150 } : row))).line!;
    assert.equal(giverFloor.write.dailyMinor, 50);
    assert.equal(giverFloor.write.fromAfterMinor, 100);
    const room = planBudget(RA.map((row) => (row.tier === "mid_bottom" ? { ...row, budgetMinor: 1000 } : row))).line!;
    assert.equal(room.write.dailyMinor, 80, "£10.80 room less £10.00");
  });

  it("spend with no purchase counts as dearest once it passes the cheapest tier's cost", () => {
    const rows = RA.map((row) => (row.tier === "mid" ? { ...row, purchases: 0, spendMinor: 1000 } : row));
    const line = planBudget(rows).line!;
    assert.equal(line.title, "Mid → Mid Bottom");
    assert.equal(line.detail, "No purchase yet on £10.00 to £8.32 (5) · Mid Bottom frequency 2.2 on 6,300–7,400 · £0.71 a day");
    // Under the cheapest tier's £5.15 it isn't ranked as dearest: Mid Bottom has no giver.
    assert.equal(planBudget(RA.map((row) => (row.tier === "mid" ? { ...row, purchases: 0, spendMinor: 400 } : row))).line, null);
  });

  it("the measure is cost per attributed purchase; the record's never-words stay off", () => {
    const words = [planBudget(RA), planBudget(RC)].flatMap((read) => [read.line?.title, read.line?.detail, read.line?.narrow, read.line?.writeText, ...read.holds.flatMap((hold) => [hold.title, hold.detail, hold.narrow])]).join("\n");
    for (const banned of ["cost per sale", "ABO", "CBO", " IC", "LPV", "CAPI", "checkouts", "registrations"]) assert.equal(words.includes(banned), false, banned);
  });
});

describe("RT3: the pool band and the read of a running campaign", () => {
  it("bands Meta's estimate", () => {
    assert.equal(poolBand(3900, 4600), "3,900–4,600");
    assert.equal(poolBand(180000, 212000), "180,000–212,000");
    assert.equal(poolBand(0, 800), "Below 1,000");
    assert.equal(deliveryBand({ data: [{ estimate_ready: true, estimate_mau_lower_bound: 6300, estimate_mau_upper_bound: 7400 }] }), "6,300–7,400");
    assert.equal(deliveryBand({ data: [{ estimate_ready: false }] }), null);
  });

  it("finds the tiers by RT1's names (Mid Bottom is not Mid), else by the stored ids", () => {
    assert.equal(tierOf("XMPL-WHSE · Retargeting · Mid Bottom", "x", "XMPL-WHSE", {}), "mid_bottom");
    assert.equal(tierOf("XMPL-WHSE · Retargeting · Mid", "x", "XMPL-WHSE", {}), "mid");
    assert.equal(tierOf("renamed in Ads Manager", "a9", "XMPL-WHSE", { bottom: "a9" }), "bottom");
    assert.equal(tierOf("XMPL-WHSE · Tickets · Lineup", "x", "XMPL-WHSE", {}), null);
  });

  it("reads the campaign, its 7-day frequency and each tier's delivery estimate, counting calls", async () => {
    const asked: string[] = [];
    const graphGet = async (path: string, params: Record<string, string>) => {
      asked.push(path);
      if (path === "/c1")
        return {
          effective_status: "ACTIVE",
          adsets: { data: [
            { id: "b", name: "XMPL-WHSE · Retargeting · Bottom", daily_budget: "1200", effective_status: "ACTIVE" },
            { id: "mb", name: "XMPL-WHSE · Retargeting · Mid Bottom", daily_budget: "600", effective_status: "ACTIVE" },
            { id: "m", name: "XMPL-WHSE · Retargeting · Mid", daily_budget: "600", effective_status: "ACTIVE" },
          ] },
        };
      if (path === "/c1/insights") {
        assert.deepEqual(JSON.parse(params.time_range!), { since: "2026-11-10", until: "2026-11-16" });
        return { data: [{ adset_id: "b", frequency: "4.31" }, { adset_id: "mb", frequency: "2.2" }, { adset_id: "m", frequency: "1.6" }] };
      }
      if (path === "/mb/delivery_estimate") throw new Error("rate limited");
      return { data: [{ estimate_ready: true, estimate_mau_lower_bound: 3900, estimate_mau_upper_bound: 4600 }] };
    };
    const read = await readRunning(graphGet, { campaignId: "c1", code: "XMPL-WHSE", since: "2026-11-10", until: "2026-11-16" });
    assert.equal(read.status, "ACTIVE");
    assert.equal(read.calls, 5);
    assert.equal(read.tiers.bottom!.frequency, 4.31);
    assert.equal(read.tiers.bottom!.dailyMinor, 1200);
    assert.equal(read.tiers.mid_bottom!.pool, null, "a failed estimate leaves the pool unread");
    assert.deepEqual(read.errors, ["delivery_estimate mid_bottom: rate limited"]);
    assert.deepEqual(asked, ["/c1", "/c1/insights", "/b/delivery_estimate", "/mb/delivery_estimate", "/m/delivery_estimate"]);
  });

  it("joins Meta's read to ad_daily_insights' 7 days per tier", () => {
    const live = liveRead(
      { status: "ACTIVE", tiers: { bottom: { adsetId: "b", dailyMinor: 1200, effectiveStatus: "ACTIVE", frequency: 4.3, pool: "3,900–4,600" } }, calls: 3, errors: [] },
      [
        { date: "2026-11-09", meta_adset_id: "b", spend: "50", purchases: "9" },
        { date: "2026-11-10", meta_adset_id: "b", spend: "40.20", purchases: "8" },
        { date: "2026-11-16", meta_adset_id: "b", spend: 42.2, purchases: 8 },
        { date: "2026-11-16", meta_adset_id: "other", spend: 99, purchases: 9 },
      ],
      "2026-11-10",
      "2026-11-16",
    )!;
    assert.deepEqual(live.tiers.bottom, { adsetId: "b", dailyMinor: 1200, frequency: 4.3, pool: "3,900–4,600", spendMinor: 8240, purchases: 16 });
  });
});

const PLATFORM: PurchaseRead = {
  state: "platform_under_bar",
  pixel: { id: "1067726194205285", source: "ad_sets", spendShare: 1, stored: "1067726194205285", matches: true },
  pixelName: "Warehouse Skiddle",
  otherPixels: [],
  domain: null,
  domainVia: null,
  domainKind: "no_own_domain",
  cirqlinPage: false,
  sharedWith: 0,
  ticketSite: "skiddle.com",
  landsOn: null,
  onDomain: null,
  pixelWide: null,
  historyDays: 28,
  platform: "Skiddle",
  platformShare: { purchases: 410, pixelPurchases: 512, share: 410 / 512, elsewhereHost: null, elsewherePurchases: 0 },
  attributedOnPixel: null,
  attributedPurchases: { count: 12, scope: "any_show_on_pixel" },
  ticketsSold14: null,
  notRead: null,
} as PurchaseRead;

const LIVE: LiveRead = {
  status: "ACTIVE",
  tiers: Object.fromEntries(RA.map((row) => [row.tier, { adsetId: row.adsetId, dailyMinor: row.budgetMinor, frequency: row.frequency, pool: row.pool, spendMinor: row.spendMinor, purchases: row.purchases }])) as LiveRead["tiers"],
};

function running(overrides: Partial<RetargetingInput> = {}, live: LiveRead = LIVE): RetargetingInput {
  return {
    eventId: "e",
    eventCode: "XMPL-WHSE",
    runDay: "2026-11-17",
    eventDate: "2026-12-19",
    onSaleDay: "2026-11-06",
    read: PLATFORM,
    last7SpendGbp: 1680,
    minDailyMinor: 100,
    sources: { pixelId: "1067726194205285", links: linksFallback({ ticket_url: "https://skiddle.com/x" }), videos: [], pages: [{ id: "p1", name: "XMPL", igId: null, kind: "promoter", hasRole: true }], lists: [] },
    existing: { campaignId: "c1", since: "2026-11-10", totalMinor: 2400, share: 10, live },
    legacy: [],
    budgetGbp: 4000,
    spendToDateGbp: 1500,
    committedGbp: null,
    main: null,
    ads: [],
    geoFromAdsetId: null,
    where: { draftId: null, adAccountId: null, campaignIds: [] },
    today: "2026-11-17",
    ...overrides,
  };
}

describe("RT3, RT6, RT7, RT9: the running panel", () => {
  it("RA's header, rows, total row, hold, move and footer", () => {
    const plan = planRetargeting(running());
    assert.equal(plan.state, "running");
    const view = plan.view.running!;
    assert.equal(view.totalMinor, 2400);
    assert.equal(view.share, 10, "£24 ÷ £240 = 10 %");
    assert.deepEqual(view.total, { spentMinor: 16590, budgetMinor: 2400, cost: 7.21, purchases: 23 });
    assert.equal(view.nextStep, "Next step: final month from Thu 19 Nov · payday from Thu 26 Nov · step heights: Matas");
    assert.equal(view.off, null);
    assert.deepEqual(plan.view.tiers.map((row) => [row.pool, row.frequency, row.cost, row.purchases]), [["3,900–4,600", 4.3, 5.15, 16], ["6,300–7,400", 2.2, 8.32, 5], ["180,000–212,000", 1.6, 20.95, 2]]);
    assert.equal(plan.budget!.title, "Mid → Mid Bottom");
    assert.equal(view.holds![0]!.title, "Bottom held");
  });

  it("RT9: an off campaign reads \"{code} · Retargeting is off.\" and proposes no budget line", () => {
    const plan = planRetargeting(running({}, { ...LIVE, status: "PAUSED" }));
    assert.equal(plan.view.running!.off, "XMPL-WHSE · Retargeting is off.");
    assert.equal(retargetingOff("XMPL-WHSE"), "XMPL-WHSE · Retargeting is off.");
    assert.equal(plan.budget, null);
  });

  it("RT7: the read carries on through show week to the show day", () => {
    // Show week: Mon 14 Dec to the show on Sat 19 Dec.
    for (const day of ["2026-12-14", "2026-12-17", "2026-12-19"]) {
      const plan = planRetargeting(running({ runDay: day, today: day }));
      assert.equal(plan.state, "running", day);
      assert.equal(plan.budget!.title, "Mid → Mid Bottom", day);
    }
  });

  it("RT6: the footer's dates — final month from 30 days out, payday from the Thursday before payday", () => {
    assert.deepEqual(nextRunIn("2026-11-17", "2026-12-19"), { step: { key: "final_month", label: "final month", daysOut: 30 }, from: "2026-11-19" });
    assert.equal(nextPaydayStart("2026-11-17", "2026-12-19"), "2026-11-26", "Fri 27 Nov is the last Friday: the window runs Thu 26 Nov – Sun 13 Dec");
    assert.equal(nextPaydayStart("2026-11-26", "2026-12-19"), null, "inside the window, the next one starts after the show");
    assert.deepEqual(nextSteps("2026-12-01", "2026-12-19"), [{ label: "final two weeks", from: "2026-12-05" }], "in the payday stretch; the next one starts after the show");
    assert.deepEqual(nextSteps("2026-12-13", "2026-12-19"), [], "show week: no step left to come");
    assert.ok(Object.values(STEP_HEIGHTS).every((value) => value === null), "steps stay off until Matas sets the heights");
  });
});

describe("RT5's write: the refresh's move apply", () => {
  async function applyLine(write: Record<string, unknown>, sets: Record<string, AdSetNow>) {
    const writes: string[] = [];
    const meta = {
      readAdSet: async (id: string) => (sets[id] ? { ...sets[id]! } : null),
      updateAdSetDailyBudget: async (id: string, minor: number) => void writes.push(`${id}:${minor}`),
    } as unknown as RefreshMeta;
    const mem = memoryDb(
      {
        events: [{ id: "e1", user_id: "u1", budget_marketing: 4000, event_date: "2026-12-19" }],
        event_daily_rollups: [{ event_id: "e1", date: "2026-11-18", ad_spend: 1500 }],
        onsale_refresh_proposals: [{ id: "p1", event_id: "e1", campaign_key: "XMPL-WHSE · Retargeting", campaign_ids: ["rc1"], window_end: "2026-11-18", cycle_monday: "2026-11-16" }],
        onsale_refresh_lines: [{ id: "cut", proposal_id: "p1", position: 2, kind: "move_budget", title: "Bottom", detail: "", write_text: "", narrow: null, adds_spend: false, blocked_reason: null, supply: false, state: "accepted", reason: null, target: {}, evidence: {}, write: { draftId: "d1", adAccountId: "act_9", campaignIds: ["rc1"], ...write }, applied_result: null }],
        campaign_drafts: [{ id: "d1", event_id: "e1", user_id: "u1", ad_account_id: "act_9", status: "published", meta_campaign_id: "main", import_campaign_id: null, creatives: [] }],
        launched_ad_sets: [{ meta_adset_id: "b", draft_id: "d1", meta_campaign_id: "rc1", event_id: "e1", interest_ids: null }],
        meta_write_idempotency: [],
      },
      { onsale_refresh_proposals: { table: "onsale_refresh_proposals", key: "proposal_id" } },
    );
    const env = { [APPLY_ENV]: "1", ENABLE_OPTIMISATION_WRITES: "1" };
    const deps: ApplyDeps = { db: mem.db, env, meta, copyFromDrive: async () => ({ ok: false, reason: "no Drive" }), upload: async () => ({}), now: new Date("2026-11-19T09:00:00Z") };
    await applyAccepted({ deps, eventId: "e1", userId: "u1", gates: applyGates(env, "live") });
    return { row: mem.tables.onsale_refresh_lines!.find((line) => line.id === "cut")!, writes };
  }
  const set = (id: string, daily: number): AdSetNow => ({ id, campaignId: "rc1", status: "ACTIVE", effectiveStatus: "ACTIVE", name: id, dailyBudget: daily });

  it("a cut back to the plan writes one side, £12.00 → £7.50", async () => {
    const { row, writes } = await applyLine({ kind: "retargeting_cut", fromAdsetId: "b", toAdsetId: null, amountGbp: 31.5, dailyMinor: 450 }, { b: set("b", 1200) });
    assert.equal(row.state, "applied", String(row.reason));
    assert.equal(row.reason, "£4.50 a day back to the plan");
    assert.deepEqual(writes, ["b:750"]);
  });

  it("a cut to a receiver writes both sides, giver first", async () => {
    const { row, writes } = await applyLine({ kind: "retargeting_cut", fromAdsetId: "b", toAdsetId: "mb", amountGbp: 31.5, dailyMinor: 450 }, { b: set("b", 1200), mb: set("mb", 899) });
    assert.equal(row.state, "applied", String(row.reason));
    assert.equal(row.reason, "£4.50 a day moved");
    assert.deepEqual(writes, ["b:750", "mb:1349"]);
  });

  it("a move is taken from the live budgets on its first apply", async () => {
    const { row, writes } = await applyLine({ kind: "retargeting_move", fromAdsetId: "b", toAdsetId: "mb", amountGbp: 20.93, dailyMinor: 299 }, { b: set("b", 1000), mb: set("mb", 600) });
    assert.equal(row.state, "applied", "the plan is taken from the live budget when nothing was stored");
    assert.deepEqual(writes, ["b:701", "mb:899"]);
  });
});

describe("HR4: the daily read writes the Move or Cut", () => {
  it("stores one move_budget line with the ledger's keys, R6's receiver, and expires it at the next read", async () => {
    const { writeRetargetingProposal } = await import("../runner.ts");
    const mem = memoryDb({ onsale_refresh_proposals: [], onsale_refresh_lines: [] }, { onsale_refresh_proposals: { table: "onsale_refresh_proposals", key: "proposal_id" } });
    const event = { id: "e1", event_code: "XMPL-WHSE", event_date: "2026-12-19", name: "XMPL", client_id: "c", general_sale_at: "2026-11-06", presale_at: null, status: "on_sale", budget_marketing: 4000 } as never;
    const where = { draftId: "d1", adAccountId: "act_9", campaignIds: ["rc1"] };
    const first = await writeRetargetingProposal(mem.db as never, { event, day: "2026-11-17", plan: planRetargeting(running()), mode: "live", userId: "u1", where, guard: { budget: 4000, spendToDate: 1500 } });
    const lines = mem.tables.onsale_refresh_lines!.filter((line) => line.proposal_id === first);
    assert.equal(lines.length, 1);
    const line = lines[0]!;
    assert.equal(line.kind, "move_budget");
    assert.equal(line.rule_id, "retargeting.move");
    assert.equal(line.title, "Mid → Mid Bottom");
    assert.equal(line.state, "to_review");
    assert.equal(line.blocked_reason, null, "£20.93 a week is inside R5's 20 % cap of £500.00 left");
    assert.deepEqual({ draftId: (line.write as Record<string, unknown>).draftId, campaignIds: (line.write as Record<string, unknown>).campaignIds, toAdsetId: (line.write as Record<string, unknown>).toAdsetId }, { draftId: "d1", campaignIds: ["rc1"], toAdsetId: "mb" });
    assert.equal((line.evidence as Record<string, unknown>).toCpr, 8.32);
    assert.deepEqual(mem.tables.onsale_refresh_proposals!.find((row) => row.id === first)!.campaign_ids, ["rc1"]);
    // The next morning's read: yesterday's unanswered line expires.
    await writeRetargetingProposal(mem.db as never, { event, day: "2026-11-18", plan: planRetargeting(running({ runDay: "2026-11-18", today: "2026-11-18" })), mode: "live", userId: "u1", where, guard: { budget: 4000, spendToDate: 1500 } });
    assert.equal(mem.tables.onsale_refresh_lines!.find((row) => row.id === line.id)!.state, "expired");
  });
});
