/**
 * "Approve variants" on fakes: the gate (exactly "true", else 503 with no
 * Graph call and no write), Matas only, one test at a time, TF1's budget,
 * the Tests campaign and ad set created PAUSED and keyed on the ledger, the
 * ads sent to the launch route with createPaused, and a retry that makes
 * nothing twice.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import { CREATES_OFF, approveTest, factsFrom, resultsOf, testAdSetPayload, type AdDay, type ApproveDeps, type TestMeta } from "../approve.ts";

const MATAS = "matas";
const NOW = new Date("2026-11-16T12:00:00Z");

function day(date: string, ad: string, adset: string, spend: number, ic = 0, campaign = "[P26-BDAY] Puzzle - 27 Dec - On Sale"): AdDay {
  return { date, meta_ad_id: ad, meta_adset_id: adset, meta_campaign_id: "c-main", campaign_name: campaign, spend, landing_page_views: 0, registrations: 0, actions: ic ? [{ action_type: "omni_initiated_checkout", value: String(ic) }] : [] };
}

/** P26-BDAY-like: £247.22 over 9–15 Nov, two ad sets, ad-1 the best with 12 checkouts. */
function days(): AdDay[] {
  const out: AdDay[] = [];
  const spends = [30, 35, 40, 35, 37.22, 35, 35];
  ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"].forEach((d, i) => {
    out.push(day(d, "ad-1", "as-1", spends[i]! * 0.6, i < 6 ? 2 : 0));
    out.push(day(d, "ad-2", "as-2", Math.round(spends[i]! * 0.4 * 100) / 100, 0));
  });
  out.push(day("2026-11-15", "t-1", "t-as", 5, 1, "P26-BDAY · Tests"));
  return out;
}

function seed(state = "making") {
  return memoryDb({
    creative_tests: [{ id: "t1", user_id: MATAS, plan_id: "p1", event_id: "ev1", n: 1, kind: "tracks", format: "video", runs_in: "tests_adset", state, meta_campaign_id: null, meta_adset_id: null }, { id: "t2", user_id: MATAS, plan_id: "p1", event_id: "ev1", n: 2, kind: "statics", format: "video", runs_in: "tests_adset", state: "waiting" }],
    creative_test_variants: [
      { id: "v1", test_id: "t1", position: 1, label: "Track one", snippet_render_id: "r1", state: "pending", meta_ad_id: null },
      { id: "v2", test_id: "t1", position: 2, label: "Track two", snippet_render_id: "r2", state: "pending", meta_ad_id: null },
    ],
    creative_lab_snippet_renders: [
      { id: "r1", status: "done", creative_asset_id: "a1", file_name: "P26-BDAY_luke-dean-1_snippet-x-on-sale_r1_9x16.mp4" },
      { id: "r2", status: "done", creative_asset_id: "a2", file_name: "P26-BDAY_luke-dean-2_snippet-x-on-sale_r1_9x16.mp4" },
    ],
    creative_assets: [
      { id: "a1", storage_path: "videos/creative-lab/snippet/r1-9x16.mp4", content_hash: "h1", byte_size: 100 },
      { id: "a2", storage_path: "videos/creative-lab/snippet/r2-9x16.mp4", content_hash: "h2", byte_size: 100 },
    ],
    events: [{ id: "ev1", event_code: "P26-BDAY", meta_ad_account_id: "act_1", client_id: "cl1" }],
    launched_ad_sets: [{ meta_adset_id: "as-1", event_id: "ev1", draft_id: "d-main", launched_at: "2026-10-30T12:00:00Z" }],
    onsale_refresh_proposals: [{ event_id: "ev1", objective: "initiate_checkout", window_end: "2026-11-15" }],
    launched_ads: [],
    meta_write_idempotency: [],
  });
}

