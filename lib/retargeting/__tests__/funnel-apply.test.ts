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
import { addSimilarAtStep, applyFunnel, audienceNames, funnelAudienceDraft, stepChanges, type FunnelBuild, type FunnelDeps, type FunnelMeta } from "../funnel-apply.ts";
import { audiencesToMake, funnelSpecs } from "../funnel.ts";
import { planFunnelShow } from "../funnel-plan.ts";
import type { FunnelSources, ProspectingBudget } from "../funnel.ts";
import { planWider, widerSpecs } from "../show-campaigns.ts";

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
    assert.equal(out.reason, "Broad · Advantage+’s budget was changed in Ads Manager since the plan. Plan it again.");
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
    // Followers are made by the builder's own subtype. Meta gets no window (the payload sends 0); the row stores 365,
    // the table's CHECK (1–365): a 0 made NX26-RUDIMENTAL's 4th audience throw at the draft insert on 27 Nov.
    const followers = funnelAudienceDraft({ key: "k", source: "followers", kind: "followers_ig", pageIds: ["1001"] });
    assert.deepEqual([followers.subtype, followers.retentionDays], ["page_followers_ig", 365]);
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


/** A two-campaign build (staged): Wider folds the show's £60.00 a day; Retargeting takes 35 % of it from Wider. */
function twoCampaignBuild(): FunnelBuild {
  const base = buildFor();
  const plan = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay: "2026-11-26", showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES, spec: { twoCampaigns: true, pageGroup: null } });
  const sets = widerSpecs({ sources: SOURCES, pageGroup: null, lineupInterests: [{ id: "6003", name: "Rudimental" }], genreInterests: [] });
  const wider = planWider({ showDailyMinor: plan.showDailyMinor, retargetingMinor: plan.totalMinor, runDay: "2026-11-26", showDay: "2026-12-12", adSets: sets.length, steps: plan.steps });
  return {
    ...base,
    plan: { stretch: plan.stretch, share: plan.share, showDailyMinor: plan.showDailyMinor, targetMinor: plan.targetMinor, totalMinor: plan.totalMinor, tiers: plan.tiers, take: plan.take.from, steps: plan.steps },
    wider: {
      campaignName: "NX26-RUDIMENTAL · Wider",
      dailyMinor: wider.dailyMinor,
      lifetimeMinor: wider.lifetimeMinor,
      daysLeft: wider.daysLeft,
      endDay: wider.endDay,
      adSets: sets.map((set) => ({ key: set.key, interests: set.interests, suggestionKeys: set.suggestions.map((aud) => aud.key), lookalikes: set.lookalikes, excludeKeys: set.excludes.map((aud) => aud.key) })),
      steps: wider.steps,
    },
  };
}

describe("two campaigns (staged): Wider folds prospecting, one CBO lifetime budget", () => {
  it("the plan: Retargeting takes its share from Wider; no prospecting ad set is lowered", () => {
    const build = twoCampaignBuild();
    assert.deepEqual(build.plan.take, []);
    assert.equal(build.plan.totalMinor, 2100);
    assert.equal(build.wider!.dailyMinor, 3900);
    assert.equal(build.wider!.lifetimeMinor, 3900 * 17);
    // Each step lowers Wider's lifetime by the step × the days left from that day.
    const [first] = build.wider!.steps;
    assert.equal(first!.day, "2026-11-28");
    assert.equal(first!.beforeMinor - first!.afterMinor, 300 * 15);
  });

  it("paused: Retargeting and Wider both made paused; Wider's budget is the campaign's lifetime; its ad sets keep Advantage+ on", async () => {
    const { calls, deps, ctx } = setup();
    const out = await applyFunnel(deps, twoCampaignBuild(), ctx("paused"));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.deepEqual(names(calls, "createCampaign").map((call) => [call[1], call[2]]), [["NX26-RUDIMENTAL · Retargeting", "PAUSED"], ["NX26-RUDIMENTAL · Wider", "PAUSED"]]);
    const widerSets = names(calls, "createAdSet").filter((call) => String(call[1]).includes("· Wider ·"));
    assert.deepEqual(widerSets.map((call) => call[1]), ["NX26-RUDIMENTAL · Wider · Broad", "NX26-RUDIMENTAL · Wider · Lookalikes"]);
    for (const call of widerSets) {
      assert.equal(call[3], undefined, "no ad-set budget under CBO");
      assert.equal(((call[4] as Record<string, unknown>).targeting_automation as { advantage_audience: number }).advantage_audience, 1);
    }
    for (const call of names(calls, "createAdSet").filter((c) => String(c[1]).includes("· Retargeting ·"))) {
      assert.equal(((call[4] as Record<string, unknown>).targeting_automation as { advantage_audience: number }).advantage_audience, 0);
    }
    assert.ok(out.progress.wider?.campaignId);
    for (const kind of ["setDailyBudget", "setAdSetActive", "scheduleChange", "checkCeiling"]) assert.deepEqual(names(calls, kind), [], kind);
  });

  it("live: the ceiling sees the show's total unchanged; nothing lowers prospecting; Wider is switched on and its lifetime steps are scheduled", async () => {
    const { calls, deps, ctx } = setup();
    const out = await applyFunnel(deps, twoCampaignBuild(), ctx("live"));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.deepEqual(names(calls, "checkCeiling"), [["checkCeiling", 6000, 6000]]);
    assert.deepEqual(names(calls, "setDailyBudget"), []);
    assert.equal(names(calls, "setAdSetActive").length, 3 + 2);
    assert.equal(names(calls, "updateCampaign").length, 2);
    const widerSteps = names(calls, "scheduleChange").filter((call) => call[2] === out.progress.wider!.campaignId);
    assert.equal(widerSteps.length, 2);
    assert.equal(widerSteps[0]![4], "2026-11-28T00:00:00.000Z");
  });

  it("READING (the coordinator's): Wider's remaining lifetime never goes below £1.00 × its ad sets × the days left", () => {
    const wider = planWider({ showDailyMinor: 1000, retargetingMinor: 300, runDay: "2026-12-01", showDay: "2026-12-12", adSets: 4, steps: [{ day: "2026-12-05", totalMinor: 900 }] });
    const step = wider.steps[0]!;
    const spent = 700 * 4;
    assert.equal(step.afterMinor - spent, 100 * 4 * 8);
    assert.equal(step.atFloor, true);
  });
});

