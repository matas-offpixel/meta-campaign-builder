import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { testsCampaignName } from "../../creative-tests/words.ts";
import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import {
  copyTestAdSetPayload,
  copyTestCampaignPayload,
  copyTestCardPayload,
  copyTestCreativePayload,
  copyTestEndTime,
  copyTestLockFilter,
  copyTestName,
  copyTestWriteCount,
  createCopyTest,
  CopyTestStop,
  type CopyTestMeta,
  type CopyTestSpec,
} from "../copy-test-campaign.ts";

const SOURCE_ADSET = {
  id: "120252504502750755",
  name: "Lineup - Suggested",
  campaign_id: "120252504415460755",
  status: "ACTIVE",
  targeting: { age_min: 18, age_max: 45, geo_locations: { cities: [{ key: "1" }] }, custom_audiences: [{ id: "9" }], targeting_automation: { advantage_audience: 0 }, publisher_platforms: ["facebook", "instagram"], instagram_positions: ["stream"] },
  optimization_goal: "OFFSITE_CONVERSIONS",
  billing_event: "IMPRESSIONS",
  promoted_object: { pixel_id: "645185673672763", custom_event_type: "INITIATED_CHECKOUT", smart_pse_enabled: false },
  attribution_spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }],
  destination_type: "WEBSITE",
  bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  daily_budget: "200",
  lifetime_budget: "0",
  start_time: "2026-11-06T18:24:33+0000",
  end_time: "2026-12-11T23:59:00+0000",
  is_dynamic_creative: false,
};

const VIDEO_CREATIVE = {
  name: "Newcastle! Excited to be back soon.",
  object_story_spec: {
    page_id: "640971025955376",
    instagram_user_id: "17841400928229769",
    video_data: { video_id: "3327294087471844", message: "Newcastle! Excited to be back soon.", image_url: "https://example.test/thumb", image_hash: "e557", call_to_action: { type: "BOOK_NOW", value: { link: "https://www.locklead-newcastle.com/?ref=meta" } } },
  },
  degrees_of_freedom_spec: { creative_features_spec: { inline_comment: { enroll_status: "OPT_IN" } } },
};

const FEED_CREATIVE = {
  object_story_spec: { page_id: "103824529223927", instagram_user_id: "17841456620568454" },
  url_tags: "utm_source=meta",
  asset_feed_spec: {
    optimization_type: "PLACEMENT",
    bodies: [{ text: "Old body" }],
    titles: [{ text: "Title" }],
    images: [{ hash: "f1", adlabels: [{ name: "feed_asset", id: "111" }] }, { hash: "s1", adlabels: [{ name: "story_asset", id: "222" }] }],
    asset_customization_rules: [{ priority: 1, image_label: { name: "story_asset", id: "222" }, customization_spec: { publisher_platforms: ["instagram"] } }],
    call_to_action_types: ["BOOK_TRAVEL"],
  },
};

describe("names", () => {
  it("'{code} · AB copy test' is not the creative-tests campaign's name", () => {
    assert.equal(copyTestName("NX26-LOCKLEAD"), "NX26-LOCKLEAD · AB copy test");
    assert.notEqual(copyTestName("NX26-LOCKLEAD"), testsCampaignName("NX26-LOCKLEAD"));
    assert.equal(copyTestName("P26-BDAY").includes(" · Tests"), false);
  });
});

describe("the end time: 23:59 London, 4 days after creation", () => {
  it("in winter (GMT)", () => {
    assert.deepEqual(copyTestEndTime(new Date("2026-11-17T15:00:00Z")), { day: "2026-11-21", endTime: "2026-11-21T23:59:00+0000" });
  });
  it("late evening UTC that is already the next London day in summer", () => {
    assert.deepEqual(copyTestEndTime(new Date("2026-06-30T23:30:00Z")), { day: "2026-07-05", endTime: "2026-07-05T23:59:00+0100" });
  });
});

describe("the campaign", () => {
  it("OUTCOME_SALES, paused, the budget in pence as given", () => {
    const p = copyTestCampaignPayload("NX26-DOD · AB copy test", 76);
    assert.equal(p.objective, "OUTCOME_SALES");
    assert.equal(p.status, "PAUSED");
    assert.equal(p.daily_budget, 76);
    assert.equal(p.bid_strategy, "LOWEST_COST_WITHOUT_CAP");
    assert.equal("lifetime_budget" in p, false);
  });
  it("refuses a budget that isn't whole pence", () => {
    assert.throws(() => copyTestCampaignPayload("x", 0.76), /whole number of pence/);
  });
});

