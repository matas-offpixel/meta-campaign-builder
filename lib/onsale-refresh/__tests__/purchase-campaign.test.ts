/**
 * P4 PR A — the Purchase campaign line (docs/design-record/2026-11-14-purchase-campaigns.html,
 * PC1, PC2, HP1, HP2): PC1's checks in order and their words, PC3's picks,
 * ads and money, PF2's card exactly, the reads from the ad-days, and the
 * line on the main campaign. Nothing here writes to Meta.
 */
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { PF1_WHY, PF2_PLAN, PF_LOCKLEAD_MAIN } from "../../../scripts/plan-frames/refresh-fixtures.ts";
import { ONSALE_PHASE } from "../phase-config.ts";
import { daysInclusive, mainRow, money, pickAdSets, planPurchaseCampaign, planSentence, purchaseCampaignInput, reusedAds, runningForm, shortCampaign, type PcAdSet, type PcInput, type PcMain, type PcRow } from "../purchase-campaign.ts";
import { purchaseWhy, type PurchaseRead } from "../purchases.ts";
import { rejectReasonsFor, REJECT_REASONS } from "../line-states.ts";
import { fetchAdSetPixels, fetchCampaignBudgets, AD_SET_FIELDS } from "../purchase-read.ts";

const NX_PIXEL = "645185673672763";

function read(state: PurchaseRead["state"], count = 17): PurchaseRead {
  return {
    state,
    pixel: { id: NX_PIXEL, source: "ad_sets", spendShare: 1, stored: "1283861880364565", matches: false },
    pixelName: "NX Live Skiddle",
    otherPixels: [],
    domain: "locklead-newcastle.com",
    domainVia: "signup_url",
    domainKind: "own",
    cirqlinPage: false,
    sharedWith: 0,
    ticketSite: "Skiddle",
    landsOn: null,
    onDomain: { d14: 0, d28: 0, history: 0 },
    pixelWide: null,
    historyDays: 28,
    platform: "Skiddle",
    platformShare: { purchases: 677, pixelPurchases: 836, share: 677 / 836, elsewhereHost: "ra.co" },
    attributedOnPixel: { count, fromDay: "2026-11-06", sinceOnSale: true, total: { fromDay: "2026-11-06", purchases: count, spend: 0, byCampaign: [] } },
    attributedPurchases: { count: 21, scope: "any_show_on_pixel" },
    ticketsSold14: null,
    notRead: null,
  };
}

const base = (overrides: Partial<PcInput> = {}): PcInput => ({
  eventCode: "NX26-LOCKLEAD",
  eventName: "Locklead",
  runDay: "2026-11-16",
  eventDate: "2026-12-11",
  read: read("platform_proposed"),
  existing: null,
  main: PF_LOCKLEAD_MAIN,
  budgetGbp: null,
  spendToDateGbp: 349.53,
  committedGbp: null,
  ...overrides,
});

const set = (name: string, spend: number, results: number, purchases: number, delivering = true): PcAdSet => ({ adsetId: `id-${name}`, adsetIds: [`id-${name}`], name, spend, results, purchases, delivering });

