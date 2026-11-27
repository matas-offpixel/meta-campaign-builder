/**
 * The two-campaign plan's fixes from the 26 Nov dry run (Matas, 27 Nov;
 * scratch/retargeting/rollout-plan-2026-11-26.md), one block each:
 *   1. Pages matched as audience_sources matches them;
 *   2. no tier is ever negative; a tier with nothing to build hands its share on;
 *   3. Wider's lifetime is what the show has left, within its ceiling;
 *   4. existing prospecting is paused when Wider goes live;
 *   5. lifetime-budget prospecting counts;
 *   6. the purchase read doesn't skip a show for plan_retargeting, and a skip says its own reason;
 *   7. no optimising pixel: the event's, the venue's, the ad account's one active pixel.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { fakeDb } from "../../mcp/__tests__/fake-db.ts";
import { FUNNEL_TIERS, type FunnelSources, type ProspectingBudget } from "../funnel.ts";
import { claudePlanLines, createLines, fallbackPixelLine, foldUnbuildable, planFunnelShow, skipReason, skipLine, wordsSplit } from "../funnel-plan.ts";
import { NO_PIXEL_PURCHASES, nothingReaches, sellsElsewhere as sellsElsewhereSentence } from "../words.ts";
import { planRetargeting, remainingTo, type RetargetingInput } from "../plan.ts";
import { budgetFromMeta, fallbackPixelOf } from "../runner.ts";
import { planWider } from "../show-campaigns.ts";
import { newShowPagesCache, readShowPages } from "../show-pages.ts";

const SHOW = "2026-12-12";

describe("fix 1: plan_retargeting matches Pages as audience_sources does", () => {
  // NX26-RUDIMENTAL's shape: the client has no default Pages; the show's draft runs from NX LOVES; Rudimental has no Page id on file
  // but the ad account can promote a Page of that name, with its Instagram.
  const db = fakeDb({
    clients: [{ id: "c-nx", default_page_ids: [] }],
    campaign_drafts: [{ event_id: "e-rud", draft_json: { settings: { metaPageId: "500100" }, creatives: [{ identity: { pageId: "500100" } }] } }],
    event_artists: [{ event_id: "e-rud", artist_id: "a-rud", billing_order: 1, is_headliner: true }],
    artists: [{ id: "a-rud", name: "Rudimental", meta_page_id: null, meta_page_name: null, instagram_handle: null }],
    creative_lab_artists: [],
  });
  const graph = {
    graphGet: async (path: string) => {
      if (path === "/act_1/promote_pages") return { data: [{ id: "500100", name: "NX LOVES", instagram_business_account: { id: "ig500100" } }, { id: "600100", name: "Rudimental", instagram_business_account: { id: "ig600100" } }, { id: "700100", name: "Somebody Else" }] };
      if (path === "/bm-1/owned_pages") return { data: [{ id: "500100", name: "NX LOVES" }] };
      if (path === "/bm-1/client_pages") return { data: [] };
      if (path === "/600100") return { id: "600100", name: "Rudimental", tasks: ["ADVERTISE"] };
      throw new Error(`unexpected GET ${path}`);
    },
    multiGet: async () => ({}),
  };

  it("finds NX LOVES (promoter, with its Instagram) and Rudimental (lineup, by name, with its Instagram), both accessible", async () => {
    const out = await readShowPages({ db: db as never, graph: graph as never, event: { id: "e-rud", client_id: "c-nx", clientName: "Electric Brixton", code: "NX26-RUDIMENTAL" }, venue: null, adAccountId: "act_1", businessIds: ["bm-1"], cache: newShowPagesCache() });
    assert.deepEqual(out.pages, [
      { id: "500100", name: "NX LOVES", igId: "ig500100", kind: "promoter", hasRole: true },
      { id: "600100", name: "Rudimental", igId: "ig600100", kind: "lineup", hasRole: true },
    ]);
    assert.deepEqual(out.matched, { venue: null, brands: ["NX LOVES"], artists: ["Rudimental"] });
  });

  it("an act's own Page (a draft ran ads from it) is lineup, never promoter", async () => {
    const db2 = fakeDb({
      clients: [{ id: "c-nx", default_page_ids: [] }],
      campaign_drafts: [{ event_id: "e-rud", draft_json: { settings: { metaPageId: "500100" }, creatives: [{ identity: { pageId: "600100" } }] } }],
      event_artists: [{ event_id: "e-rud", artist_id: "a-rud", billing_order: 1, is_headliner: true }],
      artists: [{ id: "a-rud", name: "Rudimental", meta_page_id: null, meta_page_name: null, instagram_handle: null }],
      creative_lab_artists: [],
    });
    const out = await readShowPages({ db: db2 as never, graph: graph as never, event: { id: "e-rud", client_id: "c-nx", code: "NX26-RUDIMENTAL" }, venue: null, adAccountId: "act_1", businessIds: ["bm-1"], cache: newShowPagesCache() });
    assert.deepEqual(out.matched, { venue: null, brands: ["NX LOVES"], artists: ["Rudimental"] });
    assert.deepEqual(out.pages.map((p) => [p.id, p.kind]), [["500100", "promoter"], ["600100", "lineup"]]);
  });

  it("the venue's Page joins; with no graph, the Pages are listed with access unknown (and no Page name to match a brand on)", async () => {
    const out = await readShowPages({ db: db as never, graph: null, event: { id: "e-rud", client_id: "c-nx", code: "NX26-RUDIMENTAL" }, venue: { meta_page_id: "800100", meta_page_name: "O2 City Hall", name: "O2 City Hall Newcastle" }, adAccountId: "act_1", businessIds: [], cache: newShowPagesCache() });
    assert.deepEqual(out.pages.map((p) => [p.id, p.kind, p.hasRole]), [["800100", "venue", null]]);
    assert.equal(out.matched.venue, "O2 City Hall");
  });
});

const SOURCES_NO_ACCOUNTS: FunnelSources = {
  pixelId: "px1",
  links: [
    { kind: "ticket", rule: "skiddle.com/e/1", host: "skiddle.com", name: "Skiddle", platform: "skiddle" },
    { kind: "landing", rule: "crqln.com/l/x", host: "crqln.com", name: "crqln.com/l/x", platform: null },
  ],
  accounts: [],
  videos: [],
  lists: [],
};
const PROSPECTING: ProspectingBudget[] = [{ id: "as1", kind: "adset", name: "Broad", dailyMinor: 11990, adSets: 1 }];

describe("fix 2: no tier is ever negative; budgets and the line agree", () => {
  it("ES27-DAVEPEARCE's shape (no Similar group, no account audiences for Cold): Cold's share goes to Warm and the line says so", () => {
    const plan = planFunnelShow({ code: "ES27-DAVEPEARCE", runDay: "2026-11-26", showDay: "2027-03-20", announceDay: "2026-11-20", prospecting: PROSPECTING, sources: SOURCES_NO_ACCOUNTS, spec: { twoCampaigns: true, genreFamily: null, pageGroup: null } });
    for (const tier of FUNNEL_TIERS) assert.ok(plan.tiers[tier] >= 0 && wordsSplit(plan)[tier] >= 0, tier);
    assert.equal(FUNNEL_TIERS.reduce((sum, tier) => sum + wordsSplit(plan)[tier], 0), plan.totalMinor);
    assert.equal(plan.tiers.cold, 0);
    assert.deepEqual(plan.moved?.map((m) => [m.from, m.to]), [["cold", "warm"]]);
    const lines = claudePlanLines(plan, SOURCES_NO_ACCOUNTS, { wider: { lifetimeMinor: 0, dailyMinor: 0, daysLeft: 1, endDay: "2027-03-20", steps: [] } });
    assert.doesNotMatch(lines[0]!, /£-/);
    assert.ok(lines.some((line) => /^Cold has no audiences to build, so its £\d+\.\d{2} a day goes to Warm\.$/.test(line)));
  });

  it("every stretch, with and without Similar, with each tier missing in turn: never negative, and the line adds up", () => {
    const days = ["2026-10-01", "2026-10-20", "2026-10-29", "2026-11-12", "2026-11-28", "2026-12-05"];
    for (const runDay of days) {
      for (const spec of [{ twoCampaigns: true, genreFamily: null, pageGroup: null }, { twoCampaigns: true, genreFamily: "dnb", pageGroup: { id: "g", genreFamily: "dnb", pageIds: ["1"], igIds: [], confirmed: true } }]) {
        const plan = planFunnelShow({ code: "X", runDay, showDay: SHOW, announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES_NO_ACCOUNTS, spec });
        const words = wordsSplit(plan);
        for (const tier of FUNNEL_TIERS) assert.ok(plan.tiers[tier] >= 0 && words[tier] >= 0, `${runDay} ${tier}`);
        assert.equal(FUNNEL_TIERS.reduce((sum, tier) => sum + words[tier], 0), plan.totalMinor, runDay);
      }
    }
  });

  it("foldUnbuildable: warmer first, else back towards colder", () => {
    assert.deepEqual(foldUnbuildable({ similar: 10, cold: 20, warm: 40, hot: 30 }, ["similar", "warm", "hot"]).split, { similar: 10, cold: 0, warm: 60, hot: 30 });
    assert.deepEqual(foldUnbuildable({ similar: 0, cold: 30, warm: 40, hot: 30 }, ["cold", "warm"]).split, { similar: 0, cold: 30, warm: 70, hot: 0 });
  });
});

describe("fix 3: Wider's lifetime is what the show has left, within its ceiling", () => {
  it("ES27-DAVEPEARCE's shape: £2,500 ceiling, so Wider + spent + Retargeting to show day stay within it", () => {
    const spent = 40000;
    const leftMinor = 250000 - spent;
    const daysToShow = 30;
    const retargeting = 2997;
    const capMinor = leftMinor - retargeting * daysToShow;
    const w = planWider({ showDailyMinor: 11990, retargetingMinor: retargeting, runDay: "2026-11-26", showDay: "2026-12-25", adSets: 2, steps: [], remainingMinor: 11990 * daysToShow, capMinor });
    assert.equal(w.capped, true);
    assert.ok(spent + w.lifetimeMinor + retargeting * daysToShow <= 250000);
    assert.ok(w.lifetimeMinor < 1034195, "far under the £10,341.95 the 26 Nov run read");
  });

  it("with no cap, what prospecting has left less Retargeting to Wider's end; a lifetime budget counts only its part before Wider's end", () => {
    const w = planWider({ showDailyMinor: 6000, retargetingMinor: 2100, runDay: "2026-11-26", showDay: SHOW, adSets: 4, steps: [], remainingMinor: 6000 * 17 });
    assert.equal(w.lifetimeMinor, 6000 * 17 - 2100 * 17);
    const budgets: ProspectingBudget[] = [
      { id: "a", kind: "adset", name: "Broad", dailyMinor: 1000, adSets: 1, remainingMinor: 17000, endDay: null },
      { id: "b", kind: "campaign", name: "Lifetime", dailyMinor: 1000, adSets: 3, lifetime: true, remainingMinor: 34000, endDay: "2027-01-01" },
    ];
    // Wider ends at on-sale (presale, Fri 4 Dec, 9 days): the daily budget 9 days, the lifetime 9 of its 37 days.
    assert.equal(remainingTo(budgets, "2026-11-26", "2026-12-04", "2027-02-13"), 1000 * 9 + Math.floor((34000 * 9) / 37));
  });

  it("the plan says when the ceiling caps Wider, and when the show has none", () => {
    const plan = planFunnelShow({ code: "ES27-X", runDay: "2026-11-26", showDay: SHOW, announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES_NO_ACCOUNTS, spec: { twoCampaigns: true } });
    const base = { lifetimeMinor: 50000, dailyMinor: 2941, daysLeft: 17, endDay: SHOW, steps: [] };
    assert.ok(createLines(plan, { ...base, capped: { ceilingGbp: 2500 } }, false).lines.includes("Wider is capped at £500.00 lifetime, so ES27-X’s committed spend stays within its £2,500.00 ceiling."));
    assert.ok(createLines(plan, { ...base, noCeiling: true }, false).lines.includes("ES27-X has no spend ceiling, so both campaigns can only be made paused until Matas sets one."));
    // The real ES27-DAVEPEARCE: £29.97 a day for 115 days passes £2,500 on its own, so Wider gets nothing and the plan says so.
    assert.ok(createLines(plan, { ...base, lifetimeMinor: 0, capped: { ceilingGbp: 2500, over: true } }, false).lines.includes(`Retargeting alone, £${(plan.totalMinor / 100).toFixed(2)} a day to the show, would take ES27-X over its £2,500.00 ceiling, so Wider gets nothing and neither campaign can go live until Matas raises the ceiling.`));
  });
});

describe("fix 5: lifetime-budget prospecting counts", () => {
  it("a lifetime budget: its budget_remaining over the days to its end (else show day); a daily one × its days", () => {
    const args = { id: "1", kind: "campaign" as const, name: "Prospecting", adSets: 3, campaignId: "1", today: "2026-11-26", showDay: SHOW };
    assert.deepEqual(budgetFromMeta({ lifetime_budget: "300000", budget_remaining: "170000" }, args), { id: "1", kind: "campaign", name: "Prospecting", adSets: 3, campaignId: "1", endDay: null, dailyMinor: 10000, lifetime: true, remainingMinor: 170000 });
    assert.equal(budgetFromMeta({ lifetime_budget: "300000", budget_remaining: "100000", stop_time: "2026-12-05T23:59:00+0000" }, args)?.dailyMinor, 10000);
    assert.equal(budgetFromMeta({ daily_budget: "3600" }, args)?.remainingMinor, 3600 * 17);
    assert.equal(budgetFromMeta({ lifetime_budget: "300000", budget_remaining: "0" }, args), null);
  });
});

/** A show the purchase read rules out for the on-sale refresh: its pixel mostly sells on another ticket site. */
function sellsElsewhere(over: Partial<RetargetingInput> = {}): RetargetingInput {
  return {
    eventId: "e1",
    eventCode: "NX26-DOD",
    runDay: "2026-11-26",
    eventDate: SHOW,
    onSaleDay: "2026-10-01",
    announceDay: "2026-09-29",
    read: { state: "pixel_sells_elsewhere", pixel: { id: "px1" }, pixelName: "NX Skiddle", platform: "Universe", platformShare: { purchases: 0, pixelPurchases: 1539, share: 0, elsewhereHost: "skiddle.com", elsewherePurchases: 1530 }, domain: null } as never,
    last7SpendGbp: 420,
    minDailyMinor: null,
    sources: { pixelId: "px1", links: SOURCES_NO_ACCOUNTS.links, videos: [], pages: [{ id: "500100", name: "NX LOVES", igId: null, kind: "promoter", hasRole: true }], lists: [] },
    existing: null,
    legacy: [],
    budgetGbp: null,
    spendToDateGbp: 0,
    committedGbp: null,
    main: null,
    ads: [{ adId: "7001", name: "DOD · on sale" }],
    geoFromAdsetId: "500100",
    where: { draftId: "d1", adAccountId: "act_1", campaignIds: ["4001"] },
    prospecting: [{ id: "as1", kind: "adset", name: "Broad", dailyMinor: 6000, adSets: 1 }],
    twoCampaigns: true,
    linksRead: "ok",
    ...over,
  };
}

