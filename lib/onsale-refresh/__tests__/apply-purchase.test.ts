/**
 * P4 PR B — the Purchase campaign's create path (PC3, PC5's Purchase campaign
 * words, HP3), on fakes only: no Meta call is real. The six steps in order,
 * all or nothing for spend; the gates; the plan and floor at apply time; a
 * failure at each step leaves everything paused and the main budget alone;
 * Retry picks up and never makes a second campaign.
 */
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { PF2_PLAN } from "../../../scripts/plan-frames/refresh-fixtures.ts";
import { applyPurchaseCampaign, appliedText, CREATE_SWITCHED_OFF, failedAtSwitchOn, failedBeforeLive, MOVE_SWITCHED_OFF, purchaseAdSetPayload, showEndTime, type PurchaseMeta } from "../apply-purchase.ts";
import { pickedRate } from "../decide.ts";
import { appliesNow, writeGateOpen } from "../line-states.ts";
import { memoryDb } from "./memory-db.ts";

const MAIN = "120252504416990755";
const ON = { ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED: "1", ONSALE_REFRESH_LIFETIME_BUDGET_WRITES_ENABLED: "1" };
const SOURCE_TARGETING = { geo_locations: { cities: [{ key: "Newcastle" }] }, age_min: 18, excluded_custom_audiences: [{ id: "ex1" }], publisher_platforms: ["facebook", "instagram"] };

function fakeMeta(overrides: Partial<Record<keyof PurchaseMeta, (...args: never[]) => unknown>> = {}) {
  const calls: [string, ...unknown[]][] = [];
  let next = 0;
  const id = (prefix: string) => `${prefix}${++next}`;
  let mainLifetime = 150000;
  const meta: PurchaseMeta = {
    async readAdSetForCopy(adsetId) {
      calls.push(["readAdSetForCopy", adsetId]);
      return { id: adsetId, name: adsetId, targeting: SOURCE_TARGETING, billing_event: "IMPRESSIONS", attribution_spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }, { event_type: "VIEW_THROUGH", window_days: 1 }], destination_type: "WEBSITE", daily_budget: "900", optimization_goal: "OFFSITE_CONVERSIONS", promoted_object: { pixel_id: "645185673672763", custom_event_type: "INITIATED_CHECKOUT" } };
    },
    async readCampaignBudget(campaignId) {
      calls.push(["readCampaignBudget", campaignId]);
      return { daily: null, lifetime: campaignId === MAIN ? mainLifetime : null };
    },
    async readAd(adId) {
      calls.push(["readAd", adId]);
      return { id: adId, name: `name-${adId}`, creativeId: `cr-${adId}`, effectiveStatus: "ACTIVE", objectStoryId: `page_post-${adId}` };
    },
    async createCreativeFromPost(adAccountId, spec) {
      calls.push(["createCreativeFromPost", adAccountId, spec]);
      return id("crnew");
    },
    async createCampaign(adAccountId, payload) {
      calls.push(["createCampaign", adAccountId, payload]);
      return id("camp");
    },
    async createAdSet(adAccountId, payload) {
      calls.push(["createAdSet", adAccountId, payload]);
      return id("set");
    },
    async createAd(adAccountId, ad) {
      calls.push(["createAd", adAccountId, ad]);
      return id("ad");
    },
    async updateCampaign(campaignId, fields) {
      calls.push(["updateCampaign", campaignId, fields]);
      if (campaignId === MAIN && fields.lifetime_budget != null) mainLifetime = fields.lifetime_budget;
    },
    async setAdSetActive(adsetId) {
      calls.push(["setAdSetActive", adsetId]);
    },
    async findCustomConversion(adAccountId, name) {
      calls.push(["findCustomConversion", adAccountId, name]);
      return null;
    },
    async createCustomConversion(adAccountId, spec) {
      calls.push(["createCustomConversion", adAccountId, spec]);
      return id("cc");
    },
    ...(overrides as Partial<PurchaseMeta>),
  };
  return { meta, calls, writes: () => calls.filter(([name]) => /^(create|update|set)/.test(name)) };
}