describe("P4 PC1: when the Purchase campaign line is proposed, checked in order", () => {
  it("1. the signal: only the Proposed states go on (P26-BDAY reads under 15 with its 1; Locklead with its real count)", () => {
    assert.equal(planPurchaseCampaign(base({ read: read("platform_under_bar", 12) })).state, "not_proposed");
    assert.equal(planPurchaseCampaign(base({ read: read("under_bar", 6) })).state, "not_proposed");
    assert.equal(planPurchaseCampaign(base({ read: undefined })).state, "not_proposed");
    // HP2 acceptance: the purchase sentence itself is unchanged until the count reaches 15.
    assert.equal(PF1_WHY.purchase, "Purchase campaign not proposed — 1 purchase attributed to these ads in 14 days, under 15. The signal is shared: Skiddle sells every show on this pixel.");
    assert.equal(purchaseWhy(read("platform_under_bar", 12), false, ONSALE_PHASE).purchase, "Purchase campaign not proposed — 12 purchases attributed to these ads since 6 Nov, under 15. The signal is shared: Skiddle sells every show on this pixel.");
  });

  it("2. a Purchase campaign already delivering: running, nothing proposed, the sentence opens \"Purchase campaign running — \"", () => {
    const plan = planPurchaseCampaign(base({ existing: "[NX26-LOCKLEAD] Locklead - Purchase" }));
    assert.deepEqual([plan.state, plan.card, plan.sentence], ["running", null, null]);
    const why = purchaseWhy(read("platform_proposed"), false, ONSALE_PHASE);
    const running = runningForm(why.purchase, why.purchaseNarrow);
    assert.match(running.purchase, /^Purchase campaign running — 17 purchases attributed to these ads since 6 Nov, on pixel …2763\./);
    assert.match(running.purchaseNarrow, /^Purchase campaign running: 17 attributed since 6 Nov/);
  });

  it("3. nothing to copy: the main campaign needs two ad sets with 5 results or 5 purchases", () => {
    const thin: PcMain = { ...PF_LOCKLEAD_MAIN, adSets: [set("Lineup - Suggested", 217.77, 80, 8), set("Venue", 9, 3, 0)] };
    const plan = planPurchaseCampaign(base({ main: thin }));
    assert.equal(plan.state, "nothing_to_copy");
    assert.equal(plan.sentence, "On Sale has no two ad sets with 5 results or 5 purchases in 14 days to copy.");
    assert.equal(plan.sentenceNarrow, "Not enough in On Sale to copy.");
    assert.equal(planPurchaseCampaign(base({ main: null })).state, "nothing_to_copy");
  });

  it("4. time to learn: 14 days from the run day to the show, both included", () => {
    assert.equal(daysInclusive("2026-11-16", "2026-11-29"), 14);
    assert.equal(planPurchaseCampaign(base({ eventDate: "2026-11-29" })).state, "proposed");
    const close = planPurchaseCampaign(base({ eventDate: "2026-11-28" }));
    assert.equal(close.state, "too_close");
    assert.equal(close.sentence, "A Purchase campaign needs 14 days to learn; it would run 13 days before the show.");
    assert.equal(close.sentenceNarrow, "Too close to the show for a Purchase campaign.");
  });

  it("5. money to start it: £5 a day to the show must fit 20 % of the plan left, or of what the main campaign has left", () => {
    const noLifetime = planPurchaseCampaign(base({ main: { ...PF_LOCKLEAD_MAIN, lifetimeGbp: 400 } }));
    // 400 − 272.41 = 127.59 left; 20 % is £25.52; £5 × 26 days is £130.
    assert.equal(noLifetime.state, "no_money");
    assert.equal(noLifetime.sentence, "No budget to start it: £5 a day to the show needs £130; 20 % of what On Sale has left is £25.52.");
    assert.equal(noLifetime.sentenceNarrow, "No budget to start a Purchase campaign.");
    const plan = planPurchaseCampaign(base({ budgetGbp: 600, spendToDateGbp: 500, committedGbp: 0 }));
    assert.equal(plan.sentence, "No budget to start it: £5 a day to the show needs £130; 20 % of the plan left is £20.");
  });

  it("proposed only after all five; the order holds (a running campaign wins over a thin main campaign)", () => {
    assert.equal(planPurchaseCampaign(base()).state, "proposed");
    assert.equal(planPurchaseCampaign(base({ existing: "x", main: null })).state, "running");
    assert.equal(planPurchaseCampaign(base({ main: null, eventDate: "2026-11-20" })).state, "nothing_to_copy");
  });
});