describe("fix 6: the purchase read doesn't skip a show for plan_retargeting; the 08:00 read keeps its rule", () => {
  it("connector: proposed; the 08:00 read: not proposed, as before", () => {
    assert.equal(planRetargeting(sellsElsewhere({ connector: true })).state, "proposed");
    assert.equal(planRetargeting(sellsElsewhere()).state, "sells_elsewhere");
  });

  it("a skip says its own reason, never \"no prospecting budget\" by default", () => {
    const base = { archived: false, built: false, runDay: "2026-11-26", showDay: SHOW, pixelId: "px1", hasTicketLink: true, plan: null };
    assert.equal(skipReason({ ...base, state: "sells_elsewhere" }), "ruled_out");
    assert.equal(skipReason({ ...base, state: "links_failed" }), "links_failed");
    assert.equal(skipReason({ ...base, state: "no_money" }), "no_budget");
    assert.equal(skipLine("NX26-DOD", "links_failed"), "NX26-DOD · skipped: its links couldn’t be read from CIRQLIN just now.");
    assert.equal(skipLine("NX26-DOD", "not_read"), "NX26-DOD · skipped: its purchases couldn’t be read just now.");
    assert.equal(skipLine("NX26-DOD", "links_no_page"), "NX26-DOD · skipped: its CIRQLIN page isn’t published.");
  });
});