describe("Job 2's finding (26 Nov): ad videos with no Page", () => {
  it("are kept with their explicit ids, under the show's promoter Page, in both video windows", async () => {
    const { calls, deps, ctx } = setup();
    deps.meta.listShowVideos = async () => [{ contextId: "", videoIds: ["d1", "d2", "d3"] }];
    const out = await applyFunnel(deps, buildFor(), ctx("paused"));
    assert.equal(out.state, "applied", out.reason ?? "");
    const video = names(calls, "createAudience").filter((call) => String(call[1]).startsWith("rf:video"));
    assert.deepEqual(video.map((call) => [String(call[1]).split(":").slice(0, 4).join(":"), call[2]]), [["rf:video75:180:1001", ["1001"]], ["rf:video95:60:1001", ["1001"]]]);
  });
});

describe("Matas, 26 Nov: Similar's audience under Meta's minimum at build", () => {
  it("Similar is skipped and its budget goes to Cold; nothing else stops", async () => {
    const group = { id: "g1", genreFamily: "drum_and_bass", pageIds: ["2001"], igIds: [], confirmed: true };
    const plan = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay: "2026-11-26", showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES, spec: { twoCampaigns: true, pageGroup: group, genreFamily: "drum_and_bass" } });
    const base = twoCampaignBuild();
    const build: FunnelBuild = { ...base, plan: { ...base.plan, tiers: plan.tiers, totalMinor: plan.totalMinor }, spec: { twoCampaigns: true, pageGroup: group, genreFamily: "drum_and_bass" } };
    assert.ok(plan.tiers.similar > 0);
    const { calls, deps, ctx } = setup();
    const similarIds = new Set<string>();
    const make = deps.createAudience;
    deps.createAudience = async (aud, name, account) => {
      const made = await make(aud, name, account);
      if (made && "metaAudienceId" in made && aud.key.startsWith("rf:similar_")) similarIds.add(made.metaAudienceId);
      return made;
    };
    deps.meta.audienceState = async (id) => (similarIds.has(id) ? "too_small" : "ready");
    const out = await applyFunnel(deps, build, ctx("paused"));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.equal(out.progress.similarSkipped, "too_small");
    assert.equal(out.progress.adSets?.similar, undefined);
    const cold = names(calls, "createAdSet").find((call) => call[1] === "NX26-RUDIMENTAL · Retargeting · Cold")!;
    assert.equal(cold[3], plan.tiers.cold + plan.tiers.similar);
  });
});