const BUILD = PF2_PLAN.build!;
const LINE = (over: Record<string, unknown> = {}) => ({ id: "l1", write: { kind: "purchase_campaign_create", dailyGbp: 5, ...BUILD, ...over }, applied_result: null as Record<string, unknown> | null });

function setup(env: Record<string, string | undefined> = ON, plan: { budget: number | null; spend: number } = { budget: null, spend: 0 }) {
  const mem = memoryDb({ onsale_refresh_lines: [{ id: "l1", state: "applying" }], meta_write_idempotency: [] });
  const ledger = { supabase: mem.db, userId: "u1", draftId: "d1", eventId: "e1" };
  return { mem, deps: (meta: PurchaseMeta) => ({ db: mem.db, env, meta, plan: { ...plan, today: "2026-11-16", appliedMovesGbp: 0 }, mainSpentNow: 272.41 }), ctx: { ledger, adAccountId: "act_1073273492854557", plainMetaReason: (err: unknown) => (err instanceof Error ? err.message : String(err)) } };
}

describe("P4 PR B: the gates, all before any write", () => {
  it("the campaign-create gate off (the default): nothing written, the line says so", async () => {
    const fake = fakeMeta();
    const { deps, ctx } = setup({});
    const out = await applyPurchaseCampaign(deps(fake.meta), LINE(), ctx);
    assert.equal(out.state, "failed");
    assert.equal(out.reason, `${CREATE_SWITCHED_OFF}. On Sale's budget is unchanged.`);
    assert.deepEqual(fake.writes(), []);
  });

  it("money moves out of On Sale but the lifetime-budget gate is off: nothing written", async () => {
    const fake = fakeMeta();
    const { deps, ctx } = setup({ ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED: "1" });
    const out = await applyPurchaseCampaign(deps(fake.meta), LINE(), ctx);
    assert.equal(out.reason, `${MOVE_SWITCHED_OFF}. On Sale's budget is unchanged.`);
    assert.deepEqual(fake.writes(), []);
  });

  it("the panel's gate: Apply counts the line only with the create gate on", () => {
    assert.equal(writeGateOpen({ kind: "purchase_campaign", state: "accepted" }, { pauseWritesEnabled: false }), false);
    assert.equal(writeGateOpen({ kind: "purchase_campaign", state: "accepted" }, { pauseWritesEnabled: false, campaignCreateEnabled: true }), true);
    assert.equal(appliesNow({ kind: "purchase_campaign", state: "accepted" }, { pauseWritesEnabled: false, campaignCreateEnabled: true }), true);
  });
});

