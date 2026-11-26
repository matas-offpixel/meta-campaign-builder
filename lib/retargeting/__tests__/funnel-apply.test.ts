/**
 * The funnel's create path (RF1–RF5) with Meta, the audience builder, the
 * scheduled changes and the ceiling as spies: a paused build moves nothing;
 * a live one checks the ceiling on the show's total, lowers prospecting
 * before anything is switched on and schedules each stretch; a missing
 * account's sources are left out and every tier still builds; a re-run
 * makes nothing twice.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import { applyFunnel, funnelAudienceDraft, stepChanges, type FunnelBuild, type FunnelDeps, type FunnelMeta } from "../funnel-apply.ts";
import { planFunnelShow } from "../funnel-plan.ts";
import type { FunnelSources, ProspectingBudget } from "../funnel.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const ENV_ON = { ONSALE_REFRESH_APPLY_ENABLED: "1", ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED: "1", OFFPIXEL_META_AUDIENCE_WRITES_ENABLED: "true", ENABLE_OPTIMISATION_WRITES: "1" };

const SOURCES: FunnelSources = {
  pixelId: "px1",
  links: [
    { kind: "ticket", rule: "skiddle.com/e/1", host: "skiddle.com", name: "Skiddle", platform: "skiddle" },
    { kind: "landing", rule: "crqln.com/l/rudimental", host: "crqln.com", name: "crqln.com/l/rudimental", platform: null },
  ],
  accounts: [
    { pageId: "1001", name: "NX Newcastle", platform: "facebook", kind: "promoter", access: true },
    { pageId: "1001", name: "NX Newcastle", platform: "instagram", kind: "promoter", access: true },
    { pageId: "1002", name: "Rudimental", platform: "facebook", kind: "lineup", access: true },
    { pageId: "1003", name: "MC Fenn", platform: "instagram", kind: "lineup", access: false },
  ],
  videos: [{ pageId: "1001", videoIds: ["pending"] }],
  lists: [{ metaAudienceId: "9001", name: "Buyers", role: "buyers", uploadedAt: "2026-11-01" }],
};
const PROSPECTING: ProspectingBudget[] = [
  { id: "5001", kind: "adset", name: "Broad · Advantage+", dailyMinor: 3600, adSets: 1 },
  { id: "5002", kind: "adset", name: "Interests", dailyMinor: 1400, adSets: 1 },
  { id: "5003", kind: "adset", name: "Lookalike 1 %", dailyMinor: 1000, adSets: 1 },
];

function buildFor(runDay = "2026-11-26"): FunnelBuild {
  const plan = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay, showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES });
  return {
    kind: "retargeting_funnel_create",
    eventId: EVENT,
    eventCode: "NX26-RUDIMENTAL",
    campaignName: "NX26-RUDIMENTAL · Retargeting",
    path: "platform",
    pixelId: "px1",
    customConversion: null,
    sources: SOURCES,
    startDay: runDay,
    endDay: "2026-12-12",
    plan: { stretch: plan.stretch, share: plan.share, showDailyMinor: plan.showDailyMinor, targetMinor: plan.targetMinor, totalMinor: plan.totalMinor, tiers: plan.tiers, take: plan.take.from, steps: plan.steps },
    ads: [{ adId: "7001", name: "Rudimental · announce" }],
    geoFromAdsetId: "5001",
    videoCampaignIds: ["4001"],
    draftId: DRAFT,
    adAccountId: "act_123",
    campaignIds: ["4001"],
  };
}

type Call = [string, ...unknown[]];

function setup(opts: { env?: Record<string, string>; budgets?: Record<string, number>; ceiling?: (c: { beforeMinor: number; afterMinor: number }) => Promise<void> } = {}) {
  const mem = memoryDb({ retargeting_builds: [], onsale_refresh_audiences: [], meta_write_idempotency: [], launched_ad_sets: [] });
  const calls: Call[] = [];
  let n = 0;
  const id = () => String(80000 + ++n);
  const budgets = new Map(Object.entries(opts.budgets ?? { 5001: 3600, 5002: 1400, 5003: 1000 }));
  const meta: FunnelMeta = {
    readAd: async (adId) => (calls.push(["readAd", adId]), { id: adId, name: "Rudimental · announce", creativeId: "6001", effectiveStatus: "ACTIVE", objectStoryId: null }),
    createCreativeFromPost: async () => (calls.push(["createCreativeFromPost"]), id()),
    createCampaign: async (_a, payload) => (calls.push(["createCampaign", payload.name, payload.status]), id()),
    createAdSet: async (_a, payload) => (calls.push(["createAdSet", payload.name, payload.status, payload.daily_budget, payload.targeting]), id()),
    createAd: async (_a, ad) => (calls.push(["createAd", ad.adset_id]), id()),
    updateCampaign: async (campaignId, fields) => void calls.push(["updateCampaign", campaignId, fields]),
    setAdSetActive: async (adsetId) => void calls.push(["setAdSetActive", adsetId]),
    findCustomConversion: async () => null,
    createCustomConversion: async () => id(),
    readAdSetTargeting: async () => ({ geo_locations: { cities: [{ key: "1" }] } }),
    audienceState: async () => "ready",
    listShowVideos: async () => [{ contextId: "1001", videoIds: ["v1", "v2"] }, { contextId: "1003", videoIds: ["v3"] }],
    readDailyBudget: async (_kind, objectId) => budgets.get(objectId) ?? null,
    setDailyBudget: async (kind, objectId, minor) => void (calls.push(["setDailyBudget", kind, objectId, minor]), budgets.set(objectId, minor)),
  };
  const deps: FunnelDeps = {
    db: mem.db,
    env: opts.env ?? ENV_ON,
    meta,
    createAudience: async (aud) => (calls.push(["createAudience", aud.key, "pageIds" in aud ? aud.pageIds : "pageId" in aud ? [aud.pageId] : []]), { metaAudienceId: id() }),
    scheduleChange: async (step) => (calls.push(["scheduleChange", step.key, step.objectId, step.amountMinor, step.runAt]), { id: `s-${step.key}` }),
    checkCeiling: opts.ceiling ? async (c) => (calls.push(["checkCeiling", c.beforeMinor, c.afterMinor]), opts.ceiling!(c)) : async (c) => void calls.push(["checkCeiling", c.beforeMinor, c.afterMinor]),
    owner: { userId: OWNER, clientId: null, eventId: EVENT, launchRunId: "run-1" },
    source: "connector",
  };
  const ctx = (mode: "paused" | "live") => ({ mode, ledger: { supabase: mem.db as never, userId: OWNER, draftId: DRAFT, eventId: EVENT }, plainMetaReason: () => "Meta didn't take this.", today: "2026-11-26" });
  return { mem, calls, deps, ctx, budgets };
}

const names = (calls: Call[], kind: string) => calls.filter((call) => call[0] === kind);

describe("RF4: a paused build moves nothing", () => {
  it("makes the campaign, the audiences, Cold / Warm / Hot and the ads, all paused; no budget is written, nothing switched on, nothing scheduled, no ceiling read", async () => {
    const { calls, deps, ctx, mem } = setup();
    const out = await applyFunnel(deps, buildFor(), ctx("paused"));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.deepEqual(names(calls, "createCampaign"), [["createCampaign", "NX26-RUDIMENTAL · Retargeting", "PAUSED"]]);
    assert.deepEqual(names(calls, "createAdSet").map((call) => [call[1], call[2], call[3]]), [
      ["NX26-RUDIMENTAL · Retargeting · Cold", "PAUSED", 630],
      ["NX26-RUDIMENTAL · Retargeting · Warm", "PAUSED", 945],
      ["NX26-RUDIMENTAL · Retargeting · Hot", "PAUSED", 525],
    ]);
    for (const kind of ["setDailyBudget", "setAdSetActive", "updateCampaign", "scheduleChange", "checkCeiling"]) assert.deepEqual(names(calls, kind), [], kind);
    assert.equal(mem.tables.retargeting_builds!.length, 1);
    assert.equal(mem.tables.retargeting_builds![0]!.state, "paused");
    assert.equal(mem.tables.launched_ad_sets!.length, 3);
  });
});

describe("RF4 live: the ceiling on the show's total, prospecting first, then on, then the steps", () => {
  it("a full take checks an unchanged total, lowers Broad before any ad set is switched on, and schedules each later stretch", async () => {
    const { calls, deps, ctx } = setup();
    const build = buildFor();
    const out = await applyFunnel(deps, build, ctx("live"));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.deepEqual(names(calls, "checkCeiling"), [["checkCeiling", 6000, 6000]]);
    assert.deepEqual(names(calls, "setDailyBudget"), [["setDailyBudget", "adset", "5001", 1500]]);
    const firstOn = calls.findIndex((call) => call[0] === "setAdSetActive");
    const lowered = calls.findIndex((call) => call[0] === "setDailyBudget");
    assert.ok(lowered >= 0 && lowered < firstOn, "prospecting is lowered before anything is switched on");
    assert.equal(names(calls, "setAdSetActive").length, 3);
    assert.deepEqual(names(calls, "updateCampaign").map((call) => call[2]), [{ status: "ACTIVE" }]);
    // Final 2 weeks (Sat 28 Nov): Broad down £3.00; final week (Sat 5 Dec): the largest left is Interests (£14.00 to Broad's £12.00), down £6.00.
    const scheduled = names(calls, "scheduleChange");
    assert.deepEqual(scheduled.map((call) => [call[2], call[3]]), [
      ["5001", 1200], [out.progress.adSets!.cold!.id, 480], [out.progress.adSets!.warm!.id, 1080], [out.progress.adSets!.hot!.id, 840],
      ["5002", 800], [out.progress.adSets!.cold!.id, 300], [out.progress.adSets!.warm!.id, 1200], [out.progress.adSets!.hot!.id, 1500],
    ]);
    assert.equal(scheduled[0]![4], "2026-11-28T00:00:00.000Z");
    assert.equal(scheduled[1]![4], "2026-11-28T00:05:00.000Z");
    assert.equal(out.progress.active, true);
  });

  it("over the ceiling: refused before any write", async () => {
    const { calls, deps, ctx, mem } = setup({ ceiling: async () => { throw new Error("Refused: over the show's ceiling. Nothing was sent to Meta."); } });
    const out = await applyFunnel(deps, buildFor(), ctx("live"));
    assert.equal(out.state, "failed");
    assert.equal(out.reason, "Refused: over the show's ceiling. Nothing was sent to Meta.");
    assert.deepEqual(calls.map((call) => call[0]), ["checkCeiling"]);
    assert.equal(mem.tables.retargeting_builds!.length, 0);
  });

  it("a prospecting budget changed since the plan: refused before any write", async () => {
    const { calls, deps, ctx } = setup({ budgets: { 5001: 3000, 5002: 1400, 5003: 1000 } });
    const out = await applyFunnel(deps, buildFor(), ctx("live"));
    assert.equal(out.state, "failed");
    assert.equal(out.reason, "Broad · Advantage+'s budget changed in Ads Manager since the plan.");
    assert.deepEqual(names(calls, "createCampaign"), []);
  });

  it("the budget write switch off: live is refused, paused still builds", async () => {
    const env = { ...ENV_ON, ENABLE_OPTIMISATION_WRITES: "" };
    const live = setup({ env });
    assert.equal((await applyFunnel(live.deps, buildFor(), live.ctx("live"))).state, "failed");
    assert.deepEqual(live.calls, []);
    const paused = setup({ env });
    assert.equal((await applyFunnel(paused.deps, buildFor(), paused.ctx("paused"))).state, "applied");
  });

  it("the gates: the campaign-create and audience switches off, nothing written", async () => {
    for (const off of ["ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED", "OFFPIXEL_META_AUDIENCE_WRITES_ENABLED", "ONSALE_REFRESH_APPLY_ENABLED"]) {
      const { calls, deps, ctx } = setup({ env: { ...ENV_ON, [off]: "" } });
      const out = await applyFunnel(deps, buildFor(), ctx("paused"));
      assert.equal(out.state, "failed", off);
      assert.deepEqual(calls, [], off);
    }
  });
});

describe("RF6: missing access builds without that source", () => {
  it("MC Fenn's videos and Instagram are in no audience, and every tier is built", async () => {
    const { calls, deps, ctx } = setup();
    const out = await applyFunnel(deps, buildFor(), ctx("paused"));
    assert.equal(out.state, "applied");
    const pages = names(calls, "createAudience").flatMap((call) => call[2] as string[]);
    assert.ok(!pages.includes("1003"), "no audience uses the account without access");
    assert.ok(pages.includes("1001") && pages.includes("1002"));
    assert.deepEqual(Object.keys(out.progress.adSets ?? {}).sort(), ["cold", "hot", "warm"]);
    // Followers are made by the builder's own subtype (Meta requires no window).
    const followers = funnelAudienceDraft({ key: "k", source: "followers", kind: "followers_ig", pageIds: ["1001"] });
    assert.deepEqual([followers.subtype, followers.retentionDays], ["page_followers_ig", 0]);
  });
});

describe("an idempotent re-run", () => {
  it("a second paused run makes nothing new; a live run after it only moves the money, switches it on and schedules", async () => {
    const { calls, deps, ctx } = setup();
    const build = buildFor();
    await applyFunnel(deps, build, ctx("paused"));
    const made = { campaigns: names(calls, "createCampaign").length, adSets: names(calls, "createAdSet").length, ads: names(calls, "createAd").length, audiences: names(calls, "createAudience").length };
    calls.length = 0;
    await applyFunnel(deps, build, ctx("paused"));
    for (const kind of ["createCampaign", "createAdSet", "createAd", "createAudience"]) assert.deepEqual(names(calls, kind), [], `re-run ${kind}`);
    calls.length = 0;
    const live = await applyFunnel(deps, build, ctx("live"));
    assert.equal(live.state, "applied");
    for (const kind of ["createCampaign", "createAdSet", "createAd", "createAudience"]) assert.deepEqual(names(calls, kind), [], `live ${kind}`);
    assert.equal(names(calls, "setDailyBudget").length, 1);
    assert.equal(names(calls, "setAdSetActive").length, 3);
    assert.ok(made.campaigns === 1 && made.adSets === 3 && made.ads === 3 && made.audiences > 0);
    // And live again: nothing at all.
    calls.length = 0;
    await applyFunnel(deps, build, ctx("live"));
    for (const kind of ["createCampaign", "createAdSet", "setDailyBudget", "setAdSetActive"]) assert.deepEqual(names(calls, kind), [], `again ${kind}`);
  });

  it("each step's change has a stable key, so scheduling again is the same rows", () => {
    const build = buildFor();
    const sets = { cold: { id: "a", dailyMinor: 630 }, warm: { id: "b", dailyMinor: 945 }, hot: { id: "c", dailyMinor: 525 } };
    assert.deepEqual(stepChanges(build, sets).map((row) => row.key), stepChanges(build, sets).map((row) => row.key));
    assert.equal(new Set(stepChanges(build, sets).map((row) => row.key)).size, stepChanges(build, sets).length);
  });
});

describe("Matas, 26 Nov item 2: the settings read-back", () => {
  it("each tier's targeting is read back after create; a missing geo setting is reported, never assumed off", async () => {
    const { deps, ctx } = setup();
    const out = await applyFunnel(deps, buildFor(), ctx("paused"));
    assert.deepEqual(out.progress.readBack?.map((row) => [row.name, row.geoOff, row.advantageOff]), [
      ["NX26-RUDIMENTAL · Retargeting · Cold", false, false],
      ["NX26-RUDIMENTAL · Retargeting · Warm", false, false],
      ["NX26-RUDIMENTAL · Retargeting · Hot", false, false],
    ]);
  });
});