describe("Matas, 27 Nov (\"Yes, at the next step\"): a group confirmed after the build brings Similar back at the next stretch step", () => {
  const GROUP = { id: "g1", genreFamily: "dnb", pageIds: ["2001", "2002", "2003", "2004"], igIds: [], confirmed: true };
  /** Built on Thu 26 Nov with no group (Similar's share in Cold); live; the Sat 28 Nov step has run (Cold £6.00, Warm £9.60, Hot £8.40). */
  function running() {
    const build: FunnelBuild = { ...twoCampaignBuild(), spec: { twoCampaigns: true, pageGroup: null, genreFamily: "dnb" } };
    const plan = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay: "2026-11-26", showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES, spec: build.spec });
    build.plan = { ...build.plan, tiers: plan.tiers, steps: plan.steps, totalMinor: plan.totalMinor };
    const t = setup({ budgets: { "a-cold": 600, "a-warm": 960, "a-hot": 840 } });
    t.mem.tables.retargeting_builds!.push({ event_id: EVENT, user_id: OWNER, state: "live", mode: "live", build, progress: { active: true, campaignId: "c1", wider: { campaignId: "w1" }, audiences: { "rf:cold:a": "8101", "rf:warm:a": "8102", "rf:hot:a": "8103" }, adSets: { cold: { id: "a-cold", dailyMinor: 840 }, warm: { id: "a-warm", dailyMinor: 735 }, hot: { id: "a-hot", dailyMinor: 525 } } } });
    const updated: [string, number, number][] = [];
    const deps = { ...t.deps, updateScheduled: async (key: string, change: { amountMinor: number; expectedMinor: number }) => (updated.push([key, change.amountMinor, change.expectedMinor]), true) };
    const args = (today = "2026-11-28") => ({ build, pageGroup: GROUP, today, ledger: { supabase: t.mem.db as never, userId: OWNER, draftId: DRAFT, eventId: EVENT }, plainMetaReason: () => "Meta didn't take this." });
    return { ...t, build, deps, args, updated };
  }

  it("the step's folded split: Similar's share was in Cold", () => {
    const { build } = running();
    const step = build.plan.steps.find((row) => row.day === "2026-11-28")!;
    assert.deepEqual(step.tiers, { similar: 0, cold: 600, warm: 960, hot: 840 });
  });

  it("at the step: Similar's audiences, its ad set paused with Advantage+ off, Cold down to its own, Similar on last, the later rows re-sized", async () => {
    const { calls, deps, args, updated, mem } = running();
    const out = await addSimilarAtStep(deps, args());
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.deepEqual([out.similarMinor, out.coldMinor], [240, 360]);
    const made = names(calls, "createAudience");
    assert.equal(made.length, 1);
    assert.match(String(made[0]![1]), /^rf:similar_fb:365:/);
    assert.deepEqual(made[0]![2], ["2001", "2002", "2003", "2004"]);
    const [set] = names(calls, "createAdSet");
    assert.deepEqual([set![1], set![2], set![3]], ["NX26-RUDIMENTAL · Retargeting · Similar", "PAUSED", 240]);
    const targeting = set![4] as { targeting_automation?: { advantage_audience?: number }; excluded_custom_audiences?: { id: string }[] };
    assert.equal(targeting.targeting_automation?.advantage_audience, 0);
    assert.deepEqual(new Set((targeting.excluded_custom_audiences ?? []).map((row) => row.id)), new Set(["8101", "8102", "8103", "9001"]));
    // Cold first, then Similar on.
    const lowered = calls.findIndex((call) => call[0] === "setDailyBudget");
    const on = calls.findIndex((call) => call[0] === "setAdSetActive");
    assert.deepEqual(calls[lowered], ["setDailyBudget", "adset", "a-cold", 360]);
    assert.ok(lowered < on);
    // Final week (Sat 5 Dec, £30.00): Cold's row re-sized to 10 %, Similar's added at 5 %.
    assert.deepEqual(updated, [[`rf:${EVENT}:2026-12-05:cold`, 300, 360]]);
    assert.deepEqual(names(calls, "scheduleChange").map((call) => [call[1], call[3]]), [[`rf:${EVENT}:2026-12-05:similar`, 150]]);
    const progress = mem.tables.retargeting_builds![0]!.progress as { adSets: Record<string, { dailyMinor: number }>; similarAdded?: string; similarRefused?: unknown };
    assert.deepEqual([progress.adSets.similar!.dailyMinor, progress.adSets.cold!.dailyMinor], [240, 360]);
    assert.equal(progress.similarAdded, "2026-11-28");
    assert.equal(progress.similarRefused, undefined);
  });

  it("not a step day, or already added: nothing happens", async () => {
    const { calls, deps, args } = running();
    assert.equal((await addSimilarAtStep(deps, args("2026-11-29"))).state, "skipped");
    assert.deepEqual(calls, []);
  });

  it("refused (the group's audience under Meta's minimum): Cold keeps the share, nothing is made or moved, and the reason is kept", async () => {
    const { calls, deps, args, mem } = running();
    deps.meta = { ...deps.meta, audienceState: async () => "too_small" };
    const out = await addSimilarAtStep(deps, args());
    assert.equal(out.state, "failed");
    assert.ok(out.reason);
    for (const kind of ["createAdSet", "setDailyBudget", "setAdSetActive", "scheduleChange"]) assert.deepEqual(names(calls, kind), [], kind);
    const progress = mem.tables.retargeting_builds![0]!.progress as { adSets: Record<string, unknown>; similarRefused?: { day: string; reason: string } };
    assert.equal(progress.adSets.similar, undefined);
    assert.deepEqual(progress.similarRefused, { day: "2026-11-28", reason: out.reason });
  });

  it("refused when Similar won't switch on: Cold gets its share back and Similar stays off", async () => {
    const { calls, deps, args, budgets } = running();
    deps.meta = { ...deps.meta, setAdSetActive: async () => { throw new Error("nope"); } };
    const out = await addSimilarAtStep(deps, args());
    assert.equal(out.state, "failed");
    assert.deepEqual(names(calls, "setDailyBudget").map((call) => call[3]), [360, 600]);
    assert.equal(budgets.get("a-cold"), 600);
  });

  it("the switch: with budget writes off, nothing is made and the reason says so", async () => {
    const t = running();
    const deps = { ...t.deps, env: { ...ENV_ON, ENABLE_OPTIMISATION_WRITES: "" } };
    const out = await addSimilarAtStep(deps, t.args());
    assert.equal(out.state, "failed");
    assert.deepEqual(t.calls, []);
  });
});

