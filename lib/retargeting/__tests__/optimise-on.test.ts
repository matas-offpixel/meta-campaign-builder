/**
 * Matas, 27 Nov: the Electric group's on-sale ad sets (NX, ES, EBR, the
 * CIRQLIN landing pages) optimise on the pixel's InitiateCheckout, Wider and
 * Retargeting alike, with no custom conversion; every other client stays on
 * Purchase; presale stays on CompleteRegistration; optimise_on overrides the
 * on-sale default; a pixel without InitiateCheckout is refused; ad sets
 * already made keep their event. Every Meta write is a spy.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import { applyFunnel, type FunnelBuild, type FunnelDeps, type FunnelMeta } from "../funnel-apply.ts";
import { planFunnelShow } from "../funnel-plan.ts";
import type { FunnelSources, ProspectingBudget } from "../funnel.ts";
import { planWider, widerSpecs } from "../show-campaigns.ts";
import { promotedObject, tierAdSetPayload, widerAdSetPayload } from "../apply.ts";
import { checkoutRefusal, checkoutSeenOf, defaultOptimiseOn, optimisationLines, resolveOptimisation } from "../optimise-on.ts";
import { funnelBuiltOf } from "../runner.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "120252781594470755";
const ENV_ON = { ONSALE_REFRESH_APPLY_ENABLED: "1", ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED: "1", OFFPIXEL_META_AUDIENCE_WRITES_ENABLED: "true", ENABLE_OPTIMISATION_WRITES: "1", ONSALE_REFRESH_CUSTOM_CONVERSION_CREATE_ENABLED: "1" };

const SOURCES: FunnelSources = {
  pixelId: "px1",
  links: [
    { kind: "ticket", rule: "skiddle.com/e/1", host: "skiddle.com", name: "Skiddle", platform: "skiddle" },
    { kind: "landing", rule: "crqln.com/l/rudimental", host: "crqln.com", name: "crqln.com/l/rudimental", platform: null },
  ],
  accounts: [
    { pageId: "1001", name: "NX Newcastle", platform: "facebook", kind: "promoter", access: true },
    { pageId: "1001", name: "NX Newcastle", platform: "instagram", kind: "promoter", access: true },
  ],
  videos: [],
  lists: [],
};
const PROSPECTING: ProspectingBudget[] = [{ id: "5001", kind: "adset", name: "Broad · Advantage+", dailyMinor: 6000, adSets: 1 }];

function buildFor(code = "NX26-RUDIMENTAL", over: Partial<FunnelBuild> = {}): FunnelBuild {
  const plan = planFunnelShow({ code, runDay: "2026-11-27", showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES });
  return {
    kind: "retargeting_funnel_create",
    eventId: EVENT,
    eventCode: code,
    campaignName: `${code} · Retargeting`,
    path: "platform",
    pixelId: "px1",
    customConversion: null,
    sources: SOURCES,
    startDay: "2026-11-27",
    endDay: "2026-12-12",
    plan: { stretch: plan.stretch, share: plan.share, showDailyMinor: plan.showDailyMinor, targetMinor: plan.targetMinor, totalMinor: plan.totalMinor, tiers: plan.tiers, take: plan.take.from, steps: plan.steps },
    ads: [{ adId: "7001", name: "announce" }],
    geoFromAdsetId: "5001",
    videoCampaignIds: ["4001"],
    draftId: DRAFT,
    adAccountId: "act_123",
    campaignIds: ["4001"],
    ...over,
  };
}

function withWider(build: FunnelBuild): FunnelBuild {
  const plan = planFunnelShow({ code: build.eventCode, runDay: "2026-11-27", showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES, spec: { twoCampaigns: true, pageGroup: null } });
  const sets = widerSpecs({ sources: SOURCES, pageGroup: null, lineupInterests: [{ id: "6003", name: "Rudimental" }], genreInterests: [] });
  const wider = planWider({ showDailyMinor: plan.showDailyMinor, retargetingMinor: plan.totalMinor, runDay: "2026-11-27", showDay: "2026-12-12", adSets: sets.length, steps: plan.steps });
  return {
    ...build,
    plan: { stretch: plan.stretch, share: plan.share, showDailyMinor: plan.showDailyMinor, targetMinor: plan.targetMinor, totalMinor: plan.totalMinor, tiers: plan.tiers, take: plan.take.from, steps: plan.steps },
    wider: { campaignName: `${build.eventCode} · Wider`, dailyMinor: wider.dailyMinor, lifetimeMinor: wider.lifetimeMinor, daysLeft: wider.daysLeft, endDay: wider.endDay, adSets: sets.map((set) => ({ key: set.key, interests: set.interests, suggestionKeys: set.suggestions.map((aud) => aud.key), lookalikes: set.lookalikes, excludeKeys: set.excludes.map((aud) => aud.key) })), steps: wider.steps },
  };
}

function setup(seedProgress?: Record<string, unknown>) {
  const mem = memoryDb({
    retargeting_builds: seedProgress ? [{ event_id: EVENT, user_id: OWNER, state: "failed", mode: "paused", progress: seedProgress }] : [],
    onsale_refresh_audiences: [],
    meta_write_idempotency: [],
    launched_ad_sets: [],
    meta_custom_audiences: [],
  });
  const adSets: Record<string, unknown>[] = [];
  const conversions: string[] = [];
  const campaigns: string[] = [];
  let n = 0;
  const id = () => String(80000 + ++n);
  const meta: FunnelMeta = {
    readAd: async (adId) => ({ id: adId, name: "announce", creativeId: "6001", effectiveStatus: "ACTIVE", objectStoryId: null }),
    createCreativeFromPost: async () => id(),
    createCampaign: async (_a, payload) => (campaigns.push(String(payload.name)), id()),
    createAdSet: async (_a, payload) => (adSets.push(payload), id()),
    createAd: async () => id(),
    updateCampaign: async () => undefined,
    setAdSetActive: async () => undefined,
    findCustomConversion: async () => null,
    createCustomConversion: async (_a, spec) => (conversions.push(spec.name), id()),
    readAdSetTargeting: async () => ({ geo_locations: { cities: [{ key: "1" }] } }),
    audienceState: async () => "ready",
    listShowVideos: async () => [],
    readDailyBudget: async () => 6000,
    setDailyBudget: async () => undefined,
  };
  const deps: FunnelDeps = {
    db: mem.db,
    env: ENV_ON,
    meta,
    createAudience: async () => ({ metaAudienceId: id() }),
    scheduleChange: async (step) => ({ id: `s-${step.key}` }),
    checkCeiling: async () => undefined,
    owner: { userId: OWNER, clientId: null, eventId: EVENT, launchRunId: "run-1" },
    source: "connector",
  };
  const ctx = { mode: "paused" as const, ledger: { supabase: mem.db as never, userId: OWNER, draftId: DRAFT, eventId: EVENT }, plainMetaReason: () => "Meta didn’t take this.", today: "2026-11-27" };
  return { mem, adSets, conversions, campaigns, deps, ctx };
}

const events = (sets: Record<string, unknown>[]) => sets.map((set) => [set.name, set.optimization_goal, set.promoted_object]);
const quiet = async <T>(run: () => Promise<T>): Promise<T> => {
  const [warn, error] = [console.warn, console.error];
  console.warn = () => undefined;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.warn = warn;
    console.error = error;
  }
};

describe("the default by show", () => {
  it("Electric (NX, ES, EBR) on InitiateCheckout; every other client on Purchase", () => {
    for (const code of ["NX26-RUDIMENTAL", "ES26-GLITTERBOX", "EBR27-JULIANFIJMA", "nx27-lower"]) assert.equal(defaultOptimiseOn(code), "initiate_checkout", code);
    for (const code of ["P26-BDAY", "AS26-LUKE", "DHB26-X", "IRW0006", "20261204CSA", "NXT", null]) assert.equal(defaultOptimiseOn(code), "purchase", String(code));
  });

  it("presale stays on CompleteRegistration, Electric or not; an override is not used there", () => {
    assert.deepEqual(resolveOptimisation({ code: "NX26-RUDIMENTAL", presale: true, adSetsMade: false }), { event: "COMPLETE_REGISTRATION", kept: false, askedNotUsed: null });
    assert.deepEqual(resolveOptimisation({ code: "P26-BDAY", presale: true, asked: "purchase", adSetsMade: false }), { event: "COMPLETE_REGISTRATION", kept: false, askedNotUsed: "purchase" });
  });

  it("optimise_on overrides the on-sale default either way", () => {
    assert.equal(resolveOptimisation({ code: "NX26-RUDIMENTAL", presale: false, asked: "purchase", adSetsMade: false }).event, "PURCHASE");
    assert.equal(resolveOptimisation({ code: "P26-BDAY", presale: false, asked: "initiate_checkout", adSetsMade: false }).event, "INITIATED_CHECKOUT");
    // The build's stored choice stands when nothing is asked.
    assert.equal(resolveOptimisation({ code: "NX26-RUDIMENTAL", presale: false, stored: "purchase", adSetsMade: false }).event, "PURCHASE");
  });
});

describe("the ad sets' promoted object", () => {
  it("InitiateCheckout is the pixel's event (INITIATED_CHECKOUT), never the custom conversion; Purchase and presale as before", () => {
    assert.deepEqual(promotedObject({ pixelId: "px1", customConversionId: "cc1", event: "INITIATED_CHECKOUT" }), { pixel_id: "px1", custom_event_type: "INITIATED_CHECKOUT" });
    assert.deepEqual(promotedObject({ pixelId: "px1", customConversionId: "cc1", event: "PURCHASE" }), { pixel_id: "px1", custom_conversion_id: "cc1" });
    assert.deepEqual(promotedObject({ pixelId: "px1", customConversionId: null }), { pixel_id: "px1", custom_event_type: "PURCHASE" });
    assert.deepEqual(promotedObject({ pixelId: "px1", customConversionId: null, presale: true, event: "INITIATED_CHECKOUT" }), { pixel_id: "px1", custom_event_type: "COMPLETE_REGISTRATION" });
  });

  it("a tier and a Wider ad set on InitiateCheckout keep OFFSITE_CONVERSIONS", () => {
    const tier = tierAdSetPayload({ event: "INITIATED_CHECKOUT", code: "NX26-RUDIMENTAL", tier: "cold", campaignId: "c1", dailyMinor: 840, pixelId: "px1", customConversionId: null, endDay: "2026-12-12", location: {}, includeIds: ["a1"], excludeIds: [] });
    const wider = widerAdSetPayload({ event: "INITIATED_CHECKOUT", name: "NX26-RUDIMENTAL · Wider · Broad", campaignId: "w1", pixelId: "px1", customConversionId: null, endDay: "2026-12-12", location: {}, interests: [], suggestionIds: [], excludeIds: [] });
    for (const payload of [tier, wider]) {
      assert.equal(payload.optimization_goal, "OFFSITE_CONVERSIONS");
      assert.deepEqual(payload.promoted_object, { pixel_id: "px1", custom_event_type: "INITIATED_CHECKOUT" });
    }
  });
});

describe("the build", () => {
  it("an Electric show: every Retargeting tier and every Wider ad set on InitiateCheckout; no custom conversion made even on an own domain; both campaigns Sales", async () => {
    const t = setup();
    const build = withWider(buildFor("NX26-RUDIMENTAL", { customConversion: { name: "NX26-RUDIMENTAL · Purchase on nxnewcastle.co.uk", domain: "nxnewcastle.co.uk" }, path: "own_domain", checkout: "seen" }));
    const out = await quiet(() => applyFunnel(t.deps, build, t.ctx));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.ok(t.adSets.length >= 5, String(t.adSets.length));
    for (const [name, goal, promoted] of events(t.adSets)) {
      assert.equal(goal, "OFFSITE_CONVERSIONS", String(name));
      assert.deepEqual(promoted, { pixel_id: "px1", custom_event_type: "INITIATED_CHECKOUT" }, String(name));
    }
    assert.deepEqual(t.conversions, []);
    assert.equal(out.progress.customConversionId, undefined);
    assert.equal(out.progress.optimisedOn, "INITIATED_CHECKOUT");
    assert.deepEqual(t.campaigns, ["NX26-RUDIMENTAL · Retargeting", "NX26-RUDIMENTAL · Wider"]);
  });

  it("another client: Purchase, its custom conversion on an own domain, as before", async () => {
    const t = setup();
    const build = buildFor("P26-BDAY", { customConversion: { name: "P26-BDAY · Purchase on example.com", domain: "example.com" }, path: "own_domain", checkout: "none" });
    const out = await quiet(() => applyFunnel(t.deps, build, t.ctx));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.deepEqual(t.conversions, ["P26-BDAY · Purchase on example.com"]);
    for (const [, , promoted] of events(t.adSets)) assert.deepEqual(promoted, { pixel_id: "px1", custom_conversion_id: out.progress.customConversionId });
    assert.equal(out.progress.optimisedOn, "PURCHASE");
  });

  it("a presale Electric show: CompleteRegistration", async () => {
    const t = setup();
    const out = await quiet(() => applyFunnel(t.deps, buildFor("NX26-RUDIMENTAL", { presale: true, checkout: "none" }), t.ctx));
    assert.equal(out.state, "applied", out.reason ?? "");
    for (const [, , promoted] of events(t.adSets)) assert.deepEqual(promoted, { pixel_id: "px1", custom_event_type: "COMPLETE_REGISTRATION" });
  });

  it("the override: an Electric show asked for Purchase builds on Purchase", async () => {
    const t = setup();
    const out = await quiet(() => applyFunnel(t.deps, buildFor("NX26-RUDIMENTAL", { optimiseOn: "purchase", checkout: "none" }), t.ctx));
    assert.equal(out.state, "applied", out.reason ?? "");
    for (const [, , promoted] of events(t.adSets)) assert.deepEqual(promoted, { pixel_id: "px1", custom_event_type: "PURCHASE" });
  });

  it("a pixel with no InitiateCheckout (or one not read): refused, nothing made", async () => {
    for (const checkout of ["none", "unread"] as const) {
      const t = setup();
      const out = await quiet(() => applyFunnel(t.deps, buildFor("NX26-RUDIMENTAL", { checkout }), t.ctx));
      assert.equal(out.state, "failed");
      assert.equal(out.step, "checkout");
      assert.match(out.reason ?? "", checkout === "none" ? /^Refused: NX26-RUDIMENTAL’s pixel had no InitiateCheckout in the last 28 days.*Nothing was sent to Meta\.$/ : /^Refused: NX26-RUDIMENTAL’s pixel’s InitiateCheckout couldn’t be read in time.*Nothing was sent to Meta\.$/);
      assert.deepEqual([t.adSets, t.campaigns, t.conversions], [[], [], []]);
      assert.equal(t.mem.tables.retargeting_builds!.length, 0);
    }
  });

  it("NX26-RUDIMENTAL's paused build (its campaign and 14 audiences, no ad sets, a build stored before 27 Nov): the next run makes every tier on InitiateCheckout", async () => {
    // progress as the row holds it: audiences and campaignId only.
    const audiences = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`stored:${i}`, String(70000 + i)]));
    const t = setup({ campaignId: CAMPAIGN, audiences });
    // The stored build has neither optimiseOn nor checkout; the connector sets checkout from the fresh read.
    const out = await quiet(() => applyFunnel(t.deps, buildFor("NX26-RUDIMENTAL", { checkout: "seen" }), t.ctx));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.deepEqual(t.campaigns, [], "the campaign is reused");
    assert.equal(out.progress.campaignId, CAMPAIGN);
    assert.deepEqual(events(t.adSets).map(([name, , promoted]) => [name, promoted]), [
      ["NX26-RUDIMENTAL · Retargeting · Cold", { pixel_id: "px1", custom_event_type: "INITIATED_CHECKOUT" }],
      ["NX26-RUDIMENTAL · Retargeting · Warm", { pixel_id: "px1", custom_event_type: "INITIATED_CHECKOUT" }],
      ["NX26-RUDIMENTAL · Retargeting · Hot", { pixel_id: "px1", custom_event_type: "INITIATED_CHECKOUT" }],
    ]);
  });

  it("a build whose ad sets already exist keeps their event: made before 27 Nov (Purchase), the missing tier is made on Purchase too, and no InitiateCheckout check refuses it", async () => {
    const t = setup({ campaignId: CAMPAIGN, audiences: {}, adSets: { cold: { id: "a-cold", dailyMinor: 840 } } });
    const out = await quiet(() => applyFunnel(t.deps, buildFor("NX26-RUDIMENTAL", { checkout: "none", optimiseOn: "initiate_checkout" }), t.ctx));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.ok(t.adSets.length >= 1);
    for (const [, , promoted] of events(t.adSets)) assert.deepEqual(promoted, { pixel_id: "px1", custom_event_type: "PURCHASE" });
    assert.equal(out.progress.optimisedOn, "PURCHASE");
  });

  it("…and one made on InitiateCheckout stays on it when Purchase is asked for later", () => {
    const opt = resolveOptimisation({ code: "NX26-RUDIMENTAL", presale: false, asked: "purchase", madeOn: "INITIATED_CHECKOUT", adSetsMade: true });
    assert.deepEqual(opt, { event: "INITIATED_CHECKOUT", kept: true, askedNotUsed: "purchase" });
    assert.equal(checkoutRefusal("NX26-RUDIMENTAL", opt, "none"), null);
    assert.deepEqual(optimisationLines("NX26-RUDIMENTAL", opt, "none"), [
      "Optimises on: InitiateCheckout. NX26-RUDIMENTAL’s ad sets were made on it, so they keep it; nothing on them is changed.",
      "Asked for Purchase, but NX26-RUDIMENTAL’s ad sets were made on InitiateCheckout, so they keep it; nothing on them is changed.",
    ]);
  });
});

describe("the plan's line and the pixel read", () => {
  it("one line, and why create would refuse", () => {
    const ic = resolveOptimisation({ code: "NX26-RUDIMENTAL", presale: false, adSetsMade: false });
    assert.deepEqual(optimisationLines("NX26-RUDIMENTAL", ic, "seen"), ["Optimises on: InitiateCheckout."]);
    assert.deepEqual(optimisationLines("NX26-RUDIMENTAL", ic, "none"), ["Optimises on: InitiateCheckout.", "NX26-RUDIMENTAL’s pixel had no InitiateCheckout in the last 28 days, so create_show_campaigns would refuse it. Pass optimise_on \"purchase\" to build on Purchase."]);
    assert.deepEqual(optimisationLines("P26-BDAY", resolveOptimisation({ code: "P26-BDAY", presale: false, adSetsMade: false }), "none"), ["Optimises on: Purchase."]);
  });

  it("the read's host breakdown: checkout hosts → seen; none → none; a failed read → unread", () => {
    assert.equal(checkoutSeenOf({ any: ["skiddle.com"], pageView: ["skiddle.com"], checkout: ["skiddle.com"], registration: [] }), "seen");
    assert.equal(checkoutSeenOf({ any: ["skiddle.com"], pageView: ["skiddle.com"], checkout: [], registration: [] }), "none");
    assert.equal(checkoutSeenOf(null), "unread");
    assert.equal(checkoutSeenOf(undefined), "unread");
  });

  it("the build row's progress reaches the plan: no ad sets yet, or the event they were made on", () => {
    const rudimental = funnelBuiltOf({ event_id: EVENT, state: "paused", mode: "paused", meta_campaign_id: CAMPAIGN, progress: { campaignId: CAMPAIGN, audiences: { a: "1" } }, build: {} });
    assert.equal(rudimental?.adSetsMade, false);
    assert.equal(rudimental?.optimisedOn, null);
    const made = funnelBuiltOf({ event_id: EVENT, state: "live", mode: "live", meta_campaign_id: CAMPAIGN, progress: { campaignId: CAMPAIGN, optimisedOn: "INITIATED_CHECKOUT", wider: { adSets: { broad: { id: "w" } } } }, build: { optimiseOn: "initiate_checkout" } });
    assert.deepEqual([made?.adSetsMade, made?.optimisedOn, made?.optimiseOn], [true, "INITIATED_CHECKOUT", "initiate_checkout"]);
  });
});