describe("fix 7: no optimising pixel", () => {
  it("the event's pixel, else the venue's, else the ad account's one active pixel; none when the account has two or none", async () => {
    const graph = (pixels: { id: string; is_unavailable?: boolean }[]) => ({ graphGet: async () => ({ data: pixels }), multiGet: async () => ({}) }) as never;
    assert.deepEqual((await fallbackPixelOf({ event: "111111", venue: "222222", account: "act_1", graph: graph([]), cache: new Map() })).pixel, { id: "111111", source: "event" });
    assert.deepEqual((await fallbackPixelOf({ event: null, venue: "222222", account: "act_1", graph: graph([]), cache: new Map() })).pixel, { id: "222222", source: "venue" });
    assert.deepEqual((await fallbackPixelOf({ event: null, venue: null, account: "act_1", graph: graph([{ id: "333333" }, { id: "444444", is_unavailable: true }]), cache: new Map() })).pixel, { id: "333333", source: "account" });
    assert.equal((await fallbackPixelOf({ event: null, venue: null, account: "act_1", graph: graph([{ id: "333333" }, { id: "555555" }]), cache: new Map() })).pixel, null);
  });

  it("a show whose ads optimise on no pixel is planned on the fallback; with none it's skipped for no pixel", () => {
    const noPixel = { state: "no_pixel", pixel: null } as never;
    const planned = planRetargeting(sellsElsewhere({ connector: true, read: noPixel, fallbackPixel: { id: "333333", source: "account" }, sources: { ...sellsElsewhere().sources, pixelId: "333333" } }));
    assert.equal(planned.state, "proposed");
    assert.equal((planned.build as { pixelId: string }).pixelId, "333333");
    assert.equal(planRetargeting(sellsElsewhere({ connector: true, read: noPixel, fallbackPixel: null })).state, "no_pixel");
  });
});

