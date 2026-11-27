/**
 * NX26-RUDIMENTAL, 27 Nov: create_show_campaigns made the campaign and three
 * audiences, then failed twice at the 4th (the Page followers audience:
 * its draft row carried retention 0, which meta_custom_audiences' CHECK
 * refuses, so it threw before any POST and the whole build read "Meta
 * didn't take this."). These pin the fix with every Meta write mocked:
 *   - the re-run resumes: the campaign and the three audiences are reused,
 *     nothing is made twice, and every tier builds;
 *   - a source with nothing to build from, a refused or a thrown create, and
 *     one whose existing-copy check couldn't run are left out with a reason;
 *     the build doesn't fail;
 *   - a write that does fail says its step and spec key and carries Meta's
 *     code, subcode, message and fbtrace_id, never a token;
 *   - the app's own ready audience for the show is reused before any create.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import { applyFunnel, audienceHasNothing, funnelAudienceDraft, metaErrorDetail, type AudienceMade, type FunnelBuild, type FunnelDeps, type FunnelMeta, type MakeAudience } from "../funnel-apply.ts";
import { audiencesToMake, funnelSpecs, type FunnelSources, type ProspectingBudget } from "../funnel.ts";
import { planFunnelShow } from "../funnel-plan.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "120252781594470755";
const ENV_ON = { ONSALE_REFRESH_APPLY_ENABLED: "1", ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED: "1", OFFPIXEL_META_AUDIENCE_WRITES_ENABLED: "true", ENABLE_OPTIMISATION_WRITES: "1" };

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
  videos: [{ pageId: "665240903339433", videoIds: ["pending"] }],
  lists: [],
};
const PROSPECTING: ProspectingBudget[] = [{ id: "5001", kind: "adset", name: "Broad · Advantage+", dailyMinor: 6000, adSets: 1 }];
const VIDEOS = Array.from({ length: 15 }, (_, i) => `v${String(i + 1).padStart(2, "0")}`);

function buildFor(): FunnelBuild {
  const plan = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay: "2026-11-27", showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES });
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
  };
}

/** The audiences in the order the build makes them, from the same sources the build reads (all 15 videos under the promoter Page). */
function orderedKeys(): string[] {
  return audiencesToMake(funnelSpecs({ ...SOURCES, videos: [{ pageId: "665240903339433", videoIds: VIDEOS }] })).map((aud) => aud.key);
}

type Call = [string, ...unknown[]];

