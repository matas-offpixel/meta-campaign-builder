/**
 * NX26-RUDIMENTAL, 27 Nov: the build stopped five times on "Meta is still
 * building an audience" with its campaign and 14 audiences made and no ad
 * sets. Meta lets an ad set target an audience it is still populating (441)
 * or processing (400); only deleted (411), unavailable (412) or unreadable
 * audiences can't be used. These pin, with every Meta write mocked:
 *   - the shared rule (audienceTargetState) the three readers use;
 *   - the build resumes from that progress with some audiences populating and
 *     makes Cold, Warm, Hot and Wider on them, nothing made twice;
 *   - Wider's lookalike waits for a populating source (Meta makes no
 *     lookalike from one) and is made on a later run once it's ready;
 *   - a deleted, unavailable or unreadable audience stops the build by name.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import { audienceTargetState, targetable, type AudienceTargetState } from "../../audiences/ca-availability-recovery.ts";
import { applyFunnel, type FunnelBuild, type FunnelDeps, type FunnelMeta, type FunnelProgress } from "../funnel-apply.ts";
import { audiencesToMake, funnelSpecs, type FunnelSources, type ProspectingBudget } from "../funnel.ts";
import { planFunnelShow } from "../funnel-plan.ts";
import { planWider, widerSpecs } from "../show-campaigns.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "120252781594470755";
const ENV_ON = { ONSALE_REFRESH_APPLY_ENABLED: "1", ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED: "1", OFFPIXEL_META_AUDIENCE_WRITES_ENABLED: "true", ENABLE_OPTIMISATION_WRITES: "1" };
const VIDEOS = Array.from({ length: 15 }, (_, i) => `v${String(i + 1).padStart(2, "0")}`);

const SOURCES: FunnelSources = {
  pixelId: "px1",
  links: [
    { kind: "ticket", rule: "skiddle.com/e/1", host: "skiddle.com", name: "Skiddle", platform: "skiddle" },
    { kind: "landing", rule: "crqln.com/l/rudimental", host: "crqln.com", name: "crqln.com/l/rudimental", platform: null },
  ],
  accounts: [
    { pageId: "665240903339433", name: "NX Newcastle", platform: "facebook", kind: "promoter", access: true },
    { pageId: "665240903339433", name: "NX Newcastle", platform: "instagram", kind: "promoter", access: true, igId: "17841400000000001" },
  ],
  videos: [{ pageId: "665240903339433", videoIds: VIDEOS }],
  lists: [],
};
const PROSPECTING: ProspectingBudget[] = [{ id: "5001", kind: "adset", name: "Broad · Advantage+", dailyMinor: 6000, adSets: 1 }];

function buildFor(): FunnelBuild {
  const plan = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay: "2026-11-27", showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES, spec: { twoCampaigns: true, pageGroup: null } });
  const sets = widerSpecs({ sources: SOURCES, pageGroup: null, lineupInterests: [{ id: "6003", name: "Rudimental" }], genreInterests: [] });
  const wider = planWider({ showDailyMinor: plan.showDailyMinor, retargetingMinor: plan.totalMinor, runDay: "2026-11-27", showDay: "2026-12-12", adSets: sets.length, steps: plan.steps });
  return {
    kind: "retargeting_funnel_create",
    eventId: EVENT,
    eventCode: "NX26-RUDIMENTAL",
    campaignName: "NX26-RUDIMENTAL · Retargeting",
    path: "platform",
    pixelId: "px1",
    customConversion: null,
    sources: SOURCES,
    startDay: "2026-11-27",
    endDay: "2026-12-12",
    plan: { stretch: plan.stretch, share: plan.share, showDailyMinor: plan.showDailyMinor, targetMinor: plan.targetMinor, totalMinor: plan.totalMinor, tiers: plan.tiers, take: plan.take.from, steps: plan.steps },
    ads: [{ adId: "7001", name: "Rudimental · announce" }],
    geoFromAdsetId: "5001",
    videoCampaignIds: ["4001", "4002"],
    draftId: DRAFT,
    adAccountId: "act_606252931141334",
    campaignIds: ["4001", "4002"],
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

/** Rudimental's progress as stored: the campaign and its 14 audiences, no ad sets. */
function rudimentalProgress(): { progress: FunnelProgress; ids: Record<string, string> } {
  const keys = audiencesToMake(funnelSpecs(SOURCES)).map((aud) => aud.key);
  const ids = Object.fromEntries(keys.map((key, i) => [key, String(120252781596960755n + BigInt(i) * 1000n)]));
  return { progress: { campaignId: CAMPAIGN, audiences: { ...ids } }, ids };
}

type Call = [string, ...unknown[]];