describe("P4 PC3: the picks, the ads, the money", () => {
  it("one purchase pick (5+ purchases, cheapest per purchase) and one checkout pick (5+ results, cheapest per result)", () => {
    const picked = pickAdSets([set("A", 100, 50, 10), set("B", 50, 40, 6), set("C", 30, 30, 0), set("D", 5, 2, 0)], true)!;
    assert.deepEqual(picked.picks.map((pick) => [pick.role, pick.name]), [["purchase", "B"], ["checkout", "C"]]);
    assert.equal(picked.noPurchasePick, false);
  });

  it("deduplicated: when one ad set wins both it's \"Both picks\" and the checkout pick is the next cheapest", () => {
    const picked = pickAdSets([set("A", 50, 100, 10), set("B", 90, 60, 2), set("C", 200, 80, 0)], true)!;
    assert.deepEqual(picked.picks.map((pick) => [pick.role, pick.name]), [["both", "A"], ["checkout", "B"]]);
  });

  it("no ad set at 5 purchases: the two cheapest by cost per result, and no test", () => {
    const picked = pickAdSets([set("A", 50, 10, 1), set("B", 30, 12, 0), set("C", 90, 9, 4)], true)!;
    assert.deepEqual(picked.picks.map((pick) => [pick.role, pick.name]), [["checkout", "B"], ["checkout", "A"]]);
    assert.equal(picked.noPurchasePick, true);
    const plan = planPurchaseCampaign(base({ main: { ...PF_LOCKLEAD_MAIN, adSets: [set("A", 50, 10, 1), set("B", 30, 12, 0)] } }));
    assert.equal(plan.card!.picksNote, "No ad set has 5 purchases, so both are picked on cost per checkout");
    assert.equal(plan.card!.picksHeading, "Ad sets, copied from On Sale");
  });

  it("the own-domain path has no per-ad-set purchase count, so both are picked on cost per checkout", () => {
    const picked = pickAdSets([set("A", 100, 50, 10), set("C", 30, 30, 0)], false)!;
    assert.equal(picked.noPurchasePick, true);
  });

  it("retargeting is copied outside the test when it's delivering; 3 ad sets at most", () => {
    const plan = planPurchaseCampaign(base({ main: { ...PF_LOCKLEAD_MAIN, adSets: [...PF_LOCKLEAD_MAIN.adSets, set("Retargeting - Site visitors", 12, 3, 1)] } }));
    assert.deepEqual(plan.build!.picks.map((pick) => pick.role), ["purchase", "checkout", "retargeting"]);
    assert.equal(plan.card!.retargetingLine, "Retargeting: Retargeting - Site visitors · outside the test");
    assert.equal(plan.card!.header, "Creates 1 campaign · 3 ad sets · 3 ads · goes in live");
    const stopped = planPurchaseCampaign(base({ main: { ...PF_LOCKLEAD_MAIN, adSets: [...PF_LOCKLEAD_MAIN.adSets, set("Retargeting", 12, 3, 1, false)] } }));
    assert.equal(stopped.build!.picks.length, 2);
  });

  it("ads: delivering, convert score in the top half, best first, one per creative, 6 at most", () => {
    const ad = (name: string, convertScore: number | null, deliveringNow = true) => ({ adId: name, adsetId: "s", name, convertScore, deliveringNow });
    assert.deepEqual(reusedAds([ad("a", 10), ad("b", 90), ad("c", 50), ad("d", 70), ad("e", null), ad("f", 99, false)]).map((row) => row.name), ["b", "d"]);
    const many = Array.from({ length: 20 }, (_, i) => ad(`ad${i}`, i));
    assert.equal(reusedAds(many).length, 6);
    assert.deepEqual(reusedAds([ad("x", 40), ad("x", 60)]).map((row) => row.convertScore), [60]);
  });

  it("£10 a day when it fits; £5 when £10 a day to the show goes over the cap; £10 then reads \"over the cap\" and can't be picked", () => {
    const roomy = planPurchaseCampaign(base({ main: { ...PF_LOCKLEAD_MAIN, lifetimeGbp: 3000 } }));
    assert.equal(roomy.card!.defaultRate, 10);
    assert.deepEqual(roomy.card!.rates.map((row) => [row.label, row.fits]), [["£5 a day", true], ["£10 a day", true]]);
    assert.equal(roomy.card!.rateNote, null);
    const tight = PF2_PLAN.card!;
    assert.equal(tight.defaultRate, 5);
    assert.deepEqual(tight.rates.map((row) => [row.label, row.labelNarrow, row.fits]), [["£5 a day", "£5 a day", true], ["£10 a day, over the cap", "£10, over the cap", false]]);
    assert.deepEqual(Object.keys(tight.byRate), ["5"], "only a rate that fits has a build");
  });

  it("headroom first, then a named move out of the main campaign; the main campaign keeps its floor", () => {
    // £4,500 budget, £2,051.30 spent, £1,000 still committed: £1,448.70 headroom covers £10 × 26 = £260 outright.
    const covered = planPurchaseCampaign(base({ budgetGbp: 4500, spendToDateGbp: 2051.3, committedGbp: 1000 }));
    const ten = covered.build!.funding.find((row) => row.rate === 10)!;
    assert.deepEqual([ten.headroom, ten.move, covered.card!.defaultRate], [260, 0, 10]);
    assert.match(covered.card!.byRate["10"]!.budget, /All of it from plan headroom; On Sale's budget doesn't change\./);
    // £100 headroom: £160 moves out of On Sale.
    const split = planPurchaseCampaign(base({ budgetGbp: 4500, spendToDateGbp: 2051.3, committedGbp: 2348.7 }));
    const part = split.build!.funding.find((row) => row.rate === 10)!;
    assert.deepEqual([part.headroom, part.move, part.mainBefore, part.mainAfter], [100, 160, 1500, 1340]);
    assert.match(split.card!.byRate["10"]!.budget, /£100 from plan headroom \+ £160 from On Sale: lifetime £1,500 → £1,340\./);
    // The floor: spent £272.41 + 3 days at £35.33 = £378.40; a £400 lifetime can give £21.60, not £130.
    const floored = planPurchaseCampaign(base({ main: { ...PF_LOCKLEAD_MAIN, lifetimeGbp: 400 } }));
    assert.equal(floored.state, "no_money");
    const floorOnly = planPurchaseCampaign(base({ budgetGbp: 100000, spendToDateGbp: 0, committedGbp: 100000, main: { ...PF_LOCKLEAD_MAIN, lifetimeGbp: 400 } }));
    assert.equal(floorOnly.sentence, "No budget to start it: £5 a day to the show needs £130; On Sale keeps at least £378.40 and can give £21.60.");
  });
});