describe("design's second verdict (27 Nov): audience names per meta.name.*, unique within a show", () => {
  // Seven Facebook Pages and seven Instagram accounts (two audiences each at 5 a time), videos on two Pages, a 7-Page group.
  const many: FunnelSources = {
    ...SOURCES,
    accounts: Array.from({ length: 7 }, (_, i) => [
      { pageId: `30${i}`, name: `Page ${i}`, platform: "facebook" as const, kind: "lineup" as const, access: true },
      { pageId: `30${i}`, igId: `ig30${i}`, name: `Page ${i}`, platform: "instagram" as const, kind: "lineup" as const, access: true },
    ]).flat(),
    videos: [{ pageId: "300", videoIds: ["v1"] }, { pageId: "301", videoIds: ["v2"] }],
  };
  const group = { id: "g", genreFamily: "dnb", pageIds: ["1", "2", "3", "4", "5", "6", "7"], igIds: [], confirmed: true };
  const specs = funnelSpecs(many, { twoCampaigns: true, pageGroup: group, genreFamily: "dnb" });

  it("every audience the show makes has its own name", () => {
    const names = [...audienceNames("NX26-RUDIMENTAL", specs, "drum & bass").values()];
    assert.equal(new Set(names).size, names.length, names.join("\n"));
    assert.ok(names.length >= 12);
  });

  it("the r2 forms: engagers by platform, followers with no window, and \" · {i} of {n}\" when one source makes more than one", () => {
    const names = [...audienceNames("NX26-RUDIMENTAL", specs, "drum & bass").values()];
    for (const name of [
      "NX26-RUDIMENTAL · Page engagers · 180 days · 1 of 2",
      "NX26-RUDIMENTAL · Page engagers · 180 days · 2 of 2",
      "NX26-RUDIMENTAL · Instagram engagers · 30 days · 2 of 2",
      "NX26-RUDIMENTAL · Page followers · all time · 1 of 2",
      "NX26-RUDIMENTAL · Instagram followers · all time · 2 of 2",
      "NX26-RUDIMENTAL · Video viewers 75 % · 180 days · 1 of 2",
      "NX26-RUDIMENTAL · Video viewers 95 % · 60 days · 2 of 2",
    ]) assert.ok(names.includes(name), name);
    assert.ok(names.some((name) => /^NX26-RUDIMENTAL · Engagers of the drum & bass page group · 365 days · \d of \d$/.test(name)));
    // One audience of a source: no part number.
    const one = [...audienceNames("NX26-RUDIMENTAL", funnelSpecs(SOURCES, { twoCampaigns: true })).values()];
    assert.ok(one.includes("NX26-RUDIMENTAL · Page followers · all time"));
    assert.ok(one.includes("NX26-RUDIMENTAL · Instagram followers · all time"));
  });

  it("an audience made under an older name is found by its rule (its key), not its name: nothing is made twice", async () => {
    const { calls, deps, ctx, mem } = setup();
    const build = buildFor();
    // Every audience this build makes, stored under the names the 26 Nov build gave them.
    const keys = audiencesToMake(funnelSpecs({ ...SOURCES, videos: [{ pageId: "1001", videoIds: ["v1", "v2"] }] })).map((aud) => aud.key);
    keys.forEach((key, i) => mem.tables.onsale_refresh_audiences!.push({ event_id: EVENT, kind: "retargeting_campaign", campaign_key: "", part: key, meta_audience_id: String(70000 + i), name: `NX26-RUDIMENTAL · old name ${i}` }));
    const out = await applyFunnel(deps, build, ctx("paused"));
    assert.equal(out.state, "applied", out.reason ?? "");
    const made = names(calls, "createAudience").map((call) => call[1]);
    assert.deepEqual(made.filter((key) => keys.includes(String(key))), []);
  });
});