function setup(progress: FunnelProgress, state: (id: string) => AudienceTargetState) {
  const mem = memoryDb({
    retargeting_builds: [{ event_id: EVENT, user_id: OWNER, state: "failed", mode: "paused", progress }],
    onsale_refresh_audiences: [],
    meta_write_idempotency: [],
    launched_ad_sets: [],
    meta_custom_audiences: [],
  });
  const calls: Call[] = [];
  let n = 0;
  const id = () => String(90000 + ++n);
  const meta: FunnelMeta = {
    readAd: async (adId) => ({ id: adId, name: "Rudimental · announce", creativeId: "6001", effectiveStatus: "ACTIVE", objectStoryId: null }),
    createCreativeFromPost: async () => id(),
    createCampaign: async (_a, payload) => (calls.push(["createCampaign", payload.name]), id()),
    createAdSet: async (_a, payload) => (calls.push(["createAdSet", payload.name, payload.targeting]), id()),
    createAd: async (_a, ad) => (calls.push(["createAd", ad.adset_id]), id()),
    updateCampaign: async () => undefined,
    setAdSetActive: async () => undefined,
    findCustomConversion: async () => null,
    createCustomConversion: async () => id(),
    readAdSetTargeting: async () => ({ geo_locations: { cities: [{ key: "1" }] } }),
    audienceState: async (audienceId) => (calls.push(["audienceState", audienceId]), state(audienceId)),
    listShowVideos: async () => [{ contextId: "665240903339433", videoIds: VIDEOS }],
    readDailyBudget: async () => 6000,
    setDailyBudget: async () => undefined,
  };
  const deps: FunnelDeps = {
    db: mem.db,
    env: ENV_ON,
    meta,
    createAudience: async (aud) => (calls.push(["createAudience", aud.key]), { metaAudienceId: `lal-${aud.key}` }),
    scheduleChange: async (step) => ({ id: `s-${step.key}` }),
    checkCeiling: async () => undefined,
    owner: { userId: OWNER, clientId: null, eventId: EVENT, launchRunId: "run-1" },
    source: "connector",
  };
  const ctx = { mode: "paused" as const, ledger: { supabase: mem.db as never, userId: OWNER, draftId: DRAFT, eventId: EVENT }, plainMetaReason: () => "Meta didn’t take this.", today: "2026-11-27" };
  return { mem, calls, deps, ctx };
}

const named = (calls: Call[], kind: string) => calls.filter((call) => call[0] === kind);
const quiet = async <T>(run: () => Promise<T>): Promise<T> => {
  const [info, warn, error] = [console.info, console.warn, console.error];
  console.info = () => undefined;
  console.warn = () => undefined;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.info = info;
    console.warn = warn;
    console.error = error;
  }
};

describe("audienceTargetState: the one rule for targeting", () => {
  it("populating (441) and processing (400) are targetable, logged with the id and code", () => {
    const lines: string[] = [];
    assert.equal(audienceTargetState("a1", { code: 441, description: "We're finding people who fit your audience criteria" }, (line) => lines.push(line)), "populating");
    assert.equal(audienceTargetState("a2", { code: 400, description: "Processing" }, (line) => lines.push(line)), "populating");
    assert.ok(targetable("populating"));
    assert.match(lines[0]!, /a1 operation_status 441/);
    assert.match(lines[1]!, /a2 operation_status 400/);
  });

  it("200 is ready; deleted (411) and unavailable (412) aren't; an unreadable audience isn't; too small stays too small", () => {
    const quietLog = () => undefined;
    assert.equal(audienceTargetState("a", { code: 200, description: "Normal" }, quietLog), "ready");
    assert.equal(audienceTargetState("a", { code: 411, description: "Deleted" }, quietLog), "unavailable");
    assert.equal(audienceTargetState("a", { code: 412, description: "Unavailable" }, quietLog), "unavailable");
    assert.equal(audienceTargetState("a", null, quietLog), "unreadable");
    assert.equal(audienceTargetState("a", { code: 600, description: "This audience is too small" }, quietLog), "too_small");
    for (const state of ["unavailable", "unreadable", "too_small", "building"] as const) assert.equal(targetable(state), false, state);
  });
});