describe("the ad set copy", () => {
  it("keeps targeting, goal, promoted object and attribution; paused; no budget or bid of its own; the test's end", () => {
    const p = copyTestAdSetPayload(SOURCE_ADSET, { campaignId: "c1", name: "NX26-LOCKLEAD · AB copy test", endTime: "2026-11-21T23:59:00+0000" });
    assert.deepEqual(p.targeting, SOURCE_ADSET.targeting);
    assert.deepEqual(p.promoted_object, { pixel_id: "645185673672763", custom_event_type: "INITIATED_CHECKOUT" });
    assert.equal(p.optimization_goal, "OFFSITE_CONVERSIONS");
    assert.deepEqual(p.attribution_spec, SOURCE_ADSET.attribution_spec);
    assert.equal(p.status, "PAUSED");
    assert.equal(p.campaign_id, "c1");
    assert.equal(p.end_time, "2026-11-21T23:59:00+0000");
    for (const key of ["daily_budget", "lifetime_budget", "bid_strategy", "start_time", "id"]) assert.equal(key in p, false, key);
  });
  it("Julian's ADD_TO_CART goal is copied, not replaced", () => {
    const p = copyTestAdSetPayload({ ...SOURCE_ADSET, promoted_object: { pixel_id: "1", custom_event_type: "ADD_TO_CART" } }, { campaignId: "c", name: "n", endTime: "e" });
    assert.deepEqual(p.promoted_object, { pixel_id: "1", custom_event_type: "ADD_TO_CART" });
  });
});

describe("the creatives: only the primary text changes", () => {
  it("video: same video, thumbnail hash, button, link, page and Instagram account", () => {
    const p = copyTestCreativePayload(VIDEO_CREATIVE, { name: "[AB-A] Artist - UGC 3", message: "A line\nTickets on sale now." });
    const oss = p.object_story_spec as Record<string, Record<string, unknown>>;
    assert.equal(oss.page_id as unknown, "640971025955376");
    assert.equal(oss.instagram_user_id as unknown, "17841400928229769");
    assert.equal(oss.video_data.video_id, "3327294087471844");
    assert.equal(oss.video_data.image_hash, "e557");
    assert.equal("image_url" in oss.video_data, false);
    assert.deepEqual(oss.video_data.call_to_action, VIDEO_CREATIVE.object_story_spec.video_data.call_to_action);
    assert.equal(oss.video_data.message, "A line\nTickets on sale now.");
    const features = (p.degrees_of_freedom_spec as { creative_features_spec: Record<string, { enroll_status: string }> }).creative_features_spec;
    assert.equal(features.STANDARD_ENHANCEMENTS_CATALOG?.enroll_status, "OPT_OUT");
  });
  it("A and B differ only in the text", () => {
    const a = copyTestCreativePayload(VIDEO_CREATIVE, { name: "n", message: "A" });
    const b = copyTestCreativePayload(VIDEO_CREATIVE, { name: "n", message: "B" });
    const strip = (p: Record<string, unknown>) => JSON.stringify(p).replace(/"message":"[AB]"/, "");
    assert.equal(strip(a), strip(b));
  });
  it("placement creative: every asset and rule kept, label ids dropped, the one body replaced", () => {
    const p = copyTestCreativePayload(FEED_CREATIVE, { name: "n", message: "New body" });
    const afs = p.asset_feed_spec as Record<string, unknown>;
    assert.deepEqual(afs.bodies, [{ text: "New body" }]);
    assert.deepEqual(afs.titles, [{ text: "Title" }]);
    assert.deepEqual(afs.images, [{ hash: "f1", adlabels: [{ name: "feed_asset" }] }, { hash: "s1", adlabels: [{ name: "story_asset" }] }]);
    assert.deepEqual((afs.asset_customization_rules as Record<string, unknown>[])[0].image_label, { name: "story_asset" });
    assert.deepEqual(p.object_story_spec, { page_id: "103824529223927", instagram_user_id: "17841456620568454" });
    assert.equal(p.url_tags, "utm_source=meta");
  });
  it("card: the source's page, Instagram account, link and button, with the card's image", () => {
    const p = copyTestCardPayload(VIDEO_CREATIVE, { name: "[CARD-HEADLINER]", message: "Kream line", imageHash: "h1" });
    assert.deepEqual((p.object_story_spec as Record<string, unknown>).link_data, {
      image_hash: "h1",
      link: "https://www.locklead-newcastle.com/?ref=meta",
      message: "Kream line",
      call_to_action: { type: "BOOK_NOW", value: { link: "https://www.locklead-newcastle.com/?ref=meta" } },
    });
  });
});