describe("P4 PR B: the six steps, in order", () => {
  it("custom conversion (none here) → campaign paused → ad sets paused → ads → On Sale lowered → ad sets and campaign active", async () => {
    const fake = fakeMeta();
    const { mem, deps, ctx } = setup();
    const out = await applyPurchaseCampaign(deps(fake.meta), LINE(), ctx);
    assert.equal(out.state, "applied");
    assert.equal(out.reason, "live · 2 ad sets · 3 ads · £5 a day, £130 lifetime to 11 Dec (£0 from plan headroom + £130 from On Sale)");
    const order = fake.writes().map(([name, target]) => `${name}:${typeof target === "string" ? target : ""}`);
    assert.deepEqual(order, [
      "createCampaign:act_1073273492854557",
      "createAdSet:act_1073273492854557",
      "createAdSet:act_1073273492854557",
      ...Array(6).fill("createAd:act_1073273492854557"),
      `updateCampaign:${MAIN}`,
      "setAdSetActive:set2",
      "setAdSetActive:set3",
      "updateCampaign:camp1",
    ]);
    // Step 2: OUTCOME_SALES, CBO lifetime £130 (13,000 minor), paused, named as ruled.
    const campaign = fake.calls.find(([name]) => name === "createCampaign")![2] as Record<string, unknown>;
    assert.deepEqual([campaign.name, campaign.objective, campaign.status, campaign.lifetime_budget, campaign.bid_strategy], ["[NX26-LOCKLEAD] Locklead - Purchase", "OUTCOME_SALES", "PAUSED", 13000, "LOWEST_COST_WITHOUT_CAP"]);
    // Step 5: On Sale £1,500 → £1,370.
    assert.deepEqual(fake.calls.find(([name, target]) => name === "updateCampaign" && target === MAIN)![2], { lifetime_budget: 137000 });
    // Step 6: active last.
    assert.deepEqual(fake.calls.at(-1), ["updateCampaign", "camp1", { status: "ACTIVE" }]);
    // The campaign's id and each copy's pick are on the line (HP3, PC6).
    const stored = (mem.tables.onsale_refresh_lines![0]!.applied_result as { purchase: { campaignId: string; adSets: Record<string, { role: string; name: string }> } }).purchase;
    assert.equal(stored.campaignId, "camp1");
    assert.deepEqual(Object.values(stored.adSets).map((row) => [row.role, row.name]), [["purchase", "Lineup - Suggested · Purchase"], ["checkout", "Venue · Purchase"]]);
  });

  it("each copy keeps its source exactly — audiences, exclusions, placements, age, location, attribution — with Purchase, no budget, paused, ending 23:59 on the show", async () => {
    const fake = fakeMeta();
    const { deps, ctx } = setup();
    await applyPurchaseCampaign(deps(fake.meta), LINE(), ctx);
    const payload = fake.calls.find(([name]) => name === "createAdSet")![2] as Record<string, unknown>;
    assert.deepEqual(payload.targeting, SOURCE_TARGETING);
    assert.deepEqual(payload.promoted_object, { pixel_id: "645185673672763", custom_event_type: "PURCHASE" });
    assert.deepEqual([payload.optimization_goal, payload.status, payload.campaign_id, payload.end_time], ["OFFSITE_CONVERSIONS", "PAUSED", "camp1", "2026-12-11T23:59:00+0000"]);
    assert.deepEqual(payload.attribution_spec, [{ event_type: "CLICK_THROUGH", window_days: 7 }, { event_type: "VIEW_THROUGH", window_days: 1 }]);
    assert.equal("daily_budget" in payload, false, "CBO: the campaign holds the budget");
    assert.equal("bid_strategy" in payload, false);
    const ad = fake.calls.find(([name]) => name === "createAd")![2] as Record<string, unknown>;
    assert.deepEqual(ad, { name: "name-a1", adset_id: "set2", creative: { creative_id: "cr-a1" }, status: "ACTIVE" }, "the same creative (so the same post), the source ad's name");
  });

  it("all from plan headroom: On Sale's budget is never touched, and the lifetime gate isn't needed", async () => {
    const line = LINE({ funding: BUILD.funding.map((row) => ({ ...row, headroom: row.lifetime, move: 0, mainBefore: null, mainAfter: null })) });
    const fake = fakeMeta();
    const { deps, ctx } = setup({ ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED: "1" }, { budget: 4500, spend: 2000 });
    const out = await applyPurchaseCampaign(deps(fake.meta), line, ctx);
    assert.equal(out.state, "applied");
    assert.equal(fake.calls.some(([name, target]) => name === "updateCampaign" && target === MAIN), false);
    assert.match(out.reason!, /\(£130 from plan headroom \+ £0 from On Sale\)$/);
  });

  it("the own-domain path makes the show's custom conversion first, or reuses one by name, and optimises on it", async () => {
    const own = LINE({ path: "own_domain", customConversion: { name: "NX26-LOCKLEAD · Purchase on locklead-newcastle.com", domain: "locklead-newcastle.com" } });
    const fake = fakeMeta({ findCustomConversion: async () => "cc-existing" });
    const { deps, ctx } = setup({ ...ON, ONSALE_REFRESH_CUSTOM_CONVERSION_CREATE_ENABLED: "1" });
    await applyPurchaseCampaign(deps(fake.meta), own, ctx);
    assert.equal(fake.calls.some(([name]) => name === "createCustomConversion"), false);
    assert.deepEqual((fake.calls.find(([name]) => name === "createAdSet")![2] as Record<string, unknown>).promoted_object, { pixel_id: "645185673672763", custom_conversion_id: "cc-existing" });
    const off = await applyPurchaseCampaign(setup(ON).deps(fakeMeta().meta), own, setup(ON).ctx);
    assert.match(off.reason!, /custom conversion is switched off/);
  });
});