describe("NX26-RUDIMENTAL: the campaign and 14 audiences made, no ad sets, some audiences populating", () => {
  it("resumes: makes Cold, Warm, Hot and Wider on the populating audiences, nothing made twice; the lookalikes wait on populating sources", async () => {
    const { progress, ids } = rudimentalProgress();
    assert.equal(Object.keys(ids).length, 14);
    // Most of them still populating (441) or processing (400) on Meta, as at 17:53.
    const populating = new Set(Object.values(ids).filter((_, i) => i % 3 !== 2));
    const { calls, deps, ctx, mem } = setup(progress, (id) => (populating.has(id) ? "populating" : "ready"));
    const out = await quiet(() => applyFunnel(deps, buildFor(), ctx));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.deepEqual(named(calls, "createCampaign").map((call) => call[1]), ["NX26-RUDIMENTAL · Wider"], "the Retargeting campaign is reused");
    // None of the 14 is made again.
    const asked = named(calls, "createAudience").map((call) => String(call[1]));
    for (const key of Object.keys(ids)) assert.ok(!asked.includes(key), `${key} reused`);
    const adSets = named(calls, "createAdSet").map((call) => String(call[1]));
    for (const tier of ["Cold", "Warm", "Hot"]) assert.ok(adSets.includes(`NX26-RUDIMENTAL · Retargeting · ${tier}`), tier);
    assert.ok(adSets.includes("NX26-RUDIMENTAL · Wider · Broad"));
    // Cold targets populating audiences.
    const cold = named(calls, "createAdSet").find((call) => String(call[1]).endsWith("· Cold"))!;
    const coldIds = ((cold[2] as { custom_audiences?: { id: string }[] }).custom_audiences ?? []).map((row) => row.id);
    assert.ok(coldIds.some((id) => populating.has(id)), "Cold includes a populating audience");
    // Wider's lookalikes: made only from a ready source; one from a populating source is left out with its reason.
    const lookalikeSources = ["rf:engaged_fb:180:", "rf:engaged_ig:180:", "rf:followers_fb:", "rf:followers_ig:"].map((prefix) => Object.keys(ids).find((key) => key.startsWith(prefix))!);
    const readySources = lookalikeSources.filter((key) => !populating.has(ids[key]!));
    assert.ok(readySources.length > 0 && readySources.length < lookalikeSources.length, "the fixture mixes ready and populating sources");
    assert.deepEqual(asked.sort(), readySources.map((key) => `lal:gb:1:${key}`).sort());
    const filling = (out.progress.skipped ?? []).filter((row) => row.reason === "source_filling").map((row) => row.key).sort();
    assert.deepEqual(filling, lookalikeSources.filter((key) => populating.has(ids[key]!)).map((key) => `lal:gb:1:${key}`).sort());
    assert.ok(adSets.includes("NX26-RUDIMENTAL · Wider · Lookalikes"), "the Lookalikes ad set is made from the ready source");
    assert.equal(mem.tables.retargeting_builds![0]!.state, "paused");
  });

  it("every lookalike source populating: the Lookalikes ad set isn't made; the next run, once they're ready, makes them and it, nothing else", async () => {
    const { progress, ids } = rudimentalProgress();
    let filling = true;
    const { calls, deps, ctx } = setup(progress, () => (filling ? "populating" : "ready"));
    const out = await quiet(() => applyFunnel(deps, buildFor(), ctx));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.deepEqual(named(calls, "createAudience"), [], "no lookalike is sent while its source populates");
    assert.equal((out.progress.skipped ?? []).filter((row) => row.reason === "source_filling").length, 4);
    assert.ok(!named(calls, "createAdSet").some((call) => String(call[1]).endsWith("· Lookalikes")));
    assert.ok(out.progress.adSets?.cold && out.progress.adSets.warm && out.progress.adSets.hot);

    filling = false;
    calls.length = 0;
    const again = await quiet(() => applyFunnel(deps, buildFor(), ctx));
    assert.equal(again.state, "applied", again.reason ?? "");
    assert.equal(named(calls, "createAudience").length, 4, "the four lookalikes");
    for (const call of named(calls, "createAudience")) assert.ok(String(call[1]).startsWith("lal:gb:1:"));
    assert.deepEqual(named(calls, "createAdSet").map((call) => call[1]), ["NX26-RUDIMENTAL · Wider · Lookalikes"]);
    assert.deepEqual(named(calls, "createCampaign"), []);
    for (const key of Object.keys(ids)) assert.ok(!named(calls, "createAudience").some((call) => call[1] === key));
  });

  for (const [state, words] of [
    ["unavailable", /^Meta says NX26-RUDIMENTAL · .+ is deleted or unavailable, so no ad set can use it\.$/],
    ["unreadable", /^NX26-RUDIMENTAL · .+ couldn’t be read on Meta, so no ad set was made with it\. Asking again reads it again\.$/],
    ["building", /^Meta is still building NX26-RUDIMENTAL · .+\. Retry in an hour\.$/],
  ] as const) {
    it(`an audience ${state} stops the build before any ad set, and says which audience by name`, async () => {
      const { progress, ids } = rudimentalProgress();
      const bad = Object.keys(ids).find((key) => key.startsWith("rf:followers_fb:"))!;
      const { calls, deps, ctx } = setup(progress, (id) => (id === ids[bad] ? state : "populating"));
      const out = await quiet(() => applyFunnel(deps, buildFor(), ctx));
      assert.equal(out.state, "failed");
      assert.match(out.reason ?? "", words);
      assert.match(out.reason ?? "", /Page followers/);
      assert.equal(out.specKey, bad);
      assert.equal(out.step, "audience");
      assert.deepEqual(named(calls, "createAdSet"), []);
    });
  }
});