function fakeMeta(over: Partial<CopyTestMeta> = {}) {
  const calls: string[] = [];
  let n = 0;
  const meta: CopyTestMeta = {
    readAdSet: async () => SOURCE_ADSET,
    readCreative: async () => VIDEO_CREATIVE,
    readMinDailyBudget: async () => 76,
    createCampaign: async (_a, p) => (calls.push(`campaign ${p.status} ${p.daily_budget}`), `cmp${++n}`),
    createAdSet: async (_a, p) => (calls.push(`adset ${p.status} ${p.campaign_id}`), `set${++n}`),
    uploadImage: async (_a, img) => (calls.push(`image ${img.fileName}`), `hash${++n}`),
    createCreative: async (_a, p) => (calls.push(`creative ${p.name}`), `cr${++n}`),
    createAd: async (_a, p) => (calls.push(`ad ${p.status} ${p.adset_id}`), `ad${++n}`),
    ...over,
  };
  return { meta, calls };
}

const SPEC: CopyTestSpec = {
  eventCode: "NX26-DOD",
  campaignName: "NX26-DOD · AB copy test",
  adSetName: "NX26-DOD · AB copy test",
  adAccountId: "606252931141334",
  dailyMinor: 76,
  sourceAdSetId: "120252309614100755",
  sourceCreativeId: "1112160641684081",
  ads: [
    { kind: "copy", label: "A", adName: "[AB-A] Artist - UGC 3", message: "A\nTickets on sale now." },
    { kind: "copy", label: "B", adName: "[AB-B] Artist - UGC 3", message: "B\nTickets on sale now." },
  ],
};

function setup() {
  const mem = memoryDb({ meta_write_idempotency: [] });
  const recorded: string[] = [];
  const record = {
    adSet: async (row: { metaAdsetId: string }) => void recorded.push(`adset ${row.metaAdsetId}`),
    ad: async (row: { metaAdId: string }) => void recorded.push(`ad ${row.metaAdId}`),
  };
  let held = false;
  const lock = { acquire: async () => (held ? false : (held = true)), release: async () => void (held = false) };
  return { mem, recorded, lock, deps: (meta: CopyTestMeta) => ({ meta, ledger: { supabase: mem.db, userId: "u1", draftId: "d1", eventId: "e1" }, record, lock, now: new Date("2026-11-17T15:00:00Z") }) };
}