describe("P4 PC2: PF2's card, exactly (HP2's acceptance fixture)", () => {
  const card = PF2_PLAN.card!;
  it("the header, what it optimises on, the picks, the ads", () => {
    assert.equal(PF2_PLAN.state, "proposed");
    assert.equal(card.campaignName, "[NX26-LOCKLEAD] Locklead - Purchase");
    assert.equal(card.header, "Creates 1 campaign · 2 ad sets · 3 ads · goes in live");
    assert.equal(card.headerNarrow, "Creates 1 campaign · 2 ad sets · 3 ads · live");
    assert.equal(card.optimises, "Purchase on pixel …2763 (NX Live Skiddle), the standard event — the signal is shared on Skiddle. Advantage campaign budget, lifetime.");
    assert.equal(card.optimisesNarrow, "Purchase on pixel …2763, shared on Skiddle · tests Lineup - Suggested (per purchase) against Venue (per IC)");
    assert.equal(card.picksHeading, "Ad sets, copied from On Sale: one pick on each measure, tested against each other");
    assert.deepEqual(card.pickLines, [
      { label: "Purchase pick", text: "Lineup - Suggested · 8 attributed purchases · £27.22 each", aside: "(80 IC · £2.72 each)" },
      { label: "Checkout pick", text: "Venue · 13 IC · £1.44 each", aside: "(0 purchases)" },
    ]);
    assert.equal(card.retargetingLine, "No retargeting ad set in On Sale to copy.");
    assert.equal(card.adsHeading, "Ads, reused (On Sale's top half by convert score)");
    assert.equal(card.adsLine, "Artist - UGC 3 · Artist - Static · Artist - UGC 2 (same posts)");
  });

  it("the budget: £5 picked, 26 days × £5 = £130, all of it moved from On Sale, On Sale's floor, the writes", () => {
    assert.equal(card.rateNote, "£5 picked: £10 a day to 11 Dec is £260, over 20 % of what On Sale has left (£245.52)");
    const five = card.byRate["5"]!;
    assert.equal(five.budget, "From Apply (Mon 16 Nov) to the show, Fri 11 Dec 23:59: 26 days × £5 = £130 lifetime. No event budget, so all of it moves from On Sale: lifetime £1,500 → £1,370. On Sale keeps at least £378.40 (spent £272.41 + 3 days at £35.33). It scales from here on results.");
    assert.equal(five.writes, "Writes: campaign create (£130 lifetime) · 2 ad sets · 3 ads (launch path) · On Sale lifetime_budget £1,500 → £1,370");
    assert.equal(five.narrow, "£130 lifetime to 11 Dec, moved from On Sale");
    assert.equal(card.note, "This event has no budget, so only a move out of On Sale can fund it.");
    assert.equal(card.noteNarrow, "No event budget: only a move out of On Sale can fund it.");
    assert.equal(card.held, null);
  });

  it("the build PR B will write: the picks, the ads, the funding, the dates", () => {
    const build = PF2_PLAN.build!;
    assert.deepEqual([build.path, build.pixelId, build.customConversion, build.days, build.startDay, build.endDay, build.cap, build.capOf, build.floor, build.defaultRate], ["platform", NX_PIXEL, null, 26, "2026-11-16", "2026-12-11", 245.52, "main", 378.4, 5]);
    assert.deepEqual(build.picks.map((pick) => [pick.role, pick.adsetId]), [["purchase", "120252504502750755"], ["checkout", "120252504417580755"]]);
    assert.deepEqual(build.ads.map((row) => row.name), ["Artist - UGC 3", "Artist - Static", "Artist - UGC 2"]);
  });

  it("the own-domain path optimises on the per-show custom conversion, made on Accept (E1)", () => {
    const own = planPurchaseCampaign(base({ read: { ...read("proposed"), platform: null } }));
    assert.equal(own.card!.optimises, "NX26-LOCKLEAD · Purchase on locklead-newcastle.com, a custom conversion made on Accept. Advantage campaign budget, lifetime.");
    assert.deepEqual(own.build!.customConversion, { name: "NX26-LOCKLEAD · Purchase on locklead-newcastle.com", domain: "locklead-newcastle.com" });
    assert.match(own.card!.byRate["5"]!.writes, /^Writes: custom conversion NX26-LOCKLEAD · Purchase on locklead-newcastle\.com · campaign create/);
  });

  it("no ad with a convert score: the card says so and Accept is held", () => {
    const plan = planPurchaseCampaign(base({ main: { ...PF_LOCKLEAD_MAIN, ads: PF_LOCKLEAD_MAIN.ads.map((ad) => ({ ...ad, convertScore: null })) } }));
    assert.equal(plan.card!.held, "No ad in On Sale has a convert score yet, so there's nothing to reuse.");
  });
});