describe("design's verdict on #1406 (27 Nov): a ruled-out show says its own refresh-panel sentence; the fallback pixel is said", () => {
  it("each of ruled_out's states: the panel's sentence without its opener and full stop, apostrophes curly; never \"the purchase read rules it out\"", () => {
    assert.equal(skipLine("NX26-DOD", "ruled_out", NO_PIXEL_PURCHASES), "NX26-DOD · skipped: this pixel has had no purchases in 28 days.");
    assert.equal(skipLine("NX26-DOD", "ruled_out", sellsElsewhereSentence({ host: "skiddle.com", pct: 99, purchases: 1539, platform: "Universe" })), "NX26-DOD · skipped: this pixel mostly sells on skiddle.com (99 % of 1,539 purchases in 28 days), not on Universe.");
    assert.equal(skipLine("XMPL-ROOF", "ruled_out", nothingReaches("xmpl-roof.com")), "XMPL-ROOF · skipped: no purchase has reached xmpl-roof.com in 28 days, and the ticket link isn’t on a ticket platform.");
    // no_signal: the panel is silent; design's words for its two causes (27 Nov).
    assert.equal(skipLine("XMPL-QUIET", "ruled_out", null, "no_signal_path"), "XMPL-QUIET · skipped: its pixel’s purchases can’t be tied to a site or ticket link of its own.");
    assert.equal(skipLine("XMPL-UNDATED", "ruled_out", null, "no_show_date"), "XMPL-UNDATED · skipped: it has no show date to plan to.");
    for (const detail of [NO_PIXEL_PURCHASES, null]) assert.doesNotMatch(skipLine("X", "ruled_out", detail), /rules it out/);
    // The 08:00 read's sells-elsewhere show, as plan_retargeting's skip would read it.
    const plan = planRetargeting(sellsElsewhere());
    assert.equal(skipLine("NX26-DOD", "ruled_out", plan.view.notProposed), "NX26-DOD · skipped: this pixel mostly sells on skiddle.com (99 % of 1,539 purchases in 28 days), not on Universe.");
  });

  it("the pixel line, after the plan line, whenever the fallback is used", () => {
    assert.equal(fallbackPixelLine({ id: "333333", source: "event" }), "Pixel: 333333, the event’s pixel, as the show’s ads optimise on none.");
    assert.equal(fallbackPixelLine({ id: "333333", source: "venue" }), "Pixel: 333333, the venue’s pixel, as the show’s ads optimise on none.");
    assert.equal(fallbackPixelLine({ id: "333333", source: "account" }), "Pixel: 333333, the ad account’s only active pixel, as the show’s ads optimise on none.");
    const plan = planFunnelShow({ code: "AS26-MTL", runDay: "2026-11-26", showDay: SHOW, announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES_NO_ACCOUNTS, spec: { twoCampaigns: true } });
    const wider = { lifetimeMinor: 0, dailyMinor: 0, daysLeft: 1, endDay: SHOW, steps: [] };
    const lines = claudePlanLines(plan, SOURCES_NO_ACCOUNTS, { wider, fallbackPixel: { id: "333333", source: "account" } });
    assert.equal(lines[1], "Pixel: 333333, the ad account’s only active pixel, as the show’s ads optimise on none.");
    assert.ok(!claudePlanLines(plan, SOURCES_NO_ACCOUNTS, { wider }).some((line) => line.startsWith("Pixel: ")));
  });
});

