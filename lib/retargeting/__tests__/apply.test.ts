/**
 * The Retargeting campaign's create path (RT1, RT2, RT4, HR1, HR3) on fakes
 * only: no Meta call is real. The gates before any write; the steps in
 * order (campaign paused with no budget, audiences, three tier ad sets
 * paused with daily budgets and the hotter tiers left out, ads, switched
 * on last); a launched_ad_sets row per tier; Retry never makes a second
 * campaign or audience; RT9's refresh hooks.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import { writeGateOpen } from "../../onsale-refresh/line-states.ts";
import { purchaseCampaignInput } from "../../onsale-refresh/purchase-campaign.ts";
import { applyRetargetingCampaign, locationOf, RT_AUDIENCES_OFF, RT_CREATE_OFF, TIER_ATTRIBUTION, type RetargetingMeta } from "../apply.ts";
import { groupVideosByPage, tierAudienceName } from "../audiences.ts";
import { listRowPayload } from "../list-row.ts";
import { planRetargeting } from "../plan.ts";

const ON = { ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED: "1", OFFPIXEL_META_AUDIENCE_WRITES_ENABLED: "true" };

function fakeMeta() {
  const calls: [string, ...unknown[]][] = [];
  let next = 0;
  const id = (prefix: string) => `${prefix}${++next}`;
  const meta: RetargetingMeta = {
    async readCampaignBudget(campaignId) {
      calls.push(["readCampaignBudget", campaignId]);
      return { daily: null, lifetime: null };
    },
    async readAd(adId) {
      calls.push(["readAd", adId]);
      return { id: adId, name: `name-${adId}`, creativeId: `cr-${adId}`, effectiveStatus: "ACTIVE", objectStoryId: null };
    },
    async createCreativeFromPost() {
      throw new Error("not used");
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
    },
    async setAdSetActive(adsetId) {
      calls.push(["setAdSetActive", adsetId]);
    },
    async findCustomConversion() {
      return null;
    },
    async createCustomConversion() {
      return id("cc");
    },
    async readAdSetTargeting(adsetId) {
      calls.push(["readAdSetTargeting", adsetId]);
      return { geo_locations: { cities: [{ key: "2643743", radius: 80, distance_unit: "kilometer" }] }, age_min: 18, custom_audiences: [{ id: "old" }] };
    },
    async audienceState() {
      return "ready";
    },
    async listShowVideos(adAccountId, campaignIds) {
      calls.push(["listShowVideos", adAccountId, campaignIds]);
      return [{ contextId: "page1", videoIds: ["v1", "v2"] }];
    },
  };
  return { meta, calls, writes: () => calls.filter(([name]) => /^(create|update|set)/.test(name)) };
}

function buildLine() {
  // RB's build, as the daily read stores it on the line.
  const plan = planRetargeting({
    eventId: "e1",
    eventCode: "XMPL-ROOF",
    runDay: "2026-11-17",
    eventDate: "2026-12-18",
    onSaleDay: "2026-11-06",
    read: { state: "platform_under_bar", pixel: { id: "px", source: "ad_sets", spendShare: 1, stored: "px", matches: true }, pixelName: "Warehouse Skiddle", domain: null, onDomain: null, platform: "Skiddle" } as never,
    last7SpendGbp: 406,
    minDailyMinor: 100,
    sources: {
      pixelId: "px",
      ticketUrl: "skiddle.com/e/1",
      pageUrl: "roof.example/show",
      videos: [{ contextId: "", videoIds: ["pending"] }],
      pages: [{ id: "p1", name: "XMPL Promotions", igId: "ig1", kind: "promoter", hasRole: true }],
      lists: [{ metaAudienceId: "buyers1", name: "Buyers", role: "buyers", uploadedAt: "2026-11-16T10:00:00Z" }],
    },
    existing: null,
    legacy: [],
    budgetGbp: 4000,
    spendToDateGbp: 1500,
    committedGbp: 1000,
    main: null,
    ads: [{ adId: "a1", name: "Lineup" }],
    geoFromAdsetId: "src1",
    where: { draftId: "d1", adAccountId: "act_1", campaignIds: ["main1"] },
    videoCampaignIds: ["main1", "main2"],
  });
  assert.equal(plan.state, "proposed");
  return { id: "l1", write: { ...plan.build!, share: 10 } as unknown as Record<string, unknown>, applied_result: null as Record<string, unknown> | null };
}

function setup(env: Record<string, string | undefined> = ON) {
  const mem = memoryDb({ onsale_refresh_lines: [{ id: "l1", state: "applying" }], meta_write_idempotency: [], onsale_refresh_audiences: [], launched_ad_sets: [] });
  const ledger = { supabase: mem.db, userId: "u1", draftId: "d1", eventId: "e1" };
  const made: string[] = [];
  const deps = (meta: RetargetingMeta) => ({
    db: mem.db,
    env,
    meta,
    ensureAudience: async (aud: Parameters<typeof tierAudienceName>[1], name: string) => {
      made.push(`${aud.key}|${name}`);
      return { metaAudienceId: `aud-${aud.key}` };
    },
    plan: { budget: 4000, spend: 1500, today: "2026-11-17", appliedMovesGbp: 0 },
    mainSpentNow: 0,
    owner: { userId: "u1", clientId: "c1", eventId: "e1", launchRunId: "11111111-1111-4111-8111-111111111111" },
  });
  return { mem, made, deps, ctx: { ledger, adAccountId: "act_1", plainMetaReason: (err: unknown) => (err instanceof Error ? err.message : String(err)) } };
}

describe("RT1: the gates, all before any write", () => {
  it("the campaign-create gate off (the default): nothing written", async () => {
    const fake = fakeMeta();
    const { deps, ctx } = setup({});
    const out = await applyRetargetingCampaign(deps(fake.meta), buildLine(), ctx);
    assert.deepEqual([out.state, out.reason], ["failed", RT_CREATE_OFF]);
    assert.deepEqual(fake.writes(), []);
  });

  it("the audience-write gate off: nothing written", async () => {
    const fake = fakeMeta();
    const { deps, ctx, made } = setup({ ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED: "1" });
    const out = await applyRetargetingCampaign(deps(fake.meta), buildLine(), ctx);
    assert.deepEqual([out.state, out.reason], ["failed", RT_AUDIENCES_OFF]);
    assert.deepEqual([fake.writes(), made], [[], []]);
  });

  it("the panel's gate: Apply counts the line only with the create gate and the audience gate", () => {
    assert.equal(writeGateOpen({ kind: "retargeting_campaign", state: "accepted" }, { pauseWritesEnabled: false, campaignCreateEnabled: true }), false);
    assert.equal(writeGateOpen({ kind: "retargeting_campaign", state: "accepted" }, { pauseWritesEnabled: false, campaignCreateEnabled: true, audienceWritesEnabled: true }), true);
  });
});

describe("RT1 / HR3: the steps, in order", () => {
  it("campaign paused with no budget → audiences → three tier ad sets paused → ads → switched on", async () => {
    const fake = fakeMeta();
    const { mem, deps, ctx, made } = setup();
    const out = await applyRetargetingCampaign(deps(fake.meta), buildLine(), ctx);
    assert.equal(out.state, "applied");
    assert.equal(out.reason, "live · 3 tiers · 1 ad · £5.80 a day to 18 Dec");
    const order = fake.writes().map(([name]) => name);
    assert.deepEqual(order, ["createCampaign", "createAdSet", "createAdSet", "createAdSet", "createAd", "createAd", "createAd", "setAdSetActive", "setAdSetActive", "setAdSetActive", "updateCampaign"]);
    // The campaign: Sales, paused, budgets on the ad sets.
    const campaign = fake.calls.find(([name]) => name === "createCampaign")![2] as Record<string, unknown>;
    assert.deepEqual([campaign.name, campaign.objective, campaign.status, campaign.is_adset_budget_sharing_enabled, campaign.daily_budget, campaign.lifetime_budget], ["XMPL-ROOF · Retargeting", "OUTCOME_SALES", "PAUSED", false, undefined, undefined]);
    // Every tier: its daily budget, paused, Purchase on the pixel, 7-day click + 1-day view, the source's location only, Advantage+ and expansion off.
    const sets = fake.calls.filter(([name]) => name === "createAdSet").map(([, , payload]) => payload as Record<string, unknown> & { targeting: Record<string, unknown> });
    assert.deepEqual(sets.map((set) => [set.name, set.daily_budget, set.status]), [
      ["XMPL-ROOF · Retargeting · Bottom", 290, "PAUSED"],
      ["XMPL-ROOF · Retargeting · Mid Bottom", 145, "PAUSED"],
      ["XMPL-ROOF · Retargeting · Mid", 145, "PAUSED"],
    ]);
    for (const set of sets) {
      assert.deepEqual(set.promoted_object, { pixel_id: "px", custom_event_type: "PURCHASE" });
      assert.deepEqual(set.attribution_spec, TIER_ATTRIBUTION);
      assert.equal(set.end_time, "2026-12-18T23:59:00+0000");
      assert.deepEqual(set.targeting.geo_locations, { cities: [{ key: "2643743", radius: 80, distance_unit: "kilometer" }] });
      assert.equal(set.targeting.age_min, undefined);
      assert.deepEqual(set.targeting.targeting_automation, { advantage_audience: 0 });
      assert.deepEqual(set.targeting.publisher_platforms, ["facebook", "instagram"]);
      assert.deepEqual(set.targeting.instagram_positions, ["stream", "story", "reels"]);
    }
    // Each tier leaves out the hotter tiers' audiences and the buyers list.
    const ids = (set: { targeting: Record<string, unknown> }, key: string) => ((set.targeting[key] ?? []) as { id: string }[]).map((row) => row.id);
    assert.deepEqual(ids(sets[0]!, "custom_audiences"), ["aud-bottom:ticket:30", "aud-bottom:checkout:30"]);
    assert.deepEqual(ids(sets[0]!, "excluded_custom_audiences"), ["buyers1"]);
    assert.deepEqual(ids(sets[1]!, "excluded_custom_audiences"), ["aud-bottom:ticket:30", "aud-bottom:checkout:30", "buyers1"]);
    assert.deepEqual(ids(sets[2]!, "custom_audiences"), ["aud-mid:video:page1:1", "aud-mid:fb:1", "aud-mid:ig:1"]);
    assert.deepEqual(ids(sets[2]!, "excluded_custom_audiences"), ["aud-mid_bottom:page:60", "aud-mid_bottom:checkout:60", "aud-bottom:ticket:30", "aud-bottom:checkout:30", "buyers1"]);
    // Mid's videos are every video of the show's on-sale campaigns, listed at Apply.
    assert.deepEqual(fake.calls.find(([name]) => name === "listShowVideos")!.slice(1), ["act_1", ["main1", "main2"]]);
    assert.equal(made.length, 7);
    // Each audience stored on the event; a launched_ad_sets row per tier with its budget and the main draft.
    assert.equal(mem.tables.onsale_refresh_audiences!.length, 7);
    assert.deepEqual(mem.tables.launched_ad_sets!.map((row) => [row.meta_campaign_id, row.initial_daily_budget_pence, row.draft_id, row.event_id, row.objective]), [
      ["camp1", 290, "d1", "e1", "purchase"],
      ["camp1", 145, "d1", "e1", "purchase"],
      ["camp1", 145, "d1", "e1", "purchase"],
    ]);
    // Every Meta write went through the ledger.
    assert.equal(mem.tables.meta_write_idempotency!.length, fake.writes().length);
  });

  it("Retry after a failure at the ads reuses the campaign, the audiences and the ad sets", async () => {
    const fake = fakeMeta();
    let fail = true;
    const original = fake.meta.createAd;
    fake.meta.createAd = async (...args) => {
      if (fail) throw new Error("Meta said no");
      return original(...args);
    };
    const { mem, deps, ctx, made } = setup();
    const line = buildLine();
    const first = await applyRetargetingCampaign(deps(fake.meta), line, ctx);
    assert.equal(first.state, "failed");
    assert.equal(first.reason, "Meta said no. Created paused: the campaign, 7 audiences and 3 ad sets.");
    assert.equal(fake.calls.some(([name]) => name === "setAdSetActive"), false);
    fail = false;
    const retry = await applyRetargetingCampaign(deps(fake.meta), { ...line, applied_result: first.result }, ctx);
    assert.equal(retry.state, "applied");
    assert.equal(fake.calls.filter(([name]) => name === "createCampaign").length, 1);
    assert.equal(fake.calls.filter(([name]) => name === "createAdSet").length, 3);
    assert.equal(made.length, 7);
    assert.equal(mem.tables.launched_ad_sets!.length, 3);
  });

  it("RT2: one video audience per page the videos ran from; a video with no page is left out", () => {
    assert.deepEqual(groupVideosByPage([{ id: "v1", pageId: "p2" }, { id: "v2", pageId: "p1" }, { id: "v3", pageId: "p2" }, { id: "v4" }]), [{ contextId: "p1", videoIds: ["v2"] }, { contextId: "p2", videoIds: ["v1", "v3"] }]);
  });

  it("the location copied is the on-sale ad set's, nothing else of its targeting", () => {
    assert.deepEqual(locationOf({ geo_locations: { countries: ["GB"] }, age_min: 21 }), { geo_locations: { countries: ["GB"] } });
    assert.deepEqual(locationOf(null), { geo_locations: { countries: ["GB"] } });
  });
});

describe("RT9: the refresh never treats the Retargeting campaign as its own", () => {
  it("the Purchase campaign line doesn't read `{code} · Retargeting` as a running Purchase campaign", () => {
    const row = (campaign: string, goal: string, event: string) => ({ meta_ad_id: `${campaign}-ad`, meta_adset_id: `${campaign}-set`, meta_campaign_id: `${campaign}-id`, date: "2026-11-16", ad_name: "ad", adset_name: "set", campaign_name: campaign, spend: 10, landing_page_views: 0, purchases: 1, actions: [], promoted_event: event, optimization_goal: goal });
    const input = purchaseCampaignInput({
      rows: [row("XMPL-ROOF · Retargeting", "OFFSITE_CONVERSIONS", "PURCHASE"), row("XMPL-ROOF · Tickets", "OFFSITE_CONVERSIONS", "INITIATED_CHECKOUT")],
      eventCode: "XMPL-ROOF",
      eventName: "Roof",
      runDay: "2026-11-17",
      eventDate: "2026-12-18",
      windowStart: "2026-11-10",
      windowEnd: "2026-11-16",
      onSaleDay: "2026-11-06",
      read: undefined,
      scores: new Map(),
      budgets: null,
      budgetGbp: 4000,
      spendToDateGbp: 1500,
      draftOf: () => null,
    });
    assert.equal(input.existing, null);
    assert.equal(input.main?.campaignKey, "XMPL-ROOF · Tickets");
  });
});

describe("HR2: a list with a role is a meta_custom_audiences row", () => {
  it("customer_list, its role and show, no window, and its upload time", () => {
    const row = listRowPayload({ userId: "u1", clientId: "c1", eventId: "e1", name: "Roof buyers", role: "buyers", metaAudienceId: "123", adAccountId: "act_1", now: new Date("2026-11-17T09:00:00Z") });
    assert.deepEqual([row.audience_subtype, row.list_role, row.retention_days, row.event_id, row.meta_audience_id, row.status], ["customer_list", "buyers", null, "e1", "123", "ready"]);
    assert.deepEqual(row.source_meta, { subtype: "customer_list", role: "buyers", uploadedAt: "2026-11-17T09:00:00.000Z" });
  });
});