describe("Matas, 27 Nov: one destination for every ad in both campaigns", () => {
  const DEST = { link: "https://www.rudimental-newcastle.com/", urlTags: "ref=meta&utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{adset.name}}&utm_term={{ad.name}}" };
  /** The show's one live ad, a per-placement creative (4:5 feed + 9:16 stories) on the old link. */
  const SOURCE = {
    name: "Rudimental · announce",
    object_story_spec: { page_id: "1001", instagram_user_id: "ig1" },
    asset_feed_spec: {
      bodies: [{ text: "Rudimental live in Newcastle" }],
      videos: [{ video_id: "v1", adlabels: [{ id: "l1", name: "feed" }] }, { video_id: "v2", adlabels: [{ id: "l2", name: "story" }] }],
      link_urls: [{ website_url: "https://www.skiddle.com/e/1", display_url: "skiddle.com" }],
      call_to_action_types: ["BOOK_TRAVEL"],
      asset_customization_rules: [{ customization_spec: { publisher_platforms: ["facebook"] }, video_label: { id: "l1", name: "feed" } }],
    },
    url_tags: "utm_source=old",
  };
  function withCreatives(t: ReturnType<typeof setup>, source: Record<string, unknown> = SOURCE) {
    const made: Record<string, unknown>[] = [];
    const ads: { adsetId: string; creativeId: string }[] = [];
    const createAd = t.deps.meta.createAd;
    t.deps.meta = {
      ...t.deps.meta,
      readCreative: async (id) => (t.calls.push(["readCreative", id]), structuredClone(source)),
      createCreative: async (_a, payload) => (t.calls.push(["createCreative"]), made.push(payload), `cr-${made.length}`),
      createAd: async (a, ad) => (ads.push({ adsetId: ad.adset_id, creativeId: String((ad.creative as { creative_id?: string }).creative_id) }), createAd(a, ad)),
    };
    return { made, ads };
  }

  it("every ad in Retargeting and Wider uses the new creative: the link replaced, url_tags with the braces as written, copy and media kept", async () => {
    const t = setup();
    const { made, ads } = withCreatives(t);
    const out = await applyFunnel(t.deps, { ...twoCampaignBuild(), destination: DEST }, t.ctx("paused"));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.equal(made.length, 1, "one creative per source creative, shared by every ad set");
    const [creative] = made as { url_tags: string; object_story_spec: Record<string, unknown>; asset_feed_spec: { link_urls: Record<string, unknown>[]; bodies: unknown; videos: unknown; call_to_action_types: unknown; asset_customization_rules: unknown } }[];
    assert.equal(creative!.url_tags, DEST.urlTags);
    assert.match(creative!.url_tags, /\{\{campaign\.name\}\}.*\{\{adset\.name\}\}.*\{\{ad\.name\}\}/);
    assert.deepEqual(creative!.asset_feed_spec.link_urls, [{ website_url: DEST.link }]);
    assert.deepEqual(creative!.asset_feed_spec.bodies, SOURCE.asset_feed_spec.bodies);
    assert.deepEqual(creative!.asset_feed_spec.call_to_action_types, ["BOOK_TRAVEL"]);
    assert.deepEqual(creative!.object_story_spec, { page_id: "1001", instagram_user_id: "ig1" });
    // Every ad, Retargeting's tiers and Wider's ad sets alike, runs the new creative; none the old one.
    const adSets = names(t.calls, "createAdSet").length;
    assert.equal(ads.length, adSets);
    assert.ok(ads.length >= 5);
    assert.deepEqual([...new Set(ads.map((row) => row.creativeId))], ["cr-1"]);
  });

  it("asked again, it carries on from what's made: no second creative, no second ad", async () => {
    const t = setup();
    const { made, ads } = withCreatives(t);
    const build = { ...twoCampaignBuild(), destination: DEST };
    await applyFunnel(t.deps, build, t.ctx("paused"));
    const first = { creatives: made.length, ads: ads.length };
    await applyFunnel(t.deps, build, t.ctx("paused"));
    assert.deepEqual({ creatives: made.length, ads: ads.length }, first);
  });

  it("a copied ad built from a post can't take the link: refused before anything is made", async () => {
    const t = setup();
    withCreatives(t, { name: "A post", object_story_id: "1001_555" });
    const out = await applyFunnel(t.deps, { ...twoCampaignBuild(), destination: DEST }, t.ctx("paused"));
    assert.equal(out.state, "failed");
    assert.equal(out.reason, "Rudimental · announce runs from a post, so its link is the post’s and can’t be changed");
    for (const kind of ["createCampaign", "createAdSet", "createAd", "createAudience", "createCreative"]) assert.deepEqual(names(t.calls, kind), [], kind);
  });

  it("no destination: the ads reuse the copied creatives as before, nothing read or made for them", async () => {
    const t = setup();
    const { made, ads } = withCreatives(t);
    await applyFunnel(t.deps, twoCampaignBuild(), t.ctx("paused"));
    assert.equal(made.length, 0);
    assert.deepEqual(names(t.calls, "readCreative"), []);
    assert.deepEqual([...new Set(ads.map((row) => row.creativeId))], ["6001"]);
  });
});

