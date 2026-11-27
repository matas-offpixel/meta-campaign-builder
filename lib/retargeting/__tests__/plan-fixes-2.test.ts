/**
 * The 27 Nov plan's fixes (Matas, 27 Nov), one block each:
 *   1. the plan line's split is the budgets as they are: with Similar skipped,
 *      Similar £0.00 and Cold holding its share, as the build makes them;
 *   2–3. promoter Pages are the show's own brand's (show-brands.ts), never every
 *      Page the client owns, and never an act's Page.
 * The Louder / Parable hold is tested with the tools (retargeting-tools.test.ts).
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { fakeDb } from "../../mcp/__tests__/fake-db.ts";
import { FUNNEL_TIERS, funnelSpecs, type FunnelSources } from "../funnel.ts";
import { claudePlanLines, planFunnelShow, wordsSplit } from "../funnel-plan.ts";
import { planRetargeting, type RetargetingInput } from "../plan.ts";
import { isShowBrandPage, showBrandOf, SHOW_BRANDS } from "../show-brands.ts";
import { newShowPagesCache, readShowPages } from "../show-pages.ts";
import type { FunnelBuild } from "../funnel-apply.ts";

const SOURCES: FunnelSources = {
  pixelId: "px1",
  links: [
    { kind: "ticket", rule: "skiddle.com/e/1", host: "skiddle.com", name: "Skiddle", platform: "skiddle" },
    { kind: "landing", rule: "crqln.com/l/x", host: "crqln.com", name: "crqln.com/l/x", platform: null },
  ],
  accounts: [{ pageId: "500100", name: "Promoter", platform: "facebook", kind: "promoter", access: true }],
  videos: [],
  lists: [],
};

describe("fix 1: the plan line agrees with the skip line and the build", () => {
  it("every stretch, Similar skipped or not: the line's four amounts are the budgets, sum to Retargeting's total, and Similar is £0.00 when skipped", () => {
    const days = ["2026-10-01", "2026-10-20", "2026-10-29", "2026-11-12", "2026-11-28", "2026-12-05"];
    const group = { id: "g", genreFamily: "dnb", pageIds: ["100001"], igIds: [], confirmed: true };
    for (const runDay of days) {
      for (const spec of [{ twoCampaigns: true, genreFamily: null, pageGroup: null }, { twoCampaigns: true, genreFamily: "dnb", pageGroup: group }]) {
        const plan = planFunnelShow({ code: "AS26-MTL", runDay, showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: [{ id: "a", kind: "adset", name: "Broad", dailyMinor: 5829, adSets: 1 }], sources: SOURCES, spec });
        const line = claudePlanLines(plan, SOURCES, { wider: { lifetimeMinor: 0, dailyMinor: 0, daysLeft: 1, endDay: "2026-12-12", steps: [] } })[0]!;
        const m = /Similar £([\d,.]+) · Cold £([\d,.]+) · Warm £([\d,.]+) · Hot £([\d,.]+)/.exec(line)!;
        const amounts = m.slice(1, 5).map((v) => Math.round(Number(v.replace(/,/g, "")) * 100));
        assert.deepEqual(amounts, FUNNEL_TIERS.map((tier) => plan.tiers[tier]), runDay);
        assert.equal(amounts.reduce((a, b) => a + b, 0), plan.totalMinor, runDay);
        if (plan.similarSkip) assert.equal(amounts[0], 0, runDay);
      }
    }
  });

  it("AS26-MTL's shape: Similar £0.00 and Cold holding its share on the line, and the build makes no Similar ad set and no Similar money", () => {
    const input = {
      eventId: "e1", eventCode: "AS26-MTL", runDay: "2026-11-27", eventDate: "2026-12-12", onSaleDay: "2026-10-01", announceDay: "2026-09-29",
      read: { state: "platform_under_bar", pixel: { id: "px1" }, pixelName: "Pixel", platform: "Skiddle", domain: null } as never,
      last7SpendGbp: 200, minDailyMinor: null,
      sources: { pixelId: "px1", links: SOURCES.links, videos: [], pages: [{ id: "500100", name: "Promoter", igId: null, kind: "promoter", hasRole: true }], lists: [] },
      existing: null, legacy: [], budgetGbp: null, spendToDateGbp: 0, committedGbp: null, main: null,
      ads: [{ adId: "7001", name: "on sale" }], geoFromAdsetId: "5001", where: { draftId: "d1", adAccountId: "act_1", campaignIds: ["4001"] },
      prospecting: [{ id: "a", kind: "adset", name: "Broad", dailyMinor: 5829, adSets: 1 }], twoCampaigns: true, genreFamily: null, linksRead: "ok",
    } as RetargetingInput;
    const plan = planRetargeting(input);
    const build = plan.build as FunnelBuild;
    assert.equal(plan.funnel!.similarSkip, "no_genre");
    assert.equal(build.plan.tiers.similar, 0);
    assert.deepEqual(wordsSplit(plan.funnel!), build.plan.tiers);
    assert.ok(!funnelSpecs(build.sources, build.spec).some((spec) => spec.tier === "similar"));
    assert.ok(build.plan.tiers.cold > 0);
  });
});

describe("fixes 2–3: promoter Pages are the show's own brand's", () => {
  it("the map: EBR → Electric Bristol, NX → NX, ES → Electric Studios; another prefix takes the client's own name", () => {
    assert.deepEqual(SHOW_BRANDS.map((row) => [row.prefix, row.brand]), [["EBR", "Electric Bristol"], ["ES", "Electric Studios"], ["NX", "NX"]]);
    assert.equal(showBrandOf("EBR26-KREAM")?.brand, "Electric Bristol");
    assert.equal(showBrandOf("ES27-DAVEPEARCE")?.brand, "Electric Studios");
    assert.equal(showBrandOf("NX26-RUDIMENTAL")?.brand, "NX");
    assert.equal(showBrandOf("P26-BDAY"), null);
    assert.ok(isShowBrandPage("NX26-DOD", "Electric Brixton", "NX LOVES") && isShowBrandPage("NX26-DOD", "Electric Brixton", "NX Newcastle"));
    assert.ok(!isShowBrandPage("NX26-DOD", "Electric Brixton", "Electric Studios") && !isShowBrandPage("EBR26-KREAM", "Electric Brixton", "NX LOVES"));
    assert.ok(isShowBrandPage("P26-BDAY", "Puzzle", "Puzzle") && !isShowBrandPage("P26-BDAY", "Puzzle", "Enzo Siragusa"));
  });

  // One client running three brands (Electric Brixton's business), plus an act's Page the drafts ran ads from (PARTS).
  const bm = [
    { id: "100001", name: "Electric Bristol" },
    { id: "100002", name: "NX LOVES" },
    { id: "100003", name: "Electric Studios" },
    { id: "100004", name: "PARTS" },
    { id: "100005", name: "NX Newcastle" },
    { id: "100006", name: "Kream" },
  ];
  const graph = {
    graphGet: async (path: string) => {
      if (path === "/act_1/promote_pages") return { data: bm };
      if (path === "/bm-1/owned_pages") return { data: bm };
      if (path === "/bm-1/client_pages") return { data: [] };
      throw new Error(`unexpected GET ${path}`);
    },
    multiGet: async () => ({}),
  };
  const db = (eventId: string, artists: { id: string; name: string; meta_page_id: string | null }[], draftPages: string[]) =>
    fakeDb({
      clients: [{ id: "c-eb", default_page_ids: ["100002", "100003"] }],
      campaign_drafts: [{ event_id: eventId, draft_json: { settings: { metaPageId: draftPages[0] ?? null }, creatives: draftPages.map((pageId) => ({ identity: { pageId } })) } }],
      event_artists: artists.map((a, i) => ({ event_id: eventId, artist_id: a.id, billing_order: i + 1, is_headliner: i === 0 })),
      artists: artists.map((a) => ({ ...a, meta_page_name: null, instagram_handle: null })),
      creative_lab_artists: [],
    });
  const read = (code: string, artists: { id: string; name: string; meta_page_id: string | null }[], draftPages: string[]) =>
    readShowPages({ db: db("e-" + code, artists, draftPages) as never, graph: graph as never, event: { id: "e-" + code, client_id: "c-eb", clientName: "Electric Brixton", code }, venue: null, adAccountId: "act_1", businessIds: ["bm-1"], cache: newShowPagesCache() });

  it("EBR26-KREAM's shape: only Electric Bristol; NX LOVES and Electric Studios are other brands', PARTS isn't a brand, Kream is the act", async () => {
    const out = await read("EBR26-KREAM", [{ id: "a-kream", name: "Kream", meta_page_id: "100006" }], ["100002", "100003", "100004"]);
    assert.deepEqual(out.matched.brands, ["Electric Bristol"]);
    assert.deepEqual(out.matched.artists, ["Kream"]);
    assert.ok(!out.pages.some((p) => p.id === "100004"));
  });

  it("an NX show: NX LOVES and the NX venue Page; an ES show: Electric Studios", async () => {
    assert.deepEqual((await read("NX26-DOD", [], ["100002"])).matched.brands, ["NX LOVES", "NX Newcastle"]);
    assert.deepEqual((await read("ES27-DAVEPEARCE", [], ["100003"])).matched.brands, ["Electric Studios"]);
  });

  it("a brand with no Page of its own reads \"not matched\" — never every Page the client owns", async () => {
    const out = await readShowPages({ db: db("e-x", [], []) as never, graph: graph as never, event: { id: "e-x", client_id: "c-eb", clientName: "Electric Brixton", code: "XMPL26-SHOW" }, venue: null, adAccountId: "act_1", businessIds: ["bm-1"], cache: newShowPagesCache() });
    assert.deepEqual(out.matched.brands, []);
    assert.ok(!out.pages.some((p) => p.kind === "promoter"));
  });
});