describe("design (27 Nov): no_signal's two causes", () => {
  it("no show date: the skip says it has no show date to plan to", () => {
    assert.equal(skipReason({ archived: false, built: false, runDay: "2026-11-27", showDay: null, pixelId: "px1", hasTicketLink: true, plan: null }), "no_show_date");
    assert.equal(skipLine("XMPL-UNDATED", "no_show_date"), "XMPL-UNDATED · skipped: it has no show date to plan to.");
  });

  it("no signal path: the 08:00 read's own (its plan carries the cause); plan_retargeting and create_show_campaigns never print it", () => {
    // An own domain nothing reached in 28 days, with a ticket platform too: the record is silent, so no signal path.
    const silent = { state: "under_bar", pixel: { id: "px1" }, pixelName: "Pixel", domain: "xmpl.com", onDomain: { d14: 0, d28: 0, history: 3 }, platform: "Skiddle" } as never;
    const read08 = planRetargeting(sellsElsewhere({ read: silent }));
    assert.equal(read08.state, "no_signal");
    assert.equal(read08.cause, "no_signal_path");
    assert.equal(skipLine("NX26-DOD", "ruled_out", read08.view.notProposed, read08.cause), "NX26-DOD · skipped: its pixel’s purchases can’t be tied to a site or ticket link of its own.");
    const connector = planRetargeting(sellsElsewhere({ read: silent, connector: true }));
    assert.equal(connector.state, "proposed");
    assert.equal(connector.cause, undefined);
  });
});