describe("Matas, 27 Nov: the Electric group's new Drive ads, run from the city's Page", () => {
  const DEST = { link: "https://www.rudimental-newcastle.com/", urlTags: "utm_source=meta&utm_campaign={{campaign.name}}&utm_content={{adset.name}}&utm_term={{ad.name}}" };
  const NX_LOVES = { pageId: "259905047197071", igId: "17841460869627228", pageName: "NX LOVES", igUsername: "nxloves", source: "electric" as const };
  const driveAd = (key: string, ratio: "9:16" | "4:5") =>
    ({
      key,
      name: `Final tickets pack ${key}`,
      creative: {
        id: `cr-${key}`,
        name: `Final tickets pack ${key}`,
        identity: { pageId: "1001", instagramAccountId: "ig1" },
        captions: [{ id: "c1", text: "Last tickets for Rudimental" }],
        headline: "Rudimental · Newcastle",
        destinationUrl: "https://www.skiddle.com/e/1",
        cta: "book_now",
        mediaType: "video",
        assetMode: ratio === "4:5" ? "dual" : "single",
        assetVariations: [{ id: "v1", name: "Variation 1", assets: [{ id: `a-${key}`, aspectRatio: "9:16", uploadStatus: "uploaded", videoId: `vid-${key}` }] }],
      } as never,
    });
  const CREATIVES = { key: "k1", input: { fileIds: ["f1"], pairs: [{ feed: "f2", vertical: "f3" }], primaryText: null, headline: null, cta: null }, folders: ["Final tickets pack › Statics · Videos"], ads: [driveAd("f1", "9:16"), driveAd("f2+f3", "4:5")] };

  function withDrive(t: ReturnType<typeof setup>) {
    const made: { creative: Record<string, unknown>; urlTags: string | null }[] = [];
    const ads: { adsetId: string; creativeId: string }[] = [];
    const createAd = t.deps.meta.createAd;
    t.deps.meta = {
      ...t.deps.meta,
      readCreative: async (id) => (t.calls.push(["readCreative", id]), { name: "Rudimental · announce", object_story_spec: { page_id: "1001", instagram_user_id: "ig1", video_data: { video_id: "v1", image_hash: "h1", message: "Rudimental live", call_to_action: { type: "BOOK_TRAVEL", value: { link: "https://www.skiddle.com/e/1" } } } } }),
      createCreative: async (_a, payload) => (t.calls.push(["createCreative", payload]), `copy-${t.calls.length}`),
      createDraftCreative: async (_a, creative, opts) => (made.push({ creative: creative as never, urlTags: opts.urlTags }), `drive-${made.length}`),
      createAd: async (a, ad) => (ads.push({ adsetId: ad.adset_id, creativeId: String((ad.creative as { creative_id?: string }).creative_id) }), createAd(a, ad)),
    };
    return { made, ads };
  }

  it("Drive ads replace the copies: every ad set in Retargeting and Wider gets the Drive ads, no live ad is read or copied", async () => {
    const t = setup();
    const { made, ads } = withDrive(t);
    const out = await applyFunnel(t.deps, { ...twoCampaignBuild(), creatives: CREATIVES, identity: NX_LOVES }, t.ctx("paused"));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.equal(made.length, 2, "one creative per Drive ad, shared by every ad set");
    for (const kind of ["readAd", "readCreative", "createCreative", "createCreativeFromPost"]) assert.deepEqual(names(t.calls, kind), [], kind);
    const adSets = names(t.calls, "createAdSet").length;
    assert.ok(adSets >= 5);
    assert.equal(ads.length, adSets * 2);
    assert.deepEqual([...new Set(ads.map((row) => row.creativeId))].sort(), ["drive-1", "drive-2"]);
    // Each runs from NX Loves and its Instagram.
    for (const row of made) assert.deepEqual((row.creative as { identity: unknown }).identity, { pageId: NX_LOVES.pageId, instagramAccountId: NX_LOVES.igId, instagramActorId: NX_LOVES.igId });
  });

  it("the destination and url_tags go on the Drive ads as written", async () => {
    const t = setup();
    const { made } = withDrive(t);
    await applyFunnel(t.deps, { ...twoCampaignBuild(), creatives: CREATIVES, identity: NX_LOVES, destination: DEST }, t.ctx("paused"));
    assert.deepEqual(made.map((row) => [(row.creative as { destinationUrl: string }).destinationUrl, row.urlTags]), [[DEST.link, DEST.urlTags], [DEST.link, DEST.urlTags]]);
    assert.match(made[0]!.urlTags!, /\{\{campaign\.name\}\}.*\{\{adset\.name\}\}.*\{\{ad\.name\}\}/);
  });

  it("asked again, no second creative and no second ad", async () => {
    const t = setup();
    const { made, ads } = withDrive(t);
    const build = { ...twoCampaignBuild(), creatives: CREATIVES, identity: NX_LOVES };
    await applyFunnel(t.deps, build, t.ctx("paused"));
    const first = { creatives: made.length, ads: ads.length };
    await applyFunnel(t.deps, build, t.ctx("paused"));
    assert.deepEqual({ creatives: made.length, ads: ads.length }, first);
  });

  it("copied ads with another identity: each is a new creative on the city's Page, its link, copy and media kept", async () => {
    const t = setup();
    const { ads } = withDrive(t);
    const out = await applyFunnel(t.deps, { ...twoCampaignBuild(), identity: NX_LOVES }, t.ctx("paused"));
    assert.equal(out.state, "applied", out.reason ?? "");
    const payload = names(t.calls, "createCreative")[0]![1] as { object_story_spec: { page_id: string; instagram_user_id: string; video_data: { call_to_action: unknown; message: string } } };
    assert.equal(names(t.calls, "createCreative").length, 1);
    assert.equal(payload.object_story_spec.page_id, NX_LOVES.pageId);
    assert.equal(payload.object_story_spec.instagram_user_id, NX_LOVES.igId);
    assert.deepEqual(payload.object_story_spec.video_data.call_to_action, { type: "BOOK_TRAVEL", value: { link: "https://www.skiddle.com/e/1" } });
    assert.equal(payload.object_story_spec.video_data.message, "Rudimental live");
    assert.ok(!ads.some((row) => row.creativeId === "6001"), "no ad runs the old creative");
  });

  it("a copied ad that already runs from the Page keeps its own creative", async () => {
    const t = setup();
    const { ads } = withDrive(t);
    await applyFunnel(t.deps, { ...twoCampaignBuild(), identity: { ...NX_LOVES, pageId: "1001", igId: "ig1" } }, t.ctx("paused"));
    assert.deepEqual(names(t.calls, "createCreative"), []);
    assert.deepEqual([...new Set(ads.map((row) => row.creativeId))], ["6001"]);
  });

  it("a copied ad built from a post can't move Page: refused before anything is made", async () => {
    const t = setup();
    withDrive(t);
    t.deps.meta.readCreative = async () => ({ name: "A post", object_story_id: "1001_555" });
    const out = await applyFunnel(t.deps, { ...twoCampaignBuild(), identity: NX_LOVES }, t.ctx("paused"));
    assert.equal(out.state, "failed");
    assert.equal(out.reason, "Rudimental · announce runs from a post, so it can’t be moved to another Page; give creatives from Drive instead");
    for (const kind of ["createCampaign", "createAdSet", "createAd", "createAudience"]) assert.deepEqual(names(t.calls, kind), [], kind);
  });
});

