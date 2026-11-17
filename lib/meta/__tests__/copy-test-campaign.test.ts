import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { testsCampaignName } from "../../creative-tests/words.ts";
import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import {
  copyTestAdSetPayload,
  copyTestCardPayload,
  copyTestCreativePayload,
  copyTestEndTime,
  copyTestLockFilter,
  copyTestName,
  copyTestWriteCount,
  assertPromoterIdentity,
  createCopyTest,
  CopyTestStop,
  promoterIdentities,
  repointCopyTestAds,
  withRuledIdentity,
  artistCardIdentities,
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
    page_id: "259905047197071",
    instagram_user_id: "17841460869627228",
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

describe("the ad set copy", () => {
  it("keeps targeting, goal, promoted object and attribution; its own daily budget at lowest cost; ACTIVE; the test's end", () => {
    const p = copyTestAdSetPayload(SOURCE_ADSET, { campaignId: "c1", name: "NX26-LOCKLEAD · AB copy test", endTime: "2026-11-21T23:59:00+0000", dailyMinor: 300, status: "ACTIVE" });
    assert.deepEqual(p.targeting, SOURCE_ADSET.targeting);
    assert.deepEqual(p.promoted_object, { pixel_id: "645185673672763", custom_event_type: "INITIATED_CHECKOUT" });
    assert.equal(p.optimization_goal, "OFFSITE_CONVERSIONS");
    assert.deepEqual(p.attribution_spec, SOURCE_ADSET.attribution_spec);
    assert.equal(p.status, "ACTIVE");
    assert.equal(p.campaign_id, "c1");
    assert.equal(p.daily_budget, 300);
    assert.equal(p.bid_strategy, "LOWEST_COST_WITHOUT_CAP");
    assert.equal(p.end_time, "2026-11-21T23:59:00+0000");
    for (const key of ["lifetime_budget", "start_time", "id"]) assert.equal(key in p, false, key);
  });
  it("created paused on request; a budget that isn't whole pence is refused", () => {
    assert.equal(copyTestAdSetPayload(SOURCE_ADSET, { campaignId: "c", name: "n", endTime: "e", dailyMinor: 76, status: "PAUSED" }).status, "PAUSED");
    assert.throws(() => copyTestAdSetPayload(SOURCE_ADSET, { campaignId: "c", name: "n", endTime: "e", dailyMinor: 0.76, status: "ACTIVE" }), /whole number of pence/);
  });
  it("Julian's ADD_TO_CART goal is copied, not replaced", () => {
    const p = copyTestAdSetPayload({ ...SOURCE_ADSET, promoted_object: { pixel_id: "1", custom_event_type: "ADD_TO_CART" } }, { campaignId: "c", name: "n", endTime: "e", dailyMinor: 76, status: "ACTIVE" });
    assert.deepEqual(p.promoted_object, { pixel_id: "1", custom_event_type: "ADD_TO_CART" });
  });
});

describe("the creatives: only the primary text changes", () => {
  it("video: same video, thumbnail hash, button, link, page and Instagram account", () => {
    const p = copyTestCreativePayload(VIDEO_CREATIVE, { name: "[AB-A] Artist - UGC 3", message: "A line\nTickets on sale now." });
    const oss = p.object_story_spec as Record<string, Record<string, unknown>>;
    assert.equal(oss.page_id as unknown, "259905047197071");
    assert.equal(oss.instagram_user_id as unknown, "17841460869627228");
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

function fakeMeta(over: Partial<CopyTestMeta> = {}, campaigns: { id: string; name: string; status?: string; daily_budget?: string; lifetime_budget?: string }[] = []) {
  const calls: string[] = [];
  let n = 0;
  const meta: CopyTestMeta = {
    readAdSet: async () => SOURCE_ADSET,
    readCreative: async () => VIDEO_CREATIVE,
    readMinDailyBudget: async () => 76,
    listCampaigns: async () => campaigns,
    createCampaign: async (_a, p) => {
      calls.push(`campaign ${p.status} ${"daily_budget" in p || "lifetime_budget" in p ? "with a budget" : "no budget"}`);
      const id = `cmp${++n}`;
      campaigns.push({ id, name: String(p.name), status: String(p.status) });
      return id;
    },
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
  campaignName: "NX26-DOD · Tests",
  adSetName: "NX26-DOD · AB copy test",
  adAccountId: "606252931141334",
  dailyMinor: 76,
  sourceAdSetId: "120252309614100755",
  sourceCreativeId: "1112160641684081",
  identities: [{ pageId: "259905047197071", instagramId: "17841460869627228" }],
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
    assert.deepEqual(calls, ["campaign ACTIVE no budget", "adset ACTIVE cmp1", "creative [AB-A] Artist - UGC 3", "ad ACTIVE set2", "creative [AB-B] Artist - UGC 3", "ad ACTIVE set2"]);
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
    assert.deepEqual(calls, ["ad ACTIVE set2"]);
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
    assert.deepEqual(calls.slice(2, 5), ["image Kream.jpg", "creative [CARD] Kream", "ad ACTIVE set2"]);
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

const NX_LOVES = { pageId: "259905047197071", instagramId: "17841460869627228" };
const LOCKLEAD_ARTIST = { page_id: "640971025955376", instagram_user_id: "17841400928229769" };

describe("the promoter identity guard", () => {
  const pages = [
    { id: "259905047197071", category: "Live music venue", linkedInstagramId: "17841460869627228" },
    { id: "640971025955376", category: "Musician/band", linkedInstagramId: "17841400928229769" },
    { id: "103824529223927", category: "Event", linkedInstagramId: "17841456620568454" },
    { id: "454884974621000", category: "Artist", linkedInstagramId: "17841402061405557" },
  ];
  it("from data: the show's non-artist pages with their own Instagram; artist pages and an unpromotable client page left out", () => {
    const ids = promoterIdentities({ clientPageIds: ["103824529223927"], promotablePageIds: ["259905047197071", "640971025955376"], showAdPageIds: ["640971025955376", "259905047197071"], pages });
    assert.deepEqual(ids, [NX_LOVES]);
  });
  it("a show with only artist ads and a wrong client record has no list (Robbie Doherty, Kream)", () => {
    assert.deepEqual(promoterIdentities({ clientPageIds: ["103824529223927"], promotablePageIds: ["454884974621000"], showAdPageIds: ["454884974621000"], pages }), []);
  });
  it("the client's page counts when it is promotable on the account", () => {
    assert.deepEqual(promoterIdentities({ clientPageIds: ["103824529223927"], promotablePageIds: ["103824529223927"], showAdPageIds: [], pages }), [{ pageId: "103824529223927", instagramId: "17841456620568454" }]);
  });
  it("an artist page fails", () => {
    const payload = copyTestCreativePayload({ ...VIDEO_CREATIVE, object_story_spec: { ...VIDEO_CREATIVE.object_story_spec, ...LOCKLEAD_ARTIST } }, { name: "[AB-A] Artist - UGC 3", message: "A" });
    assert.throws(() => assertPromoterIdentity("NX26-LOCKLEAD", payload, [NX_LOVES]), (err: unknown) => err instanceof CopyTestStop && /page 640971025955376 \/ Instagram 17841400928229769, which isn't NX26-LOCKLEAD's promoter or venue page/.test(err.message));
  });
  it("the promoter page with an artist's Instagram fails (DOD's dj_dod)", () => {
    const payload = copyTestCreativePayload({ ...VIDEO_CREATIVE, object_story_spec: { ...VIDEO_CREATIVE.object_story_spec, instagram_user_id: "17841400834660844" } }, { name: "n", message: "A" });
    assert.throws(() => assertPromoterIdentity("NX26-DOD", payload, [NX_LOVES]), CopyTestStop);
  });
  it("no list: refused", () => {
    assert.throws(() => assertPromoterIdentity("NX26-ROBBIEDOHERTY", copyTestCreativePayload(VIDEO_CREATIVE, { name: "n", message: "A" }), []), /has no promoter or venue page on record/);
  });
  it("createCopyTest from an artist creative: nothing is made", async () => {
    const { meta, calls } = fakeMeta({ readCreative: async () => ({ ...VIDEO_CREATIVE, object_story_spec: { ...VIDEO_CREATIVE.object_story_spec, ...LOCKLEAD_ARTIST } }) });
    await assert.rejects(createCopyTest(setup().deps(meta), SPEC), CopyTestStop);
    assert.deepEqual(calls, []);
  });
});

describe("repointCopyTestAds", () => {
  const ARTIST_CREATIVE = { ...VIDEO_CREATIVE, object_story_spec: { ...VIDEO_CREATIVE.object_story_spec, ...LOCKLEAD_ARTIST } };
  function repointMeta(over: Partial<CopyTestMeta> = {}) {
    const base = fakeMeta();
    const creatives: Record<string, Record<string, unknown>> = { old: ARTIST_CREATIVE };
    const ads: Record<string, { name: string; creativeId: string }> = { adA: { name: "[AB-A] Artist - UGC 3", creativeId: "old" }, adB: { name: "[AB-B] Artist - UGC 3", creativeId: "old" } };
    const meta: CopyTestMeta = {
      ...base.meta,
      readCreative: async (id) => creatives[id] ?? VIDEO_CREATIVE,
      createCreative: async (_a, p) => { base.calls.push(`creative ${p.name}`); const id = `cr${base.calls.length}`; creatives[id] = p; return id; },
      readAd: async (id) => (ads[id] ? { id, name: ads[id].name, adsetId: "set1", campaignId: "cmp1", status: "PAUSED", creativeId: ads[id].creativeId } : null),
      updateAd: async (id, f) => { base.calls.push(`update ${id} ${f.name}`); ads[id] = { name: f.name, creativeId: f.creative.creative_id }; },
      archiveAd: async (id) => void base.calls.push(`archive ${id}`),
      ...over,
    };
    return { meta, calls: base.calls };
  }
  const REPOINT: CopyTestSpec = { ...SPEC, sourceCreativeId: "promo", ads: [{ kind: "copy", label: "A", adName: "[AB-A] Promo Vid", message: "A\nTickets on sale now." }, { kind: "copy", label: "B", adName: "[AB-B] Promo Vid", message: "B\nTickets on sale now." }] };
  const EXISTING = [{ label: "A", adId: "adA", mode: "source" as const }, { label: "B", adId: "adB", mode: "source" as const }];

  it("per ad: a promoter creative, then the ad swapped onto it with its new name; no status write; 4 writes", async () => {
    const { meta, calls } = repointMeta();
    const out = await repointCopyTestAds(setup().deps(meta), REPOINT, EXISTING, NX_LOVES);
    assert.deepEqual(calls, ["creative [AB-A] Promo Vid", "update adA [AB-A] Promo Vid", "creative [AB-B] Promo Vid", "update adB [AB-B] Promo Vid"]);
    assert.deepEqual(out.ads.map((a) => a.action), ["repointed", "repointed"]);
    assert.equal(out.writes, 4);
  });
  it("a rerun leaves the swapped ads alone and sends nothing", async () => {
    const { meta, calls } = repointMeta();
    const s = setup();
    await repointCopyTestAds(s.deps(meta), REPOINT, EXISTING, NX_LOVES);
    calls.length = 0;
    const again = await repointCopyTestAds(s.deps(meta), REPOINT, EXISTING, NX_LOVES);
    assert.deepEqual(calls, []);
    assert.deepEqual(again.ads.map((a) => a.action), ["already", "already"]);
  });
  it("Meta refuses the swap: the old ad is archived (never deleted) and a new paused ad made in the same ad set", async () => {
    const archived: string[] = [];
    const { meta, calls } = repointMeta({ updateAd: async () => { throw new Error("Can't change the page of an existing ad"); } });
    const s = setup();
    const out = await repointCopyTestAds({ ...s.deps(meta), record: { adSet: async () => {}, ad: async () => {}, archivedAd: async (r) => void archived.push(`${r.metaAdId}->${r.replacedBy}`) } }, REPOINT, EXISTING, NX_LOVES);
    assert.deepEqual(calls.filter((c) => c.startsWith("archive") || c.startsWith("ad ")), ["archive adA", "ad PAUSED set1", "archive adB", "ad PAUSED set1"]);
    assert.deepEqual(out.ads.map((a) => [a.action, a.archivedAdId]), [["replaced", "adA"], ["replaced", "adB"]]);
    assert.equal(archived.length, 2);
  });
  it("an artist source posts as the ruled promoter page, not the artist's", async () => {
    const { meta } = repointMeta({ readCreative: async (id) => (id === "promo" ? ARTIST_CREATIVE : ARTIST_CREATIVE) });
    const made: Record<string, unknown>[] = [];
    const s = setup();
    await repointCopyTestAds({ ...s.deps({ ...meta, createCreative: async (_a, p) => (made.push(p), `cr${made.length}`) }) }, REPOINT, EXISTING, NX_LOVES);
    assert.deepEqual(made.map((p) => p.object_story_spec && { page: (p.object_story_spec as Record<string, unknown>).page_id, ig: (p.object_story_spec as Record<string, unknown>).instagram_user_id }), [{ page: NX_LOVES.pageId, ig: NX_LOVES.instagramId }, { page: NX_LOVES.pageId, ig: NX_LOVES.instagramId }]);
  });
  it("postAs an artist page: nothing is sent", async () => {
    const { meta, calls } = repointMeta();
    await assert.rejects(repointCopyTestAds(setup().deps(meta), REPOINT, EXISTING, { pageId: LOCKLEAD_ARTIST.page_id, instagramId: LOCKLEAD_ARTIST.instagram_user_id }), CopyTestStop);
    assert.deepEqual(calls, []);
  });
  it("identity mode (a card): same image, link, button, text and name; only the page and Instagram change", async () => {
    const CARD = { object_story_spec: { page_id: "454884974621000", instagram_user_id: "17841402061405557", link_data: { image_hash: "h1", link: "https://www.kream-bristol.com/", message: "Kream line", call_to_action: { type: "BOOK_TRAVEL", value: { link: "https://www.kream-bristol.com/" } } } } };
    const BRISTOL = { pageId: "1593045637629255", instagramId: "17841401923285132" };
    const made: Record<string, unknown>[] = [];
    const updates: string[] = [];
    const meta = {
      ...fakeMeta().meta,
      readCreative: async () => CARD,
      readAd: async (id: string) => ({ id, name: "[CARD-HEADLINER]", adsetId: "set1", campaignId: "cmp1", status: "PAUSED", creativeId: "old" }),
      createCreative: async (_a: string, p: Record<string, unknown>) => (made.push(p), "new1"),
      updateAd: async (id: string, f: { name: string }) => void updates.push(`${id} ${f.name}`),
      archiveAd: async () => {},
    };
    const spec = { ...REPOINT, identities: [BRISTOL] };
    const out = await repointCopyTestAds(setup().deps(meta), spec, [{ label: "headliner", adId: "card1", mode: "identity" }], BRISTOL);
    assert.deepEqual((made[0].object_story_spec as Record<string, unknown>), { page_id: BRISTOL.pageId, instagram_user_id: BRISTOL.instagramId, link_data: CARD.object_story_spec.link_data });
    assert.equal(made[0].name, "[CARD-HEADLINER]");
    assert.deepEqual(updates, ["card1 [CARD-HEADLINER]"]);
    assert.equal(out.writes, 2);
  });
});

describe("single-image sources and ruled pages", () => {
  it("a link_data source (lineup artwork): same image, link and button, the approved line, posted as the given page", () => {
    const LINEUP = { object_story_spec: { page_id: LOCKLEAD_ARTIST.page_id, instagram_user_id: LOCKLEAD_ARTIST.instagram_user_id, link_data: { image_hash: "9625aa8f", link: "https://www.locklead-newcastle.com/", message: "Newcastle! Excited to be back soon.", call_to_action: { type: "BOOK_NOW", value: { link: "https://www.locklead-newcastle.com/" } } } } };
    const p = copyTestCreativePayload(LINEUP, { name: "[AB-A] Artist - Static Lineup", message: "A line", postAs: NX_LOVES });
    assert.deepEqual(p.object_story_spec, { page_id: NX_LOVES.pageId, instagram_user_id: NX_LOVES.instagramId, link_data: { image_hash: "9625aa8f", link: "https://www.locklead-newcastle.com/", message: "A line", call_to_action: LINEUP.object_story_spec.link_data.call_to_action } });
  });
  it("a ruled page is added when it's a venue page with its own Instagram", () => {
    const BRISTOL = { pageId: "1593045637629255", instagramId: "17841401923285132" };
    assert.deepEqual(withRuledIdentity([], BRISTOL, { id: BRISTOL.pageId, category: "Live music venue", linkedInstagramId: BRISTOL.instagramId }), [BRISTOL]);
    assert.deepEqual(withRuledIdentity([NX_LOVES], NX_LOVES, { id: NX_LOVES.pageId, category: "Live music venue", linkedInstagramId: NX_LOVES.instagramId }), [NX_LOVES]);
  });
  it("a ruled artist page is still refused", () => {
    assert.throws(() => withRuledIdentity([], { pageId: "454884974621000", instagramId: "17841402061405557" }, { id: "454884974621000", category: "Artist", linkedInstagramId: "17841402061405557" }), /is an artist page/);
  });
  it("a ruled page with someone else's Instagram, or none linked, is refused", () => {
    assert.throws(() => withRuledIdentity([], { pageId: NX_LOVES.pageId, instagramId: "17841400834660844" }, { id: NX_LOVES.pageId, category: "Live music venue", linkedInstagramId: NX_LOVES.instagramId }), /isn't the account linked/);
    assert.throws(() => withRuledIdentity([], NX_LOVES, { id: NX_LOVES.pageId, category: "Live music venue", linkedInstagramId: null }), /no linked Instagram/);
  });
});

describe("Kream's artist cards: the one artist-page exception (Matas, 17 Nov)", () => {
  const CARDS = "120250552886550716";
  const ESTIVA = { id: "71896176954", category: "Music", linkedInstagramId: "17841400394410479" };
  const LEENA = { id: "1543580149233320", category: "Artist", linkedInstagramId: "17841401226850280" };
  const PARTS = { id: "877729655689651", category: "Musician/band", linkedInstagramId: "17841408629200822" };
  const LOCKLEAD = { id: "640971025955376", category: "Musician/band", linkedInstagramId: "17841400928229769" };
  const ARTIST_COPY = "Bristol! Excited to be back alongside Kream on 4th December.";

  it("the three pages, in the cards campaign only, each with its own Instagram", () => {
    assert.deepEqual(artistCardIdentities(CARDS, [ESTIVA, LEENA, PARTS, LOCKLEAD]), [
      { pageId: ESTIVA.id, instagramId: ESTIVA.linkedInstagramId },
      { pageId: LEENA.id, instagramId: LEENA.linkedInstagramId },
      { pageId: PARTS.id, instagramId: PARTS.linkedInstagramId },
    ]);
  });
  it("no artist page on any other campaign, and the promoter tests still refuse them", () => {
    for (const other of ["120252640391710755", "120250552866110716", "120248937493860539"]) assert.deepEqual(artistCardIdentities(other, [ESTIVA, LEENA, PARTS]), []);
    const ids = promoterIdentities({ clientPageIds: [], promotablePageIds: [], showAdPageIds: [ESTIVA.id, LEENA.id, PARTS.id, "259905047197071"], pages: [ESTIVA, LEENA, PARTS, { id: "259905047197071", category: "Live music venue", linkedInstagramId: NX_LOVES.instagramId }] });
    const leenaPayload = copyTestCreativePayload(VIDEO_CREATIVE, { name: "n", message: "A", postAs: { pageId: LEENA.id, instagramId: LEENA.linkedInstagramId } });
    assert.throws(() => assertPromoterIdentity("EBR26-KREAM", leenaPayload, ids), CopyTestStop);
  });

  function cardMeta(campaignId: string) {
    const CARD = { object_story_spec: { page_id: "1593045637629255", instagram_user_id: "17841401923285132", link_data: { image_hash: "7d3b", link: "https://www.kream-bristol.com/", message: "Kream, Estiva, Leena Punks & Parts at Electric Bristol, Friday 4 December.\nTickets on sale now.", call_to_action: { type: "BOOK_TRAVEL", value: { link: "https://www.kream-bristol.com/" } } } } };
    const made: Record<string, unknown>[] = [];
    const meta = {
      ...fakeMeta().meta,
      readCreative: async () => CARD,
      readAd: async (id: string) => ({ id, name: "[CARD-SUPPORT-Estiva]", adsetId: "set1", campaignId, status: "PAUSED", creativeId: "bristolCard" }),
      createCreative: async (_a: string, p: Record<string, unknown>) => (made.push(p), "new1"),
      updateAd: async () => {},
      archiveAd: async () => {},
    };
    return { meta, made, CARD };
  }
  const BRISTOL = { pageId: "1593045637629255", instagramId: "17841401923285132" };
  const estivaAs = { pageId: ESTIVA.id, instagramId: ESTIVA.linkedInstagramId };

  it("Estiva's card: same image, link and button, the artist's copy exactly, posted as Estiva", async () => {
    const { meta, made, CARD } = cardMeta(CARDS);
    const spec = { ...SPEC, campaignName: "EBR26-KREAM · Artist cards test", identities: [BRISTOL, ...artistCardIdentities(CARDS, [ESTIVA])] };
    await repointCopyTestAds(setup().deps(meta), spec, [{ label: "Estiva", adId: "e1", mode: "identity", postAs: estivaAs, message: ARTIST_COPY }], BRISTOL);
    assert.deepEqual(made[0].object_story_spec, { page_id: ESTIVA.id, instagram_user_id: ESTIVA.linkedInstagramId, link_data: { ...CARD.object_story_spec.link_data, message: ARTIST_COPY } });
  });
  it("an exception page on an ad in any other campaign: nothing is sent", async () => {
    const { meta, made } = cardMeta("120252640391710755");
    const spec = { ...SPEC, identities: [BRISTOL, estivaAs] };
    await assert.rejects(repointCopyTestAds(setup().deps(meta), spec, [{ label: "Estiva", adId: "e1", mode: "identity", postAs: estivaAs, message: ARTIST_COPY }], BRISTOL), /artist page 71896176954 isn't allowed/);
    assert.equal(made.length, 0);
  });
});

describe("the show's one Tests campaign (Matas, 17 Nov, second set)", () => {
  it("a second test reuses the show's Tests campaign: no campaign write, its ad set goes in it", async () => {
    const campaigns = [{ id: "tests1", name: "NX26-DOD · Tests", status: "ACTIVE" }, { id: "main", name: "[NX26-DOD] On sale", status: "ACTIVE", daily_budget: "500" }];
    const { meta, calls } = fakeMeta({}, campaigns);
    const second: CopyTestSpec = { ...SPEC, adSetName: "NX26-DOD · Artist cards test", sourceAdSetId: "120252309614100755" };
    const out = await createCopyTest(setup().deps(meta), second);
    assert.equal(out.campaignId, "tests1");
    assert.equal(calls.some((c) => c.startsWith("campaign")), false);
    assert.equal(calls[0], "adset ACTIVE tests1");
    assert.equal(out.writes, 5);
    assert.equal(copyTestWriteCount(second, { campaignExists: true }), 5);
  });
  it("two tests in a row on one show make one campaign between them, and never send a campaign budget", async () => {
    const campaigns: { id: string; name: string }[] = [];
    const { meta, calls } = fakeMeta({}, campaigns);
    await createCopyTest(setup().deps(meta), SPEC);
    await createCopyTest({ ...setup().deps(meta) }, { ...SPEC, adSetName: "NX26-DOD · Artist cards test" });
    assert.deepEqual(calls.filter((c) => c.startsWith("campaign")), ["campaign ACTIVE no budget"]);
    assert.equal(campaigns.length, 1);
  });
  it("a Tests campaign with a campaign budget stops the test with nothing made", async () => {
    const { meta, calls } = fakeMeta({}, [{ id: "t", name: "NX26-DOD · Tests", daily_budget: "300" }]);
    await assert.rejects(createCopyTest(setup().deps(meta), SPEC), /has a campaign budget/);
    assert.deepEqual(calls, []);
  });
  it("created paused on request: ad set and ads PAUSED, a new campaign PAUSED too", async () => {
    const { meta, calls } = fakeMeta();
    await createCopyTest(setup().deps(meta), { ...SPEC, status: "PAUSED" });
    assert.deepEqual(calls.filter((c) => !c.startsWith("creative")), ["campaign PAUSED no budget", "adset PAUSED cmp1", "ad PAUSED set2", "ad PAUSED set2"]);
  });
  it("a test named for its own campaign (the 17 Nov shape) is refused", async () => {
    const { meta, calls } = fakeMeta();
    await assert.rejects(createCopyTest(setup().deps(meta), { ...SPEC, campaignName: "NX26-DOD · AB copy test" }), /isn't NX26-DOD's Tests campaign name/);
    assert.deepEqual(calls, []);
  });
});