describe("P4 PF1 / PF2: the Budget block", () => {
  it("the plan sentence at both widths, only with an event budget", () => {
    assert.deepEqual(planSentence(4500, 2051.3, "2026-11-12"), { wide: "£4,500 for this event · £2,051.30 spent to 12 Nov · £2,448.70 left in the plan", narrow: "£4,500 · £2,051 spent · £2,449 left" });
    assert.equal(planSentence(null, 100, "2026-11-12"), null);
  });

  it("the main campaign's comparison row", () => {
    assert.deepEqual(mainRow(PF_LOCKLEAD_MAIN, "platform"), { campaignKey: "[NX26-LOCKLEAD] On Sale", detail: "6 – 12 Nov · £247.32 · 97 IC · £2.55 each · 8 attributed purchases" });
    assert.deepEqual(PF1_WHY.budget!.main, { campaignKey: "[P26-BDAY] Puzzle - 27 Dec - On Sale", detail: "30 Oct – 12 Nov · £669.95 · 76 IC · £8.82 each · 1 attributed purchase" });
  });

  it("figures and names", () => {
    assert.deepEqual([money(130), money(1370), money(272.41), money(378.4)], ["£130", "£1,370", "£272.41", "£378.40"]);
    assert.deepEqual([shortCampaign("[NX26-LOCKLEAD] On Sale"), shortCampaign("261204 Kream | [EBR26-KREAM] KREAM - On Sale"), shortCampaign("Plain")], ["On Sale", "KREAM - On Sale", "Plain"]);
  });
});