describe("P4 PR B: the plan and the floor, again, on live figures", () => {
  it("over this refresh's 20 % cap: nothing built", async () => {
    const fake = fakeMeta();
    const { deps, ctx } = setup(ON, { budget: 1000, spend: 800 });
    const out = await applyPurchaseCampaign(deps(fake.meta), LINE(), ctx);
    assert.equal(out.reason, "£130 is over this refresh's 20 % cap (£40 free). On Sale's budget is unchanged.");
    assert.deepEqual(fake.writes(), []);
  });

  it("On Sale's budget changed in Ads Manager since the proposal: nothing built", async () => {
    const fake = fakeMeta({ readCampaignBudget: async () => ({ daily: null, lifetime: 120000 }) });
    const { deps, ctx } = setup();
    const out = await applyPurchaseCampaign(deps(fake.meta), LINE(), ctx);
    assert.equal(out.reason, "On Sale's budget changed in Ads Manager since the proposal. On Sale's budget is unchanged.");
    assert.deepEqual(fake.writes(), []);
  });

  it("the move would take On Sale under its floor (spent + 3 days at its daily spend): nothing built", async () => {
    const fake = fakeMeta();
    const { deps, ctx } = setup(ON, { budget: 10000, spend: 0 });
    const out = await applyPurchaseCampaign({ ...deps(fake.meta), mainSpentNow: 1300 }, LINE(), ctx);
    assert.match(out.reason!, /^On Sale would go under £1,430 \(Meta's minimum: 1\.1 × £1,300\.00 spent\)/, "PC7: Meta's 1.1 × £1,300 = £1,430 beats £1,300 + 3 × £35.33");
    assert.deepEqual(fake.writes(), []);
  });
});

describe("P4 PR B: failures leave everything paused; Retry picks up and never makes a second campaign", () => {
  it("step 3 fails: the campaign stays paused, On Sale is unchanged; Retry reuses the campaign and goes on", async () => {
    let refuse = true;
    const fake = fakeMeta({
      createAdSet: async () => {
        if (refuse) throw new Error("Meta refused an ad set: its audience is too small");
        return "set-ok";
      },
    });
    const { mem, deps, ctx } = setup();
    const first = await applyPurchaseCampaign(deps(fake.meta), LINE(), ctx);
    assert.equal(first.state, "failed");
    assert.equal(first.reason, "Meta refused an ad set: its audience is too small. Created paused: the campaign. On Sale's budget is unchanged.");
    assert.equal(fake.calls.some(([name, target]) => name === "updateCampaign" && target === MAIN), false);
    assert.equal(fake.calls.some(([name]) => name === "setAdSetActive"), false);
    refuse = false;
    const retry = await applyPurchaseCampaign(deps(fake.meta), { ...LINE(), applied_result: first.result }, ctx);
    assert.equal(retry.state, "applied");
    assert.equal(fake.calls.filter(([name]) => name === "createCampaign").length, 1, "one campaign, ever");
    assert.ok(mem.tables.meta_write_idempotency!.some((row) => row.op_kind === "refresh_campaign_create"));
  });

  it("step 6 fails: built and paused, not switched on; Retry switches it on without moving the money twice", async () => {
    let refuse = true;
    const fake = fakeMeta({
      updateCampaign: async (campaignId: string, fields: { status?: string; lifetime_budget?: number }) => {
        if (fields.status === "ACTIVE" && refuse) throw new Error("Meta is busy");
        fake.calls.push(["updateCampaign", campaignId, fields]);
      },
    } as never);
    const { deps, ctx } = setup();
    const first = await applyPurchaseCampaign(deps(fake.meta), LINE(), ctx);
    assert.equal(first.reason, "built and paused, not switched on: Meta is busy. On Sale already gave £130. Retry switches it on.");
    refuse = false;
    const retry = await applyPurchaseCampaign(deps(fake.meta), { ...LINE(), applied_result: first.result }, ctx);
    assert.equal(retry.state, "applied");
    assert.equal(fake.calls.filter(([name, target, fields]) => name === "updateCampaign" && target === MAIN && (fields as { lifetime_budget?: number }).lifetime_budget != null).length, 1, "On Sale lowered once");
    assert.equal(fake.calls.filter(([name]) => name === "createCampaign").length, 1);
  });

  it("a double click on Apply: the ledger returns the first run's ids, so nothing is made twice", async () => {
    const fake = fakeMeta();
    const { deps, ctx } = setup();
    await applyPurchaseCampaign(deps(fake.meta), LINE(), ctx);
    const before = fake.writes().length;
    await applyPurchaseCampaign(deps(fake.meta), LINE(), ctx);
    assert.equal(fake.calls.filter(([name]) => name === "createCampaign").length, 1);
    assert.equal(fake.calls.filter(([name]) => name === "createAdSet").length, 2);
    assert.equal(fake.calls.filter(([name]) => name === "createAd").length, 6);
    assert.ok(fake.writes().length >= before);
  });
});

describe("P4 PR B: PC5's Purchase campaign words, the picked rate, the end time, migration 243", () => {
  it("the words", () => {
    assert.equal(appliedText({ adSets: 2, ads: 3, rate: 5, lifetime: 130, endDay: "2026-12-11", headroom: 0, moved: 130, mainShort: "On Sale" }), "live · 2 ad sets · 3 ads · £5 a day, £130 lifetime to 11 Dec (£0 from plan headroom + £130 from On Sale)");
    assert.equal(failedBeforeLive("Meta refused an ad set: its audience is too small", { campaignId: "c" }, "On Sale"), "Meta refused an ad set: its audience is too small. Created paused: the campaign. On Sale's budget is unchanged.");
    assert.equal(failedBeforeLive("x", { campaignId: "c", adSets: { a: { id: "1", role: "purchase", name: "n" }, b: { id: "2", role: "checkout", name: "m" } }, ads: ["1", "2", "3"] }, "On Sale"), "x. Created paused: the campaign, 2 ad sets and 3 ads. On Sale's budget is unchanged.");
    assert.equal(failedAtSwitchOn("Meta is busy", 130, "On Sale"), "built and paused, not switched on: Meta is busy. On Sale already gave £130. Retry switches it on.");
  });

  it("the picked rate: £5 always, £10 only when the card offered it", () => {
    const line = { kind: "purchase_campaign", evidence: { card: PF2_PLAN.card } };
    assert.deepEqual(pickedRate(line, 5), { ok: true, rate: 5 });
    assert.deepEqual(pickedRate(line, 10), { ok: false, error: "£10 a day is over the cap, so it can't be picked." });
    assert.deepEqual(pickedRate(line, 7), { ok: false, error: "Pick £5 or £10 a day." });
    assert.deepEqual(pickedRate({ kind: "move_budget" }, 10), { ok: true, rate: null });
  });

  it("23:59 London on the show's date, in GMT and in BST", () => {
    assert.equal(showEndTime("2026-12-11"), "2026-12-11T23:59:00+0000");
    assert.equal(showEndTime("2026-07-04"), "2026-07-04T23:59:00+0100");
  });

  it("the copy's payload ignores the source's budget, bid and optimisation", () => {
    const payload = purchaseAdSetPayload({ targeting: { age_min: 21 }, daily_budget: "900", bid_strategy: "COST_CAP", bid_amount: 300, optimization_goal: "LANDING_PAGE_VIEWS", adset_schedule: [{ start_minute: 600 }] }, { campaignId: "c", pixelId: "p", customConversionId: null, endDay: "2026-12-11", name: "Venue" });
    assert.deepEqual(Object.keys(payload).sort(), ["adset_schedule", "billing_event", "campaign_id", "end_time", "name", "optimization_goal", "promoted_object", "status", "targeting"]);
  });

  it("migration 243 keeps every ledger kind and adds the four", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/243_onsale_refresh_purchase_create_ledger.sql", import.meta.url), "utf8");
    for (const kind of ["campaign_create", "adset_create", "ad_create", "creative_upload", "adset_targeting_update", "adset_destination_update", "refresh_creative_create", "refresh_ad_create", "ad_status_update", "adset_status_update", "refresh_adset_budget_update", "refresh_adset_create", "refresh_custom_conversion_create", "refresh_campaign_create", "refresh_campaign_lifetime_budget_update", "refresh_campaign_status_update"]) {
      assert.match(sql, new RegExp(`'${kind}'`), kind);
    }
  });
});


describe("P4 PR B PC9: reusing the ads — the creative id, else one new creative from the same post", () => {
  it("the creative id first: no new creative, the path in the ledger", async () => {
    const fake = fakeMeta();
    const { mem, deps, ctx } = setup();
    const out = await applyPurchaseCampaign(deps(fake.meta), LINE(), ctx);
    assert.equal(out.state, "applied");
    assert.equal(fake.calls.some(([name]) => name === "createCreativeFromPost"), false);
    const paths = (out.result.purchase as { adPaths: Record<string, string> }).adPaths;
    assert.deepEqual([...new Set(Object.values(paths))], ["creative_id"]);
    assert.ok(mem.tables.meta_write_idempotency!.filter((row) => row.op_kind === "refresh_ad_create").length === 6);
  });

  it("Meta refuses the creative id: one new creative from the post, then the ad; the creative is made once and reused across the copies", async () => {
    const fake = fakeMeta({
      createAd: async (_account: string, ad: { creative: { creative_id: string } }) => {
        if (ad.creative.creative_id.startsWith("cr-")) throw new Error("Meta refused: this creative can't be used here");
        fake.calls.push(["createAd", _account, ad]);
        return `ad-${ad.creative.creative_id}-${fake.calls.length}`;
      },
    } as never);
    const { deps, ctx } = setup();
    const out = await applyPurchaseCampaign(deps(fake.meta), LINE(), ctx);
    assert.equal(out.state, "applied");
    const made = fake.calls.filter(([name]) => name === "createCreativeFromPost").map(([, , spec]) => (spec as { objectStoryId: string }).objectStoryId);
    assert.deepEqual(made, ["page_post-a1", "page_post-a2", "page_post-a3"], "one per source creative, the same post");
    assert.equal(fake.calls.filter(([name]) => name === "createAd").length, 6);
    assert.deepEqual([...new Set(Object.values((out.result.purchase as { adPaths: Record<string, string> }).adPaths))], ["post"]);
    assert.equal(out.reason, "live · 2 ad sets · 3 ads · £5 a day, £130 lifetime to 11 Dec (£0 from plan headroom + £130 from On Sale)", "the applied line doesn't say which path");
  });

  it("both fail: step 4 fails with Meta's reason; everything stays paused and On Sale is unchanged", async () => {
    const fake = fakeMeta({
      createAd: async () => {
        throw new Error("Meta refused the ad");
      },
      createCreativeFromPost: async () => {
        throw new Error("Meta refused the post");
      },
    } as never);
    const { deps, ctx } = setup();
    const out = await applyPurchaseCampaign(deps(fake.meta), LINE(), ctx);
    assert.equal(out.state, "failed");
    assert.equal(out.reason, "Meta refused the post. Created paused: the campaign and 2 ad sets. On Sale's budget is unchanged.");
    assert.equal(fake.calls.some(([name, target]) => name === "updateCampaign" && target === MAIN), false);
    assert.equal(fake.calls.some(([name]) => name === "setAdSetActive"), false);
  });
});