describe("#1410 addendum (Matas, 27 Nov): Drive ads and the show's live ads together, artist ads kept on their Page", () => {
  const NX_LOVES = { pageId: "259905047197071", igId: "17841460869627228", pageName: "NX LOVES", igUsername: "nxloves", source: "electric" as const };
  const DEST = { link: "https://www.rudimental-newcastle.com/", urlTags: "utm_source=meta&utm_campaign={{campaign.name}}" };
  // 1002 is Rudimental's Page in SOURCES (a lineup account); 1001 is NX Newcastle (the promoter's).
  const ADS: Record<string, { name: string; creativeId: string }> = {
    "8001": { name: "Motion - Text", creativeId: "cr-artist" },
    "8002": { name: "Motion - Text", creativeId: "cr-artist" },
    "8003": { name: "Announce", creativeId: "cr-nx" },
  };
  const CREATIVES: Record<string, Record<string, unknown>> = {
    "cr-artist": { name: "Motion - Text", object_story_spec: { page_id: "1002", instagram_user_id: "ig-rudi", video_data: { video_id: "v1", image_hash: "h1", message: "Rudimental", call_to_action: { type: "BUY_TICKETS", value: { link: "https://www.skiddle.com/e/1" } } } } },
    "cr-nx": { name: "Announce", object_story_spec: { page_id: "1001", instagram_user_id: "ig1", link_data: { image_hash: "h2", message: "NX", link: "https://www.skiddle.com/e/1", call_to_action: { type: "BOOK_TRAVEL", value: { link: "https://www.skiddle.com/e/1" } } } } },
  };
  const DRIVE = { key: "k1", input: { fileIds: ["f1"], pairs: [], primaryText: null, headline: null, cta: null }, folders: ["Final tickets pack › Videos"], ads: [{ key: "f1", name: "final-push", creative: { id: "d1", name: "final-push", identity: { pageId: "1001", instagramAccountId: "" }, destinationUrl: "https://www.skiddle.com/e/1", assetVariations: [] } as never }] };

  function withLive(t: ReturnType<typeof setup>) {
    const made: Record<string, unknown>[] = [];
    const ads: string[] = [];
    const createAd = t.deps.meta.createAd;
    t.deps.meta = {
      ...t.deps.meta,
      readAd: async (adId) => (t.calls.push(["readAd", adId]), { id: adId, name: ADS[adId]!.name, creativeId: ADS[adId]!.creativeId, effectiveStatus: "ACTIVE", objectStoryId: null }),
      readCreative: async (id) => structuredClone(CREATIVES[id]!),
      createCreative: async (_a, payload) => (made.push(payload), `new-${made.length}`),
      createDraftCreative: async () => "drive-1",
      createAd: async (a, ad) => (ads.push(String((ad.creative as { creative_id?: string }).creative_id)), createAd(a, ad)),
    };
    return { made, ads };
  }
  const copyAds = Object.entries(ADS).map(([adId, row]) => ({ adId, name: row.name }));

  it("Drive and live ads in one build; the artist ad keeps Rudimental's Page (its own creative), the NX ad moves to NX Loves; one ad per creative", async () => {
    const t = setup();
    const { made, ads } = withLive(t);
    const out = await applyFunnel(t.deps, { ...twoCampaignBuild(), creatives: DRIVE, identity: NX_LOVES, copyAds }, t.ctx("paused"));
    assert.equal(out.state, "applied", out.reason ?? "");
    // The artist creative is used as it is (no rebuild); the NX one is rebuilt once on NX Loves.
    assert.equal(made.length, 1);
    assert.deepEqual((made[0] as { object_story_spec: { page_id: string; instagram_user_id: string } }).object_story_spec.page_id, NX_LOVES.pageId);
    const adSets = names(t.calls, "createAdSet").length;
    // Three creatives in every ad set: the Drive ad, the artist ad (once, though two ads share it) and the moved NX ad.
    assert.equal(ads.length, adSets * 3);
    assert.deepEqual([...new Set(ads)].sort(), ["cr-artist", "drive-1", "new-1"]);
  });

  it("the destination goes on the copied ads too: the artist ad rebuilt on its own Page, the NX ad on NX Loves, both with the link and url_tags", async () => {
    const t = setup();
    const { made } = withLive(t);
    await applyFunnel(t.deps, { ...twoCampaignBuild(), creatives: DRIVE, identity: NX_LOVES, copyAds, destination: DEST }, t.ctx("paused"));
    assert.equal(made.length, 2);
    const byPage = Object.fromEntries(made.map((p) => [(p as { object_story_spec: { page_id: string } }).object_story_spec.page_id, p as { url_tags: string; object_story_spec: Record<string, { call_to_action?: { value: { link: string } }; link?: string }> }]));
    assert.deepEqual(Object.keys(byPage).sort(), ["1002", NX_LOVES.pageId].sort());
    assert.equal(byPage["1002"]!.object_story_spec.video_data!.call_to_action!.value.link, DEST.link);
    assert.equal(byPage[NX_LOVES.pageId]!.object_story_spec.link_data!.link, DEST.link);
    for (const p of Object.values(byPage)) assert.equal(p.url_tags, DEST.urlTags);
  });

  it("creatives without copyAds: the Drive ads alone, no live ad read", async () => {
    const t = setup();
    const { ads } = withLive(t);
    await applyFunnel(t.deps, { ...twoCampaignBuild(), creatives: DRIVE, identity: NX_LOVES }, t.ctx("paused"));
    assert.deepEqual(names(t.calls, "readAd"), []);
    assert.deepEqual([...new Set(ads)], ["drive-1"]);
  });
});