describe("P4 HP1: the reads from the event's ad-days", () => {
  const row = (over: Partial<PcRow>): PcRow => ({ meta_ad_id: "ad1", meta_adset_id: "s1", meta_campaign_id: "c1", date: "2026-11-12", ad_name: "Ad 1", adset_name: "Set 1", campaign_name: "[X] On Sale", spend: 10, landing_page_views: 0, purchases: 0, actions: [{ action_type: "omni_initiated_checkout", value: 2 }], optimization_goal: "OFFSITE_CONVERSIONS", promoted_event: "INITIATED_CHECKOUT", ...over });
  const args = (rows: PcRow[], over: Partial<Parameters<typeof purchaseCampaignInput>[0]> = {}) => ({
    rows,
    eventCode: "X",
    eventName: "Show",
    runDay: "2026-11-16",
    eventDate: "2026-12-20",
    windowStart: "2026-11-06",
    windowEnd: "2026-11-12",
    onSaleDay: "2026-11-01",
    read: read("platform_proposed"),
    scores: new Map([["Ad 1", 70]]),
    budgets: null,
    budgetGbp: null,
    spendToDateGbp: 0,
    draftOf: () => ({ draftId: "d1", adAccountId: "act_1" }),
    ...over,
  });

  it("step 2 reads a Purchase campaign off ad_daily_insights: OFFSITE_CONVERSIONS with PURCHASE, delivering in the 14 days", () => {
    const purchase = row({ campaign_name: "[X] Purchase", meta_campaign_id: "c2", promoted_event: "PURCHASE", date: "2026-11-10" });
    assert.equal(purchaseCampaignInput(args([row({}), purchase])).existing, "[X] Purchase");
    // NX26-IPC's case: its "Purchase – Copy" optimises for Add to cart, and its Purchase campaign stopped on 14 Oct.
    const addToCart = row({ campaign_name: "[X] Purchase – Copy", promoted_event: "ADD_TO_CART" });
    const old = row({ campaign_name: "[X] Purchase", promoted_event: "PURCHASE", date: "2026-10-14" });
    assert.equal(purchaseCampaignInput(args([row({}), addToCart, old])).existing, null);
  });

  it("the main campaign is the delivering IC or LPV campaign with the most spend; Signup and Purchase campaigns aren't it", () => {
    const rows = [
      row({ campaign_name: "[X] Signup", meta_campaign_id: "c9", promoted_event: "COMPLETE_REGISTRATION", spend: 500 }),
      row({ campaign_name: "[X] On Sale", spend: 40 }),
      row({ campaign_name: "[X] LPV", meta_campaign_id: "c3", optimization_goal: "LANDING_PAGE_VIEWS", promoted_event: null, spend: 20, landing_page_views: 9 }),
    ];
    const input = purchaseCampaignInput(args(rows));
    assert.deepEqual([input.main!.campaignKey, input.main!.resultEvent, input.main!.draftId], ["[X] On Sale", "initiate_checkout", "d1"]);
    const lpvOnly = purchaseCampaignInput(args([rows[0]!, rows[2]!]));
    assert.deepEqual([lpvOnly.main!.campaignKey, lpvOnly.main!.resultEvent, lpvOnly.main!.results], ["[X] LPV", "landing_page_view", 9]);
    assert.equal(purchaseCampaignInput(args([row({ date: "2026-11-05" })])).main, null, "nothing delivering on the window's last two days");
  });

  it("an ad set's purchases count on the resolved pixel only (T3); the 14 days start at the on-sale date when later", () => {
    const rows = [row({ purchases: 3 }), row({ meta_ad_id: "ad2", meta_adset_id: "s2", adset_name: "Set 2", purchases: 4 }), row({ date: "2026-11-02", purchases: 9 })];
    const budgets = { campaigns: new Map(), adSets: new Map([["s1", { campaignId: "c1", daily: null, lifetime: null, pixelId: NX_PIXEL }], ["s2", { campaignId: "c1", daily: null, lifetime: null, pixelId: "999" }]]) };
    const input = purchaseCampaignInput(args(rows, { budgets, onSaleDay: "2026-11-06" }));
    const bySet = Object.fromEntries(input.main!.adSets.map((s) => [s.name, s.purchases]));
    assert.deepEqual(bySet, { "Set 1": 3, "Set 2": 0 });
    assert.equal(input.main!.from, "2026-11-06");
  });

  it("what the live campaigns still have committed: lifetime left, or the daily rate × days to the show; unread is null", () => {
    const rows = [row({ spend: 100 }), row({ meta_campaign_id: "c2", campaign_name: "[X] Other", meta_adset_id: "s9", spend: 50 })];
    const budgets = { campaigns: new Map([["c1", { daily: null, lifetime: 1000 }], ["c2", { daily: 10, lifetime: null }]]), adSets: new Map() };
    // c1: 1000 − 100 = 900; c2: £10 × 35 days (16 Nov – 20 Dec) = 350.
    assert.equal(purchaseCampaignInput(args(rows, { budgets })).committedGbp, 1250);
    assert.equal(purchaseCampaignInput(args(rows, { budgets: { campaigns: new Map([["c1", { daily: null, lifetime: 1000 }]]), adSets: new Map() } })).committedGbp, null);
    assert.equal(purchaseCampaignInput(args(rows)).main!.lifetimeGbp, null);
    assert.equal(purchaseCampaignInput(args(rows, { budgets })).main!.lifetimeGbp, 1000);
  });

  it("the ad-set batch carries the budgets at no extra call; the campaign budgets are one batch per 50, counted", async () => {
    const calls: Record<string, string>[] = [];
    const multi = async (_path: string, params: Record<string, string>) => {
      calls.push(params);
      return Object.fromEntries(params.ids.split(",").map((id) => [id, { promoted_object: { pixel_id: NX_PIXEL }, campaign_id: "c1", daily_budget: "1450", lifetime_budget: "0" }]));
    };
    const sets = await fetchAdSetPixels(multi, ["s1", "s2"]);
    assert.equal(calls[0]!.fields, AD_SET_FIELDS);
    assert.deepEqual(sets.adSets.get("s1"), { campaignId: "c1", daily: 14.5, lifetime: null, pixelId: NX_PIXEL });
    const ids = Array.from({ length: 51 }, (_, i) => `c${i}`);
    const campaigns = await fetchCampaignBudgets(async (_path, params) => Object.fromEntries(params.ids.split(",").map((id) => [id, { lifetime_budget: "150000" }])), ids);
    assert.deepEqual([campaigns.calls, campaigns.campaigns.get("c3")], [2, { daily: null, lifetime: 1500 }]);
  });
});

