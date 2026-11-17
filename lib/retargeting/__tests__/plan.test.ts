/**
 * The Retargeting campaign, PR A (docs/design-record/2026-11-17-retargeting-campaign.html):
 * RT4's starting budget to the record's expected figures, RT2's tiers (no
 * person in two tiers), RT1 / RT8's states and strings, RT9's show-level
 * check and the words RT10 keeps off the panel. Pure: no database, no Meta.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { rbView, rdStates } from "../../../scripts/plan-frames/retargeting-fixtures.ts";
import { midBuildable, RT2, tierSpecs, tiersMatching, urlFragment, type SourceSet } from "../audiences.ts";
import { currentDailyMinor, daysToShow, fundHold, startingBudget } from "../budget.ts";
import { pickedShare, planRetargeting, retargetingOnSaleDay, retargetingState, signalPath, tierRows } from "../plan.ts";
import * as words from "../words.ts";

describe("RT4: the starting budget", () => {
  it("RA: current daily spend £240, 10 % is £24.00, split £12.00 / £6.00 / £6.00", () => {
    const start = startingBudget({ currentDailyMinor: currentDailyMinor(1680), share: 10, midBuildable: true })!;
    assert.deepEqual([start.totalMinor, start.tiers.bottom, start.tiers.mid_bottom, start.tiers.mid, start.atFloor], [2400, 1200, 600, 600, false]);
    assert.equal(words.createLine({ totalMinor: start.totalMinor, pct: 10, tiers: start.tiers, atFloor: false, floorMinor: 100 }), "£24.00 a day · 10 % of current daily spend · Bottom £12.00 · Mid Bottom £6.00 · Mid £6.00");
  });

  it("RB: £58.00 a day, 10 % is £5.80, split £2.90 / £1.45 / £1.45; 32 days to Fri 18 Dec is £185.60", () => {
    const start = startingBudget({ currentDailyMinor: currentDailyMinor(406), share: 10, midBuildable: true })!;
    assert.deepEqual([start.totalMinor, start.tiers.bottom, start.tiers.mid_bottom, start.tiers.mid], [580, 290, 145, 145]);
    assert.equal(daysToShow("2026-11-17", "2026-12-18"), 32);
    assert.equal(words.holdLine(580 * 32, 32, "from plan headroom"), "£185.60 to the show (32 days) · from plan headroom");
  });

  it("rounds the total down to the penny, and the odd penny goes to Bottom", () => {
    const start = startingBudget({ currentDailyMinor: 2401 * 10 + 9, share: 10, midBuildable: true })!;
    assert.equal(start.totalMinor, 2401);
    assert.deepEqual(start.tiers, { bottom: 1201, mid_bottom: 600, mid: 600 });
  });

  it("15 % and 20 % on the same spend", () => {
    assert.equal(startingBudget({ currentDailyMinor: 24000, share: 15, midBuildable: true })!.totalMinor, 3600);
    assert.equal(startingBudget({ currentDailyMinor: 24000, share: 20, midBuildable: true })!.totalMinor, 4800);
  });

  it("the £1 floor: a tier under it is lifted and the difference comes out of Bottom; the smallest total is £3.00", () => {
    const small = startingBudget({ currentDailyMinor: 2000, share: 10, midBuildable: true })!;
    assert.deepEqual([small.totalMinor, small.tiers.bottom, small.tiers.mid_bottom, small.tiers.mid, small.atFloor], [300, 100, 100, 100, true]);
    const lift = startingBudget({ currentDailyMinor: 3600, share: 10, midBuildable: true })!;
    // £3.60: 90p / 90p lifted to £1.00 each, Bottom gives the 20p: £1.60.
    assert.deepEqual([lift.totalMinor, lift.tiers.bottom, lift.tiers.mid_bottom, lift.tiers.mid], [360, 160, 100, 100]);
    assert.equal(words.createLine({ totalMinor: lift.totalMinor, pct: 10, tiers: lift.tiers, atFloor: lift.atFloor, floorMinor: lift.floorMinor }), "£3.60 a day · 10 % of current daily spend · Bottom £1.60 · Mid Bottom £1.00 · Mid £1.00 · £1 a tier minimum");
  });

  it("Meta's min_daily_budget wins when it's higher than £1.00", () => {
    const start = startingBudget({ currentDailyMinor: 2000, share: 10, minDailyMinor: 150, midBuildable: true })!;
    assert.deepEqual(start.tiers, { bottom: 150, mid_bottom: 150, mid: 150 });
    assert.equal(words.floorSuffix(150), " · £1.50 a tier minimum");
  });

  it("Mid can't be built: its 25 % goes to Bottom and Mid Bottom, 2 to 1", () => {
    const start = startingBudget({ currentDailyMinor: 24000, share: 10, midBuildable: false })!;
    assert.deepEqual(start.tiers, { bottom: 1600, mid_bottom: 800, mid: 0 });
  });

  it("no spend in 7 days: no budget, and the line says so", () => {
    assert.equal(startingBudget({ currentDailyMinor: 0, share: 10, midBuildable: true }), null);
    assert.equal(words.NO_SPEND, "No spend in the last 7 days to size a budget from.");
  });

  it("the money: headroom first, then a move out of the main campaign, inside 20 % of the plan left", () => {
    assert.deepEqual(fundHold({ holdMinor: 18560, budgetGbp: 4000, spendToDateGbp: 1500, committedGbp: 1000, main: null }), { holdMinor: 18560, headroom: 185.6, move: 0, capGbp: 500, capOf: "plan", fits: true, why: null });
    const over = fundHold({ holdMinor: 60000, budgetGbp: 4000, spendToDateGbp: 1500, committedGbp: 1000, main: null });
    assert.deepEqual([over.fits, over.why, over.capGbp], [false, "over_cap", 500]);
    const move = fundHold({ holdMinor: 30000, budgetGbp: 4000, spendToDateGbp: 1500, committedGbp: 2400, main: { lifetimeGbp: 3000, spentToDate: 1000, floorGbp: 1200 } });
    assert.deepEqual([move.fits, move.headroom, move.move], [true, 100, 200]);
    assert.deepEqual(fundHold({ holdMinor: 30000, budgetGbp: 4000, spendToDateGbp: 1500, committedGbp: 2500, main: null }).why, "no_money");
  });
});

const SET: SourceSet = {
  pixelId: "px",
  ticketUrl: "skiddle.com/e/1",
  pageUrl: "show.example/page",
  videos: [{ contextId: "page1", videoIds: ["v1", "v2"] }],
  pages: [
    { id: "p1", name: "Promoter", igId: "ig1", kind: "promoter", hasRole: true },
    { id: "p2", name: "Venue", igId: null, kind: "venue", hasRole: true },
    { id: "p3", name: "Mira Vale", igId: "ig3", kind: "lineup", hasRole: false },
  ],
  lists: [
    { metaAudienceId: "sig", name: "Signups", role: "signups", uploadedAt: "2026-11-10T09:00:00Z" },
    { metaAudienceId: "sim", name: "Similar", role: "similar", uploadedAt: "2026-11-10T09:00:00Z" },
    { metaAudienceId: "buy", name: "Buyers", role: "buyers", uploadedAt: "2026-11-01T09:00:00Z" },
  ],
};

describe("RT2: the tiers and their audiences", () => {
  it("one source set feeds every window: pixel 30 / 60, video 75 % 365, engagement 180", () => {
    const specs = tierSpecs(SET);
    const bottom = specs.find((spec) => spec.tier === "bottom")!;
    const midBottom = specs.find((spec) => spec.tier === "mid_bottom")!;
    const mid = specs.find((spec) => spec.tier === "mid")!;
    assert.deepEqual(bottom.includes.map((aud) => aud.key), ["bottom:ticket:30", "bottom:checkout:30", "list:sig", "list:sim"]);
    assert.deepEqual(bottom.excludes.map((aud) => aud.key), ["list:buy"]);
    assert.deepEqual(midBottom.includes.map((aud) => aud.key), ["mid_bottom:page:60", "mid_bottom:checkout:60"]);
    assert.deepEqual(midBottom.excludes.map((aud) => aud.key), [...bottom.includes.map((aud) => aud.key), "list:buy"]);
    assert.deepEqual(mid.includes.map((aud) => aud.key), ["mid:video:page1:1", "mid:fb:1", "mid:ig:1"]);
    assert.deepEqual(mid.excludes.map((aud) => aud.key), [...midBottom.includes.map((aud) => aud.key), ...bottom.includes.map((aud) => aud.key), "list:buy"]);
    // Pages with a role only; IG engagement on the pages that have an Instagram account.
    assert.deepEqual(mid.includes.find((aud) => aud.key === "mid:fb:1"), { key: "mid:fb:1", kind: "page_fb", pageIds: ["p1", "p2"], retentionDays: RT2.engagementDays });
    assert.deepEqual(mid.includes.find((aud) => aud.key === "mid:ig:1"), { key: "mid:ig:1", kind: "page_ig", pageIds: ["p1"], retentionDays: RT2.engagementDays });
  });

  it("Acceptance: no person can match two tiers' include-minus-exclude sets for one source set", () => {
    const specs = tierSpecs(SET);
    const keys = [...new Set(specs.flatMap((spec) => [...spec.includes, ...spec.excludes].map((aud) => aud.key)))];
    // Every subset of the audiences a person could be in (2^n, n = 10).
    for (let mask = 0; mask < 1 << keys.length; mask += 1) {
      const member = new Set(keys.filter((_, index) => mask & (1 << index)));
      assert.ok(tiersMatching(specs, member).length <= 1, `in two tiers: ${[...member].join(", ")}`);
    }
  });

  it("buyers are left out of every tier; signup and similar lists sit in Bottom only (RT2, open for Mid Bottom)", () => {
    const specs = tierSpecs(SET);
    for (const spec of specs) assert.ok(spec.excludes.some((aud) => aud.key === "list:buy"), spec.tier);
    assert.deepEqual(tiersMatching(specs, new Set(["list:sig", "mid_bottom:page:60"])), ["bottom"]);
    assert.deepEqual(tiersMatching(specs, new Set(["list:buy", "bottom:ticket:30"])), []);
  });

  it("more than 5 pages are chunked into sibling audiences, 200 videos to an audience", () => {
    const pages = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, igId: null, kind: "lineup" as const, hasRole: true }));
    const videos = [{ contextId: "c", videoIds: Array.from({ length: 201 }, (_, i) => `v${i}`) }];
    const mid = tierSpecs({ ...SET, pages, videos }).find((spec) => spec.tier === "mid")!;
    assert.deepEqual(mid.includes.map((aud) => aud.key), ["mid:video:c:1", "mid:video:c:2", "mid:fb:1", "mid:fb:2"]);
  });

  it("Mid can't be built with no page holding a role and no video", () => {
    assert.equal(midBuildable({ pages: [{ id: "p", name: "P", igId: null, kind: "lineup", hasRole: false }], videos: [] }), false);
    assert.equal(tierSpecs({ ...SET, pages: [], videos: [] }).some((spec) => spec.tier === "mid"), false);
  });

  it("pixel URL rules are host and path", () => {
    assert.equal(urlFragment("https://www.skiddle.com/whats-on/x/?utm=1"), "skiddle.com/whats-on/x");
  });
});

describe("RT1 / RT8: the states and the Create line", () => {
  it("RB, from the rules: the Create line, the split, the hold, the legacy note and all three missing states", () => {
    const view = rbView();
    const option = view.create!.options.find((row) => row.share === 10)!;
    assert.equal(view.title, "XMPL-ROOF · Retargeting");
    assert.equal(option.line, "£5.80 a day · 10 % of current daily spend · Bottom £2.90 · Mid Bottom £1.45 · Mid £1.45");
    assert.equal(option.split, "Bottom £2.90 · Mid Bottom £1.45 · Mid £1.45");
    assert.equal(option.hold, "£185.60 to the show (32 days) · from plan headroom");
    assert.deepEqual(view.create!.legacy, ["1 retargeting ad set already runs in XMPL-ROOF · Tickets: pause it once this is live."]);
    assert.equal(view.create!.writeText, "New campaign, audiences and ad sets through the Purchase create path · goes in live");
    const [bottom, midBottom, mid] = view.tiers;
    assert.deepEqual(bottom!.audiences, ["Ticket-link visitors · checkout starters · 30 days"]);
    assert.deepEqual(bottom!.missing.map((line) => [line.text, line.actions.map((a) => a.label)]), [["No signup list yet, so Bottom runs on ticket-link visitors and checkout starters only.", ["Upload the signup list"]]]);
    assert.deepEqual([bottom!.leavesOut, midBottom!.leavesOut, mid!.leavesOut], ["", "Bottom", "Mid Bottom · Bottom"]);
    assert.deepEqual(mid!.audiences, ["Video viewers 75 % · 365 days", "Page and Instagram engagers · 180 days · 3 of 4 pages"]);
    assert.deepEqual(mid!.missing.map((line) => [line.text, line.narrow]), [["Mira Vale isn't in Mid: your Facebook user has no role on the page. Granting ADVERTISE on it adds it at the next read.", "Mira Vale: no page role, not in Mid."]]);
    assert.deepEqual(view.notes.map((line) => [line.text, line.actions.map((a) => a.label)]), [["No ticketing connection, so buyers aren't left out and will keep seeing these ads.", ["Connect ticketing", "Upload a buyers list"]]]);
  });

  it("RD 393: the not-proposed states, each replacing the Create line, in the record's words", () => {
    assert.deepEqual(
      rdStates().map((view) => [view.state, view.notProposed, view.create]),
      [
        ["before_onsale", "Retargeting starts when the show goes on sale (Fri 20 Nov).", null],
        ["no_pixel", "No Retargeting campaign: these ads have no pixel to optimise on.", null],
        ["sells_elsewhere", "No Retargeting campaign: this pixel mostly sells on universe.com (74 % of 512 purchases in 28 days), not on Skiddle.", null],
        ["not_read", "Retargeting not proposed: purchases couldn't be read this run. The next run tries again.", null],
        ["no_spend", "No spend in the last 7 days to size a budget from.", null],
      ],
    );
  });

  it("None of RT8's missing sources blocks Create; the hold over the cap holds Accept with its sentence", () => {
    const view = rbView();
    assert.equal(view.create!.options.find((row) => row.share === 10)!.blocked, null);
    assert.deepEqual(pickedShare(view, 15), { ok: true, share: 15 });
    assert.deepEqual(pickedShare(view, 12), { ok: false, error: "Pick 10 %, 15 % or 20 %." });
    assert.deepEqual(pickedShare(view, null), { ok: true, share: null });
  });

  it("RT1's signal: own domain with a purchase in 28 days, else the platform path past T2's guard", () => {
    const base = { domain: "show.example", onDomain: { d14: 0, d28: 1, history: 3 } } as never;
    assert.equal(signalPath({ ...(base as object), state: "under_bar" } as never), "own_domain");
    assert.equal(signalPath({ ...(base as object), state: "under_bar", onDomain: { d14: 0, d28: 0, history: 3 } } as never), null);
    assert.equal(signalPath({ state: "platform_under_bar" } as never), "platform");
    assert.equal(signalPath({ state: "pixel_sells_elsewhere" } as never), "sells_elsewhere");
    assert.equal(words.signalLine("platform", { pixelName: "Warehouse Skiddle", domain: null }), "Attributed purchases on the Warehouse Skiddle pixel, shared with its other shows' sales");
    assert.equal(words.signalLine("own_domain", { pixelName: null, domain: "show.example" }), "Attributed purchases on show.example");
  });

  it("the on-sale date is presale when stored, else general sale", () => {
    assert.equal(retargetingOnSaleDay({ presale_at: "2026-11-06T10:00:00Z", general_sale_at: "2026-11-13T10:00:00Z" }), "2026-11-06");
    assert.equal(retargetingOnSaleDay({ presale_at: null, general_sale_at: "2026-11-13T10:00:00Z" }), "2026-11-13");
  });
});

describe("RT9: the check moves from campaign to show", () => {
  const read = { state: "platform_under_bar", pixel: { id: "px" } } as never;
  it("the show takes the campaign when it has one, its Create line is proposed, or the read failed", () => {
    const at = (over: Partial<Parameters<typeof retargetingState>[0]>) => retargetingState({ onSaleDay: "2026-11-06", runDay: "2026-11-17", eventDate: "2026-12-18", read, existing: false, last7SpendGbp: 100, ...over });
    assert.deepEqual(at({}), { state: "proposed", takes: true });
    assert.deepEqual(at({ existing: true }), { state: "running", takes: true });
    assert.deepEqual(at({ read: undefined }), { state: "not_read", takes: true });
    assert.deepEqual(at({ read: { state: "no_pixel", pixel: null } as never }), { state: "no_pixel", takes: false });
    assert.deepEqual(at({ read: { state: "pixel_sells_elsewhere", pixel: { id: "px" } } as never }), { state: "sells_elsewhere", takes: false });
    assert.deepEqual(at({ onSaleDay: "2026-11-20" }), { state: "before_onsale", takes: false });
  });

  it("the note's words", () => {
    assert.equal(words.runsInOwnCampaign("XMPL-WHSE"), "Retargeting runs in its own campaign, XMPL-WHSE · Retargeting.");
    assert.equal(words.legacyAdSets(2, "XMPL-ROOF · Tickets"), "2 retargeting ad sets already run in XMPL-ROOF · Tickets: pause them once this is live.");
  });

  it("names: the campaign and its three tier ad sets (RT1), and the Tests campaign left out of current daily spend", () => {
    assert.deepEqual(words.TIERS.map((tier) => words.tierAdSetName("XMPL-WHSE", tier)), ["XMPL-WHSE · Retargeting · Bottom", "XMPL-WHSE · Retargeting · Mid Bottom", "XMPL-WHSE · Retargeting · Mid"]);
    assert.equal(words.isRetargetingCampaignName("XMPL-WHSE · Retargeting", "XMPL-WHSE"), true);
    assert.equal(words.isRetargetingCampaignName("XMPL-WHSE · Retargeting · Bottom", "XMPL-WHSE"), true);
    assert.equal(words.isRetargetingCampaignName("[XMPL-WHSE] Retargeting", "XMPL-WHSE"), false);
    assert.equal(words.isTestsCampaignName("XMPL-WHSE · Tests · Video", "XMPL-WHSE"), true);
  });
});

describe("RT8: buyers lists and their age", () => {
  it("a hand-uploaded list says its age, and from 7 days asks for a new upload", () => {
    const rows = (uploadedAt: string) => tierRows({ sources: { ...SET, lists: [{ metaAudienceId: "buy", name: "Buyers", role: "buyers", uploadedAt }] }, ticketingLinked: false, today: "2026-11-17" } as never, { bottom: 100, mid_bottom: 100, mid: 100 }).notes.map((line) => line.text);
    assert.deepEqual(rows("2026-11-13T10:00:00Z"), ["Buyers list uploaded 13 Nov · 4 days old"]);
    assert.deepEqual(rows("2026-11-07T10:00:00Z"), ["Buyers list uploaded 7 Nov · 10 days old: upload it again so new buyers drop out"]);
  });
});

describe("RT10: words kept off the panel", () => {
  it("no ABO, CBO, IC, LPV, cost per sale, CAPI, Events API, advertiser ID or dataset in any panel string", () => {
    const strings = JSON.stringify([rbView(), rdStates(), planRetargeting]);
    for (const banned of [/\bABO\b/, /\bCBO\b/, /\bIC\b/, /\bLPV\b/, /cost per sale/i, /\bCAPI\b/, /Events API/, /advertiser ID/i, /\bdataset\b/i]) assert.equal(banned.test(strings.replace(/"[a-z_]+":/g, "")), false, String(banned));
  });
});