describe("createCopyTest", () => {
  it("campaign → ad set → creative + ad per line, all paused, each recorded; 6 writes", async () => {
    const { meta, calls } = fakeMeta();
    const s = setup();
    const out = await createCopyTest(s.deps(meta), SPEC);
    assert.deepEqual(calls, ["campaign PAUSED 76", "adset PAUSED cmp1", "creative [AB-A] Artist - UGC 3", "ad PAUSED set2", "creative [AB-B] Artist - UGC 3", "ad PAUSED set2"]);
    assert.deepEqual(s.recorded, ["adset set2", "ad ad4", "ad ad6"]);
    assert.equal(out.writes, 6);
    assert.equal(copyTestWriteCount(SPEC), 6);
    assert.equal(out.endTime, "2026-11-21T23:59:00+0000");
  });

  it("a rerun returns the same ids and sends nothing", async () => {
    const { meta, calls } = fakeMeta();
    const s = setup();
    const first = await createCopyTest(s.deps(meta), SPEC);
    calls.length = 0;
    const second = await createCopyTest({ ...s.deps(meta), now: new Date("2026-11-18T10:00:00Z") }, SPEC);
    assert.deepEqual(calls, []);
    assert.equal(second.writes, 0);
    assert.equal(second.campaignId, first.campaignId);
    assert.deepEqual(second.ads.map((a) => a.adId), first.ads.map((a) => a.adId));
  });

  it("a failed ad stops the run; a rerun makes only what's missing", async () => {
    let fail = true;
    const { meta, calls } = fakeMeta();
    const flaky = { ...meta, createAd: async (a: string, p: Record<string, unknown>) => { if (fail && String(p.name).includes("AB-B")) throw new Error("Meta said no"); return meta.createAd(a, p); } };
    const s = setup();
    await assert.rejects(createCopyTest(s.deps(flaky), SPEC), /Meta said no/);
    fail = false;
    calls.length = 0;
    const out = await createCopyTest(s.deps(flaky), SPEC);
    assert.deepEqual(calls, ["ad PAUSED set2"]);
    assert.equal(out.ads.length, 2);
  });

  it("under the account's minimum: nothing is made", async () => {
    const { meta, calls } = fakeMeta({ readMinDailyBudget: async () => 100 });
    await assert.rejects(createCopyTest(setup().deps(meta), SPEC), (err: unknown) => err instanceof CopyTestStop && /under act_606252931141334's minimum of 100/.test(err.message));
    assert.deepEqual(calls, []);
  });

  it("an unreadable source ad set: nothing is made", async () => {
    const { meta, calls } = fakeMeta({ readAdSet: async () => null });
    await assert.rejects(createCopyTest(setup().deps(meta), SPEC), CopyTestStop);
    assert.deepEqual(calls, []);
  });

  it("without the ledger nothing is sent", async () => {
    const { meta, calls } = fakeMeta();
    await assert.rejects(createCopyTest({ meta, ledger: { supabase: setup().mem.db, userId: "u1", draftId: "", eventId: null }, record: { adSet: async () => {}, ad: async () => {} }, lock: setup().lock }, SPEC), /ledger is required/);
    assert.deepEqual(calls, []);
  });

  it("cards: an image upload, a creative and an ad each; 2 + 4 × 3 = 14 writes", async () => {
    const { meta, calls } = fakeMeta();
    const cards: CopyTestSpec = {
      ...SPEC,
      ads: ["Kream", "Estiva", "LeenaPunks", "Parts"].map((name) => ({ kind: "card" as const, label: name, adName: `[CARD] ${name}`, message: "Kream line", image: { fileName: `${name}.jpg`, bytes: new Uint8Array([1]) } })),
    };
    const out = await createCopyTest(setup().deps(meta), cards);
    assert.equal(out.writes, 14);
    assert.equal(copyTestWriteCount(cards), 14);
    assert.deepEqual(calls.slice(2, 5), ["image Kream.jpg", "creative [CARD] Kream", "ad PAUSED set2"]);
  });

  it("two overlapping runs of one test: the second makes nothing (the 17 Nov P26 duplicate)", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const { meta, calls } = fakeMeta();
    const slow = { ...meta, createAdSet: async (a: string, p: Record<string, unknown>) => { await gate; return meta.createAdSet(a, p); } };
    const s = setup();
    const first = createCopyTest(s.deps(slow), SPEC);
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(createCopyTest(s.deps(slow), SPEC), (err: unknown) => err instanceof CopyTestStop && /Another run of NX26-DOD · AB copy test is in progress/.test(err.message));
    releaseFirst();
    const out = await first;
    assert.equal(calls.filter((c) => c.startsWith("adset")).length, 1);
    assert.equal(calls.filter((c) => c.startsWith("ad ")).length, 2);
    assert.equal(out.writes, 6);
  });

  it("the lock is released after a failed run, so a rerun can pick up", async () => {
    const { meta } = fakeMeta({ readAdSet: async () => null });
    const s = setup();
    await assert.rejects(createCopyTest(s.deps(meta), SPEC), CopyTestStop);
    assert.equal(await s.lock.acquire(), true);
  });

  it("the lock filter claims a test with no run, or a run older than the cutoff", () => {
    assert.equal(copyTestLockFilter("2026-11-17T11:40:00.000Z"), 'draft_json->copyTestRun.is.null,draft_json->copyTestRun->>at.lt."2026-11-17T11:40:00.000Z"');
  });
});