function fakes(mem: ReturnType<typeof memoryDb>, extra: Partial<ApproveDeps> = {}) {
  const calls: string[] = [];
  const meta: TestMeta = {
    async readAccount() {
      calls.push("readAccount");
      return { minDailyBudget: 100, currency: "GBP" };
    },
    async readAdSet(id) {
      calls.push(`readAdSet ${id}`);
      return { id, campaign_id: "c-main", effective_status: "ACTIVE", daily_budget: "551", optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", promoted_object: { pixel_id: "px", custom_event_type: "INITIATED_CHECKOUT" }, targeting: { geo_locations: { countries: ["GB"] }, age_min: 18, age_max: 35, flexible_spec: [{ interests: [{ id: "1" }] }], custom_audiences: [{ id: "ca" }], publisher_platforms: ["facebook", "instagram"], instagram_positions: ["stream", "story", "reels"] } };
    },
    async readCampaign() {
      calls.push("readCampaign");
      return { objective: "OUTCOME_SALES", dailyBudget: null, status: "ACTIVE" };
    },
    async readAdCopy(id) {
      calls.push(`readAdCopy ${id}`);
      return { pageId: "page-1", instagramActorId: "ig-1", message: "Luke Dean joins Enzo Siragusa for our 4th Birthday", link: "https://example.com/tickets", cta: "buy_tickets" };
    },
    async createCampaign(_a, payload) {
      calls.push(`createCampaign ${JSON.stringify(payload)}`);
      return "c-tests";
    },
    async createAdSet(_a, payload) {
      calls.push(`createAdSet ${JSON.stringify(payload)}`);
      return "as-tests";
    },
    async updateAdSetDailyBudget(id, minor) {
      calls.push(`updateBudget ${id} ${minor}`);
    },
  };
  const launches: { draft: { id?: string }; createPaused: true }[] = [];
  const deps: ApproveDeps = {
    db: mem.db,
    env: { CREATIVE_TESTS_CREATE_ENABLED: "true" },
    meta,
    async upload(req) {
      calls.push(`upload ${req.storagePath}`);
      return { videoId: `vid-${req.contentHash}`, registryAssetId: null };
    },
    async launch(body) {
      launches.push(body as never);
      const draft = body.draft as unknown as { creatives: { name: string }[] };
      for (const [i, c] of draft.creatives.entries()) mem.tables.launched_ads!.push({ launch_run_id: "run-1", ad_name: c.name, meta_ad_id: `ad-${i + 1}` });
      return { ok: true, status: 200, launchRunId: "run-1" };
    },
    isMatas: (id) => id === MATAS,
    days: async () => days(),
    now: NOW,
    ...extra,
  };
  return { deps, calls, launches };
}

describe("the gate", () => {
  for (const value of [undefined, "", "1", "TRUE", "yes"]) {
    it(`CREATIVE_TESTS_CREATE_ENABLED=${String(value)} returns 503 with no Graph call and no write`, async () => {
      const mem = seed();
      const { deps, calls, launches } = fakes(mem, { env: value === undefined ? {} : { CREATIVE_TESTS_CREATE_ENABLED: value } });
      const result = await approveTest(deps, { testId: "t1", userId: MATAS });
      assert.deepEqual(result, { status: 503, body: { ok: false, error: CREATES_OFF } });
      assert.equal(calls.length, 0);
      assert.equal(launches.length, 0);
      assert.equal(mem.writes.length, 0);
    });
  }

  it("only Matas can approve, and nothing is called or written for anyone else", async () => {
    const mem = seed();
    const { deps, calls } = fakes(mem);
    const result = await approveTest(deps, { testId: "t1", userId: "staff" });
    assert.equal(result.status, 403);
    assert.equal(calls.length, 0);
    assert.equal(mem.writes.length, 0);
  });
});

describe("Approve variants", () => {
  it("creates the Tests campaign and its Video ad set paused, sized by TF1, then the ads paused through the launch route", async () => {
    const mem = seed();
    const { deps, calls, launches } = fakes(mem);
    const result = await approveTest(deps, { testId: "t1", userId: MATAS });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.deepEqual(result.body.ads, [{ variantId: "v1", metaAdId: "ad-1" }, { variantId: "v2", metaAdId: "ad-2" }]);

    const campaign = JSON.parse(calls.find((c) => c.startsWith("createCampaign "))!.slice(15));
    assert.deepEqual(campaign, { name: "P26-BDAY · Tests", objective: "OUTCOME_SALES", buying_type: "AUCTION", status: "PAUSED", special_ad_categories: [] });
    const adset = JSON.parse(calls.find((c) => c.startsWith("createAdSet "))!.slice(12));
    assert.equal(adset.name, "P26-BDAY · Tests · Video");
    assert.equal(adset.status, "PAUSED");
    assert.equal(adset.campaign_id, "c-tests");
    // £247.22 / 7 = £35.32 → 10 % = £3.53 → £3, under the £5.51 median.
    assert.equal(adset.daily_budget, 300);
    assert.deepEqual(adset.targeting, { geo_locations: { countries: ["GB"] }, publisher_platforms: ["facebook", "instagram"], instagram_positions: ["stream", "story", "reels"], age_min: 18, targeting_automation: { advantage_audience: 1 } });
    assert.equal(adset.optimization_goal, "OFFSITE_CONVERSIONS");
    assert.deepEqual(adset.promoted_object, { pixel_id: "px", custom_event_type: "INITIATED_CHECKOUT" });

    assert.equal(launches.length, 1);
    assert.equal(launches[0]!.createPaused, true);
    const draft = launches[0]!.draft as unknown as { id: string; creatives: { name: string; primaryText?: string }[] };
    assert.equal(draft.id, "t1");
    assert.deepEqual(draft.creatives.map((c) => c.name), ["P26-BDAY_luke-dean-1_snippet-x-on-sale_r1_9x16", "P26-BDAY_luke-dean-2_snippet-x-on-sale_r1_9x16"]);

    const test = mem.tables.creative_tests!.find((t) => t.id === "t1")!;
    assert.equal(test.state, "approved");
    assert.equal(test.approved_by, MATAS);
    assert.equal(test.meta_campaign_id, "c-tests");
    assert.equal(test.meta_adset_id, "as-tests");
    assert.equal(test.daily_budget_minor, 300);
    assert.equal(test.hold_minor, 1200);
    assert.equal(test.result_event, "initiate_checkout");
    assert.equal(test.started_at, undefined);
    assert.deepEqual(mem.tables.creative_test_variants!.map((v) => [v.meta_ad_id, v.state]), [["ad-1", "created"], ["ad-2", "created"]]);
    assert.equal(mem.tables.launched_ad_sets!.find((r) => r.meta_adset_id === "as-tests")?.source_type, "creative_test");
    // Every create went through the ledger, keyed on the main campaign's draft.
    assert.ok(mem.tables.meta_write_idempotency!.some((r) => r.op_kind === "campaign_create" && r.draft_id === "d-main"));
    assert.ok(mem.tables.meta_write_idempotency!.some((r) => r.op_kind === "adset_create" && r.draft_id === "d-main"));
  });

  it("nothing is ever created ACTIVE", async () => {
    const mem = seed();
    const { deps, calls } = fakes(mem);
    await approveTest(deps, { testId: "t1", userId: MATAS });
    assert.ok(!calls.some((c) => /"status":"ACTIVE"/.test(c)));
  });

  it("refuses a test that isn't being made, and one held by a running test of its format (TT1)", async () => {
    const approved = seed("approved");
    assert.equal((await approveTest(fakes(approved).deps, { testId: "t1", userId: MATAS })).status, 409);
    const busy = seed();
    busy.tables.creative_tests!.push({ id: "t0", user_id: MATAS, plan_id: "p1", event_id: "ev1", n: 0, kind: "copy", format: "video", runs_in: "tests_adset", state: "running" });
    const result = await approveTest(fakes(busy).deps, { testId: "t1", userId: MATAS });
    assert.deepEqual(result.body, { ok: false, error: "Waiting for Test 0" });
  });

  it("refuses with TF1's words when there's no spend in the 7 days", async () => {
    const mem = seed();
    const { deps } = fakes(mem, { days: async () => [] });
    const result = await approveTest(deps, { testId: "t1", userId: MATAS });
    assert.deepEqual(result.body, { ok: false, error: "No spend in the last 7 days to size a test from." });
  });

  it("refuses until every snippet has rendered", async () => {
    const mem = seed();
    mem.tables.creative_lab_snippet_renders![1]!.status = "rendering";
    const result = await approveTest(fakes(mem).deps, { testId: "t1", userId: MATAS });
    assert.deepEqual(result.body, { ok: false, error: "Track two: its snippet hasn't rendered yet." });
  });

  it("a retry after a failed launch makes no second campaign or ad set", async () => {
    const mem = seed();
    const first = fakes(mem, { launch: async () => ({ ok: false, status: 500, error: "Meta said no" }) });
    const failed = await approveTest(first.deps, { testId: "t1", userId: MATAS });
    assert.equal(failed.status, 207);
    assert.equal(mem.tables.creative_tests!.find((t) => t.id === "t1")!.state, "making");
    const again = fakes(mem);
    const ok = await approveTest(again.deps, { testId: "t1", userId: MATAS });
    assert.equal(ok.status, 200);
    assert.ok(!again.calls.some((c) => c.startsWith("createCampaign") || c.startsWith("createAdSet")), again.calls.join("\n"));
  });
});

describe("TF1's facts and the best ad", () => {
  it("counts the main campaigns only, over the last 7 complete days, and picks the best ad by cost per checkout with 10 or more", () => {
    const facts = factsFrom(days(), "P26-BDAY", "initiate_checkout", "2026-11-16");
    assert.equal(facts.last7Spend, 247.22);
    assert.deepEqual(facts.deliveringAdSets, ["as-1", "as-2"]);
    assert.deepEqual(facts.bestAd, { adId: "ad-1", adsetId: "as-1" });
  });

  it("reads checkouts from actions, and landing-page views and signups from their columns", () => {
    assert.equal(resultsOf({ landing_page_views: 3, registrations: 2, actions: [{ action_type: "omni_initiated_checkout", value: "4" }] }, "initiate_checkout"), 4);
    assert.equal(resultsOf({ landing_page_views: 3, registrations: 2, actions: [] }, "landing_page_view"), 3);
    assert.equal(resultsOf({ landing_page_views: 3, registrations: 2, actions: [] }, "complete_registration"), 2);
  });

  it("the ad set keeps location and age floor only, adds Advantage+ audience, and is paused", () => {
    const payload = testAdSetPayload({ targeting: { geo_locations: { countries: ["GB"] }, age_min: 21, age_max: 30, genders: [2] }, optimization_goal: "LANDING_PAGE_VIEWS" }, { name: "X · Tests · Statics", campaignId: "c", dailyMinor: 100, startTime: "t" });
    assert.deepEqual(payload.targeting, { geo_locations: { countries: ["GB"] }, age_min: 21, targeting_automation: { advantage_audience: 1 } });
    assert.equal(payload.status, "PAUSED");
  });
});