describe("P4 PC2: Reject's new reason", () => {
  it("\"Not this show\" is offered on the Purchase campaign line only", () => {
    assert.equal(REJECT_REASONS.not_this_show, "Not this show");
    assert.ok(rejectReasonsFor("purchase_campaign").includes("not_this_show"));
    assert.ok(!rejectReasonsFor("add_creative").includes("not_this_show"));
    assert.deepEqual(rejectReasonsFor("move_budget"), ["too_early", "wrong_creative", "claim_not_right", "other"]);
  });
});

describe("P4 migration 242", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/242_onsale_refresh_purchase_campaign.sql", import.meta.url), "utf8");
  it("widens the kind and reject-reason checks, keeps every existing value, and touches nothing else", () => {
    assert.match(sql, /'add_creative', 'claim_ready', 'pause_creative', 'bring_back_audience', 'missing_default', 'drop_audience', 'move_budget', 'purchase_campaign'/);
    assert.match(sql, /'too_early', 'wrong_creative', 'claim_not_right', 'other', 'not_this_show'/);
    assert.doesNotMatch(sql, /add column|create table|drop table|meta_write_idempotency/i);
  });
});

describe("P4: the line and the Objective on the proposals", async () => {
  const { purchaseCampaignLine, withPurchaseCampaign } = await import("../rules.ts");
  const why = { objective: "Initiate Checkout — 97 reached the pixel since 6 Nov. Last 14 days: 97 IC.", ...purchaseWhy(read("platform_proposed"), false, ONSALE_PHASE) };
  const draft = { draftId: "d1", adAccountId: "act_1", copy: null };
  const budget = { plan: null, main: mainRow(PF_LOCKLEAD_MAIN, "platform") };
  const input = (isMain: boolean, plan = PF2_PLAN) => ({ campaignIds: ["c1"], adAccountId: "act_1", draft, purchaseCampaign: { plan, isMain, budget } }) as never;

  it("the line goes on the main campaign only, says what Accept builds, and stores the build for PR B", () => {
    assert.equal(purchaseCampaignLine(input(false)), null);
    const line = purchaseCampaignLine(input(true))!;
    assert.deepEqual([line.kind, line.ruleId, line.title, line.addsSpend, line.blockedReason], ["purchase_campaign", "purchase_campaign.proposed", "[NX26-LOCKLEAD] Locklead - Purchase", false, null]);
    assert.equal(line.writeText, PF2_PLAN.card!.byRate["5"]!.writes);
    assert.deepEqual([line.write!.kind, line.write!.dailyGbp, line.write!.draftId], ["purchase_campaign_create", 5, "d1"]);
    assert.equal((line.evidence.card as { campaignName: string }).campaignName, "[NX26-LOCKLEAD] Locklead - Purchase");
    assert.match(String(purchaseCampaignLine({ campaignIds: ["c1"], adAccountId: "act_1", draft: null, purchaseCampaign: { plan: PF2_PLAN, isMain: true, budget } } as never)!.blockedReason), /drafts/);
  });

  it("the Objective carries PC1's state, its sentence, the running form and the Budget block on every campaign", () => {
    const proposed = withPurchaseCampaign(why, input(false));
    assert.deepEqual(proposed.purchaseCampaign, { state: "proposed", sentence: null, sentenceNarrow: null });
    assert.deepEqual(proposed.budget, budget);
    assert.equal(proposed.purchase, why.purchase);
    const running = withPurchaseCampaign(why, input(true, planPurchaseCampaign(base({ existing: "[NX26-LOCKLEAD] Locklead - Purchase" }))));
    assert.match(running.purchase, /^Purchase campaign running — /);
    const close = withPurchaseCampaign(why, input(true, planPurchaseCampaign(base({ eventDate: "2026-11-28" }))));
    assert.equal(close.purchaseCampaign!.sentence, "A Purchase campaign needs 14 days to learn; it would run 13 days before the show.");
    assert.equal(withPurchaseCampaign(why, {} as never), why, "an input built before P4 is unchanged");
  });
});