function setup(opts: { seedProgress?: Record<string, unknown>; audience?: (aud: MakeAudience) => Promise<AudienceMade>; videos?: { contextId: string; videoIds: string[] }[]; createAdSet?: () => Promise<string>; seed?: Record<string, Record<string, unknown>[]> } = {}) {
  const mem = memoryDb({
    retargeting_builds: opts.seedProgress ? [{ event_id: EVENT, user_id: OWNER, state: "failed", mode: "paused", progress: opts.seedProgress }] : [],
    onsale_refresh_audiences: [],
    meta_write_idempotency: [],
    launched_ad_sets: [],
    meta_custom_audiences: [],
    ...(opts.seed ?? {}),
  });
  const calls: Call[] = [];
  let n = 0;
  const id = () => String(80000 + ++n);
  const meta: FunnelMeta = {
    readAd: async (adId) => ({ id: adId, name: "Rudimental · announce", creativeId: "6001", effectiveStatus: "ACTIVE", objectStoryId: null }),
    createCreativeFromPost: async () => id(),
    createCampaign: async (_a, payload) => (calls.push(["createCampaign", payload.name]), id()),
    createAdSet: async (_a, payload) => {
      calls.push(["createAdSet", payload.name, payload.targeting]);
      return opts.createAdSet ? opts.createAdSet() : id();
    },
    createAd: async (_a, ad) => (calls.push(["createAd", ad.adset_id]), id()),
    updateCampaign: async () => undefined,
    setAdSetActive: async () => undefined,
    findCustomConversion: async () => null,
    createCustomConversion: async () => id(),
    readAdSetTargeting: async () => ({ geo_locations: { cities: [{ key: "1" }] } }),
    audienceState: async () => "ready",
    // Run 2's read: the 12 videos with no Page are already dropped; the 15 left carry no Page, so they go under the promoter's.
    listShowVideos: async () => opts.videos ?? [{ contextId: "", videoIds: VIDEOS }],
    readDailyBudget: async () => 6000,
    setDailyBudget: async () => undefined,
  };
  const deps: FunnelDeps = {
    db: mem.db,
    env: ENV_ON,
    meta,
    createAudience: async (aud) => {
      calls.push(["createAudience", aud.key]);
      return opts.audience ? opts.audience(aud) : { metaAudienceId: id() };
    },
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

describe("NX26-RUDIMENTAL: the re-run resumes from progress", () => {
  it("the build reads the 4th audience as the Page followers one (the spec that failed)", () => {
    const keys = orderedKeys();
    assert.match(keys[0]!, /^rf:video75:180:665240903339433:/);
    assert.match(keys[1]!, /^rf:engaged_fb:180:/);
    assert.match(keys[2]!, /^rf:engaged_ig:180:/);
    assert.match(keys[3]!, /^rf:followers_fb:/);
  });

  it("reuses the campaign and the three audiences, makes nothing twice, and a followers create that throws is left out, not a failed build", async () => {
    const keys = orderedKeys();
    const done = { [keys[0]!]: "120252781596960755", [keys[1]!]: "120252781599830755", [keys[2]!]: "120252781602300755" };
    const { calls, deps, ctx, mem } = setup({
      // A copy: the stored row is JSON in prod, never the same object as the test's.
      seedProgress: { campaignId: CAMPAIGN, audiences: { ...done } },
      // The old fault, at the seam: the draft insert refused retention 0.
      audience: async (aud) => {
        if (aud.key.startsWith("rf:followers_fb")) throw new Error('new row for relation "meta_custom_audiences" violates check constraint "meta_custom_audiences_retention_days_check"');
        return { metaAudienceId: `made-${aud.key.slice(0, 20)}` };
      },
    });
    const out = await quiet(() => applyFunnel(deps, buildFor(), ctx));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.deepEqual(named(calls, "createCampaign"), [], "the campaign is reused");
    const asked = named(calls, "createAudience").map((call) => call[1]);
    for (const key of Object.keys(done)) assert.ok(!asked.includes(key), `${key} is reused, not made again`);
    assert.equal(out.progress.campaignId, CAMPAIGN);
    for (const [key, metaId] of Object.entries(done)) assert.equal(out.progress.audiences?.[key], metaId);
    assert.deepEqual(out.progress.skipped?.map((row) => [row.key.split(":")[0] + ":" + row.key.split(":")[1], row.reason]), [["rf:followers_fb", "threw"]]);
    assert.equal(out.progress.skipped?.[0]?.name, "NX26-RUDIMENTAL · Page followers · all time");
    // Cold is built with the three reused audiences and without the followers one.
    const cold = named(calls, "createAdSet").find((call) => String(call[1]).endsWith("· Cold"));
    assert.ok(cold, "Cold is built");
    const coldIncludes = ((cold![2] as { custom_audiences?: { id: string }[] }).custom_audiences ?? []).map((row) => row.id);
    for (const metaId of Object.values(done)) assert.ok(coldIncludes.includes(metaId), `Cold includes ${metaId}`);
    assert.equal(mem.tables.retargeting_builds![0]!.state, "paused");

    // A third run: nothing new at all (the followers source is asked again, the rest isn't).
    calls.length = 0;
    const again = await quiet(() => applyFunnel(deps, buildFor(), ctx));
    assert.equal(again.state, "applied");
    for (const kind of ["createCampaign", "createAdSet", "createAd"]) assert.deepEqual(named(calls, kind), [], `re-run ${kind}`);
    assert.deepEqual(named(calls, "createAudience").map((call) => String(call[1]).split(":")[1]), ["followers_fb"]);
  });

  it("the followers draft now stores 365 (the table's CHECK); Meta is still sent 0 by the payload builder", () => {
    const fb = funnelAudienceDraft({ key: "rf:followers_fb:x", source: "followers", kind: "followers_fb", pageIds: ["665240903339433"] });
    assert.deepEqual([fb.subtype, fb.retentionDays], ["page_followers_fb", 365]);
    assert.ok(fb.retentionDays > 0 && fb.retentionDays <= 365);
  });
});

describe("a source left out with a reason, the tier built without it", () => {
  it("Meta refuses a followers audience: skipped as refused, every tier still builds", async () => {
    const { calls, deps, ctx } = setup({ audience: async (aud) => (aud.kind === "followers_fb" || aud.kind === "followers_ig" ? { skipped: "refused", error: "Invalid rule (code 2654, subcode 1713214)" } : { metaAudienceId: `m-${aud.key.length}-${Math.random()}` }) });
    const out = await quiet(() => applyFunnel(deps, buildFor(), ctx));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.deepEqual(out.progress.skipped?.map((row) => [row.key.split(":")[1], row.reason]), [["followers_fb", "refused"], ["followers_ig", "refused"]]);
    assert.deepEqual(Object.keys(out.progress.adSets ?? {}).sort(), ["cold", "hot", "warm"]);
    assert.ok(named(calls, "createAd").length > 0);
  });

  it("Meta's audience list couldn't be read: the source is left out as unsure (never made blind)", async () => {
    const { deps, ctx } = setup({ audience: async (aud) => (aud.kind === "video" ? { skipped: "unsure", error: "Not made: Meta's audience list couldn't be read" } : { metaAudienceId: `m-${aud.key}` }) });
    const out = await quiet(() => applyFunnel(deps, buildFor(), ctx));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.deepEqual(out.progress.skipped?.map((row) => [row.key.split(":")[0], row.reason]), [["rf", "unsure"], ["rf", "unsure"]]);
    assert.ok(out.progress.skipped?.every((row) => row.key.startsWith("rf:video")));
  });

  it("no videos left to build from: video viewers are left out with a line, the build goes on", async () => {
    const { calls, deps, ctx } = setup({ videos: [] });
    const out = await quiet(() => applyFunnel(deps, buildFor(), ctx));
    assert.equal(out.state, "applied", out.reason ?? "");
    assert.deepEqual(out.progress.skipped?.map((row) => [row.key, row.reason]), [["rf:video", "nothing"]]);
    assert.ok(!named(calls, "createAudience").some((call) => String(call[1]).startsWith("rf:video")));
  });

  it("an audience with nothing in it is never sent to the seam", () => {
    assert.equal(audienceHasNothing({ key: "rf:video95:60:p:x", source: "video95", kind: "video", pageId: "p", videoIds: [], threshold: 95, retentionDays: 60 }), true);
    assert.equal(audienceHasNothing({ key: "rf:followers_fb:x", source: "followers", kind: "followers_fb", pageIds: [] }), true);
    assert.equal(audienceHasNothing({ key: "rf:followers_fb:x", source: "followers", kind: "followers_fb", pageIds: ["1"] }), false);
  });

  it("the app's own ready audience for the show (same subtype, source and window) is reused before any create", async () => {
    const fb = funnelAudienceDraft({ key: "k", source: "followers", kind: "followers_fb", pageIds: ["665240903339433"] });
    const { calls, deps, ctx } = setup({
      seed: { meta_custom_audiences: [{ event_id: EVENT, meta_ad_account_id: "606252931141334", audience_subtype: fb.subtype, source_id: fb.sourceId, retention_days: 365, status: "ready", meta_audience_id: "120299999999990001", created_at: "2026-11-26T10:00:00Z" }] },
    });
    const out = await quiet(() => applyFunnel(deps, buildFor(), ctx));
    assert.equal(out.state, "applied", out.reason ?? "");
    const key = Object.keys(out.progress.audiences ?? {}).find((k) => k.startsWith("rf:followers_fb"))!;
    assert.equal(out.progress.audiences![key], "120299999999990001");
    assert.ok(!named(calls, "createAudience").some((call) => String(call[1]).startsWith("rf:followers_fb")), "not made again");
  });
});

describe("a failing step says where, with Meta's error and no token", () => {
  it("the Cold ad set's create throws: step adset, spec key cold, Meta's code, subcode and fbtrace_id", async () => {
    const err = Object.assign(new Error("Invalid parameter access_token=EAAB1234567890abcdefghijklmnop"), { code: 100, subcode: 1487756, fbtraceId: "AbCdEf123", type: "OAuthException" });
    const { deps, ctx } = setup({ createAdSet: async () => { throw err; } });
    const out = await quiet(() => applyFunnel(deps, buildFor(), ctx));
    assert.equal(out.state, "failed");
    assert.equal(out.step, "adset");
    assert.equal(out.specKey, "cold");
    assert.equal(out.metaError?.code, 100);
    assert.equal(out.metaError?.subcode, 1487756);
    assert.equal(out.metaError?.fbtraceId, "AbCdEf123");
    assert.doesNotMatch(JSON.stringify(out.metaError), /EAAB1234567890/);
    assert.doesNotMatch(out.error ?? "", /EAAB1234567890/);
  });

  it("metaErrorDetail reads a formatted status_error and scrubs tokens", () => {
    const detail = metaErrorDetail(new Error("Can't Choose Data Time Limit (code 2654, subcode 1713214, fbtrace_id XyZ_9) https://graph.facebook.com/x?access_token=EAAsecretsecretsecretsecret&y=1"));
    assert.deepEqual([detail.code, detail.subcode, detail.fbtraceId], [2654, 1713214, "XyZ_9"]);
    assert.doesNotMatch(detail.message, /EAAsecret/);
    assert.match(detail.message, /access_token=REDACTED/);
  });
});

describe("never a second copy when Meta's list can't be read", () => {
  it("the audience write refuses before any POST under onLookupFailed: refuse, and the retargeting seam asks for it", () => {
    const write = readFileSync("lib/meta/audience-write.ts", "utf8");
    const refuse = write.indexOf('if (lookupFailed && options.onLookupFailed === "refuse") throw new ExistingLookupUnavailableError');
    const create = write.indexOf("const outcome = await reuseOrCreateCustomAudience(");
    assert.ok(refuse > 0 && refuse < create, "the refusal comes before the reuse-or-create (no POST)");
    const seam = readFileSync("lib/mcp/retargeting-deps.ts", "utf8");
    assert.match(seam, /audiences\.createAudience\(\{ userId, insert: insert as never, onLookupFailed: "refuse" \}\)/);
    assert.match(seam, /skipped: made\.lookupUnavailable \? "unsure" : "refused"/);
  });
});
