/**
 * PR E: RT17, the layout test (docs/design-record/2026-11-17-retargeting-campaign-2.html),
 * with ops' option (c) of 17 Nov: under the one Accept, both arm campaigns
 * are made with every ad set starting at the test's start (00:00 in the ad
 * account's timezone, tomorrow), then the Meta A/B test with that start,
 * then everything is switched on. Nothing delivers before the split. A
 * refused test stops Apply with everything paused. RG's figures are the
 * record's.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import { applyTestCall, takeWholeTotal, type CallWrite } from "../apply-call.ts";
import { applyRetargetingCampaign, RT_STUDY_UNWIRED, type RetargetingMeta } from "../apply.ts";
import type { SourceSet, TierSpec } from "../audiences.ts";
import { linksFromPages } from "../links.ts";
import { callLine, planRetargeting, type RetargetingInput } from "../plan.ts";
import { pooledFromRows } from "../runner.ts";
import { armTiers, callFor, entered, metaTime, pooled, recencySpecs, studyPayload, testStart } from "../test.ts";
import * as words from "../words.ts";

const ON = { ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED: "1", OFFPIXEL_META_AUDIENCE_WRITES_ENABLED: "true" };

const SET: SourceSet = {
  pixelId: "px",
  links: linksFromPages([
    {
      page_id: "p",
      slug: "x",
      crm_base_tag: "XMPL-WHSE",
      title: "XMPL",
      landing_url: "https://xmpl-whse.com",
      ticket_links: [{ platform: "skiddle", url: "https://www.skiddle.com/e/1", label: "Tickets", shop_name: null, shown_first: true }],
    },
  ]),
  videos: [{ contextId: "pg1", videoIds: ["v1"] }],
  pages: [{ id: "pg1", name: "XMPL Promotions", igId: "ig1", kind: "promoter", hasRole: true }],
  lists: [
    { metaAudienceId: "sig", name: "Signups", role: "signups", uploadedAt: "2026-11-10T09:00:00Z" },
    { metaAudienceId: "sim", name: "Similar", role: "similar", uploadedAt: "2026-11-10T09:00:00Z" },
    { metaAudienceId: "buy", name: "Buyers", role: "buyers", uploadedAt: "2026-11-10T09:00:00Z" },
  ],
};

function oneTier(specs: readonly TierSpec[]) {
  const included = specs.flatMap((spec) => spec.includes.map((aud) => aud.key));
  assert.equal(new Set(included).size, included.length, "no audience in two tiers' includes");
  for (let cold = 0; cold < specs.length; cold += 1) {
    const excluded = new Set(specs[cold]!.excludes.map((aud) => aud.key));
    for (let hot = 0; hot < cold; hot += 1) for (const aud of specs[hot]!.includes) assert.ok(excluded.has(aud.key), `${specs[cold]!.tier} leaves out ${aud.key}`);
  }
}

describe("RT17 arm B: by recency (J2's layout)", () => {
  it("every source in every tier at 30 / 60 / 180 days, Bottom's registrations to 180 and the lists; no person in two tiers", () => {
    const specs = recencySpecs(SET);
    const bottom = specs.find((spec) => spec.tier === "bottom")!;
    assert.deepEqual(bottom.includes.map((aud) => aud.key), ["b:bottom:ticket:30", "b:bottom:checkout:30", "b:bottom:page:30", "b:bottom:registrations:30", "b:bottom:video:pg1:30", "b:bottom:fb:30", "b:bottom:ig:30", "b:bottom:registrations:90", "b:bottom:registrations:180", "list:sig"]);
    assert.deepEqual(specs.find((spec) => spec.tier === "mid_bottom")!.includes.map((aud) => aud.key).at(-1), "list:sim");
    assert.ok(specs.find((spec) => spec.tier === "mid")!.includes.every((aud) => aud.key.endsWith(":180")));
    assert.ok(specs.every((spec) => spec.excludes.some((aud) => aud.key === "list:buy")), "buyers left out everywhere");
    oneTier(specs);
    oneTier(recencySpecs(SET, { bottom: false }));
  });

  it("arm B's rows in the record's words", () => {
    assert.deepEqual(words.armBAudiences("bottom", { signupLists: 1, similarLists: 2, hasLanding: true }), ["Every source · 30 days", "Registrations · 180 days · signup list"]);
    assert.deepEqual(words.armBAudiences("mid_bottom", { signupLists: 1, similarLists: 2, hasLanding: true }), ["Every source · 60 days · 2 similar lists"]);
    assert.deepEqual(words.armBAudiences("mid", { signupLists: 1, similarLists: 2, hasLanding: true }), ["Every source · 180 days"]);
  });
});

describe("RT17 money and names", () => {
  it("half the total to each arm, 50 / 25 / 25 inside it; entered from £6.00 a day", () => {
    assert.deepEqual(armTiers(3600), { halfMinor: 1800, tiers: { bottom: 900, mid_bottom: 450, mid: 450 } });
    assert.equal(entered(599), false);
    assert.equal(entered(600), true);
    assert.equal(words.tooSmallToTest(580), "Too small to test: £5.80 a day is under £6.00, so it runs layout A only.");
    assert.equal(words.armCampaignName("XMPL-WHSE", "A"), "XMPL-WHSE · Retargeting · A/B · A");
    assert.equal(words.armAdSetName("XMPL-WHSE", "B", "mid_bottom"), "XMPL-WHSE · Retargeting · A/B · B · Mid Bottom");
    assert.equal(words.eachArmLine(1800), "£18.00 a day to each arm · Meta splits people at random, so nobody sees both");
    assert.equal(words.testTitle("XMPL-WHSE"), "XMPL-WHSE · Retargeting · A/B test");
  });
});

describe("Ops (c): the test starts at 00:00 in the ad account's timezone, tomorrow there", () => {
  it("London (GMT and across the March change) and Los Angeles", () => {
    assert.equal(testStart("Europe/London", new Date("2026-11-17T10:00:00Z")).at.toISOString(), "2026-11-18T00:00:00.000Z");
    assert.equal(testStart("Europe/London", new Date("2026-11-17T23:30:00Z")).at.toISOString(), "2026-11-18T00:00:00.000Z");
    assert.equal(testStart("Europe/London", new Date("2027-03-27T12:00:00Z")).at.toISOString(), "2027-03-28T00:00:00.000Z");
    assert.equal(testStart("Europe/London", new Date("2027-06-01T12:00:00Z")).at.toISOString(), "2027-06-01T23:00:00.000Z");
    assert.equal(testStart("America/Los_Angeles", new Date("2026-11-17T10:00:00Z")).at.toISOString(), "2026-11-18T08:00:00.000Z");
    assert.equal(metaTime(new Date("2026-11-18T00:00:00Z")), "2026-11-18T00:00:00+0000");
  });

  it("the study: two 50 % cells, one arm campaign each, from the arms' start", () => {
    const start = new Date("2026-11-18T00:00:00Z");
    const payload = studyPayload({ code: "XMPL-WHSE", campaignA: "cA", campaignB: "cB", start, end: new Date("2026-12-19T23:59:00Z") });
    assert.equal(payload.type, "SPLIT_TEST");
    assert.equal(payload.start_time, Math.floor(start.getTime() / 1000));
    assert.deepEqual(JSON.parse(String(payload.cells)), [
      { name: "A · tiers by action", treatment_percentage: 50, campaigns: ["cA"] },
      { name: "B · by recency", treatment_percentage: 50, campaigns: ["cB"] },
    ]);
  });
});

function testFake(opts: { refuse?: boolean } = {}) {
  const calls: [string, ...unknown[]][] = [];
  let next = 0;
  const id = (prefix: string) => `${prefix}${++next}`;
  const meta: RetargetingMeta = {
    readCampaignBudget: async () => ({ daily: null, lifetime: null }),
    readAd: async (adId) => ({ id: adId, name: `name-${adId}`, creativeId: `cr-${adId}`, effectiveStatus: "ACTIVE", objectStoryId: null }),
    createCreativeFromPost: async () => {
      throw new Error("not used");
    },
    createCampaign: async (_account, payload) => (calls.push(["createCampaign", payload]), id("camp")),
    createAdSet: async (_account, payload) => (calls.push(["createAdSet", payload]), id("set")),
    createAd: async (_account, ad) => (calls.push(["createAd", ad]), id("ad")),
    updateCampaign: async (campaignId, fields) => void calls.push(["updateCampaign", campaignId, fields]),
    setAdSetActive: async (adsetId) => void calls.push(["setAdSetActive", adsetId]),
    findCustomConversion: async () => null,
    createCustomConversion: async () => id("cc"),
    readAdSetTargeting: async () => ({ geo_locations: { countries: ["GB"] } }),
    audienceState: async () => "ready",
    listShowVideos: async () => [{ contextId: "pg1", videoIds: ["v1"] }],
    accountInfo: async () => ({ timezone: "Europe/London", businessId: "biz1" }),
    createAdStudy: async (businessId, payload) => {
      calls.push(["createAdStudy", businessId, payload]);
      if (opts.refuse) throw new Error("Invalid parameter: a campaign in this cell has a scheduled start");
      return "study1";
    },
  };
  return { meta, calls };
}

function enteredLine() {
  const plan = planRetargeting({
    eventId: "e1",
    eventCode: "XMPL-WHSE",
    runDay: "2026-11-17",
    eventDate: "2026-12-19",
    onSaleDay: "2026-11-06",
    read: { state: "platform_under_bar", pixel: { id: "px", source: "ad_sets", spendShare: 1, stored: "px", matches: true }, pixelName: "Warehouse Skiddle", domain: null, onDomain: null, platform: "Skiddle" } as never,
    last7SpendGbp: 1680,
    minDailyMinor: 100,
    sources: SET,
    existing: null,
    legacy: [],
    budgetGbp: 10000,
    spendToDateGbp: 1500,
    committedGbp: 1000,
    main: null,
    ads: [{ adId: "a1", name: "Lineup" }],
    geoFromAdsetId: "src1",
    where: { draftId: "d1", adAccountId: "act_1", campaignIds: ["main1"] },
    linksRead: "ok",
  } as RetargetingInput);
  assert.equal(plan.state, "proposed");
  assert.deepEqual(plan.build!.test, { halfMinor: 1200, arms: { A: { bottom: 600, mid_bottom: 300, mid: 300 }, B: { bottom: 600, mid_bottom: 300, mid: 300 } } });
  assert.equal(plan.view.create!.eachArm, "£12.00 a day to each arm · Meta splits people at random, so nobody sees both");
  assert.equal(plan.view.create!.tooSmall, null);
  return { id: "l1", write: plan.build as unknown as Record<string, unknown>, applied_result: null as Record<string, unknown> | null };
}

function setup() {
  const mem = memoryDb({ onsale_refresh_lines: [{ id: "l1", state: "applying" }], meta_write_idempotency: [], onsale_refresh_audiences: [], launched_ad_sets: [] });
  const deps = (meta: RetargetingMeta) => ({
    db: mem.db,
    env: ON,
    meta,
    ensureAudience: async (aud: { key: string }) => ({ metaAudienceId: `aud-${aud.key}` }),
    plan: { budget: 10000, spend: 1500, today: "2026-11-17", appliedMovesGbp: 0 },
    mainSpentNow: 0,
    owner: { userId: "u1", clientId: "c1", eventId: "e1", launchRunId: "11111111-1111-4111-8111-111111111111" },
  });
  return { mem, deps, ctx: { ledger: { supabase: mem.db, userId: "u1", draftId: "d1", eventId: "e1" }, adAccountId: "act_1", plainMetaReason: (err: unknown) => (err instanceof Error ? err.message : String(err)) } };
}

describe("Ops (c) at Apply: nothing delivers before the split", () => {
  it("both arms made paused, every ad set starting at the test's start, then the study, then switched on", async () => {
    const fake = testFake();
    const { deps, ctx } = setup();
    const out = await applyRetargetingCampaign(deps(fake.meta) as never, enteredLine(), ctx as never);
    assert.equal(out.state, "applied", String(out.reason));
    const campaigns = fake.calls.filter(([name]) => name === "createCampaign").map(([, payload]) => payload as Record<string, unknown>);
    assert.deepEqual(campaigns.map((row) => [row.name, row.status]), [["XMPL-WHSE · Retargeting · A/B · A", "PAUSED"], ["XMPL-WHSE · Retargeting · A/B · B", "PAUSED"]]);
    const study = fake.calls.find(([name]) => name === "createAdStudy")!;
    const studyStart = Number((study[2] as Record<string, unknown>).start_time) * 1000;
    const sets = fake.calls.filter(([name]) => name === "createAdSet").map(([, payload]) => payload as Record<string, unknown>);
    assert.equal(sets.length, 6, "three tiers in each arm");
    for (const set of sets) {
      assert.ok(typeof set.start_time === "string", `${set.name} has a start time`);
      assert.ok(Date.parse(String(set.start_time).replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) >= studyStart, `${set.name} starts at or after the test`);
      assert.equal(set.status, "PAUSED");
    }
    // The test's start is 00:00 tomorrow in the account's timezone, after now.
    assert.ok(studyStart > Date.now());
    // Nothing is switched on before the study exists.
    const studyAt = fake.calls.indexOf(study);
    const firstOn = fake.calls.findIndex(([name, , fields]) => name === "setAdSetActive" || (name === "updateCampaign" && (fields as Record<string, unknown>)?.status === "ACTIVE"));
    assert.ok(firstOn > studyAt, "switched on only after the test is made");
    assert.deepEqual(JSON.parse(String((study[2] as Record<string, unknown>).cells)).map((cell: { treatment_percentage: number; campaigns: string[] }) => [cell.treatment_percentage, cell.campaigns.length]), [[50, 1], [50, 1]]);
    assert.ok(campaigns.every((row) => row.daily_budget === undefined && row.lifetime_budget === undefined), "no campaign-level budget, so no campaign-level delivery");
  });

  it("Meta refuses the test: Apply stops, says so, and nothing is switched on (no fallback)", async () => {
    const fake = testFake({ refuse: true });
    const { deps, ctx } = setup();
    const out = await applyRetargetingCampaign(deps(fake.meta) as never, enteredLine(), ctx as never);
    assert.equal(out.state, "failed");
    assert.match(String(out.reason), /^Meta refused the A\/B test: Invalid parameter: a campaign in this cell has a scheduled start\. Created paused: both arms' campaigns/);
    assert.equal(fake.calls.some(([name, , fields]) => name === "setAdSetActive" || (name === "updateCampaign" && (fields as Record<string, unknown>)?.status === "ACTIVE")), false);
  });

  it("not wired: nothing is built", async () => {
    const fake = testFake();
    delete (fake.meta as Partial<RetargetingMeta>).createAdStudy;
    const { deps, ctx } = setup();
    const out = await applyRetargetingCampaign(deps(fake.meta) as never, enteredLine(), ctx as never);
    assert.equal(out.state, "failed");
    assert.ok(String(out.reason).startsWith(RT_STUDY_UNWIRED));
    assert.deepEqual(fake.calls, []);
  });
});

describe("RT17's call: pooled across every show", () => {
  const RG = { from: "2026-11-17", to: "2026-11-30", days: 14, shows: 6, arms: { A: { shows: 6, spend: 2184, purchases: 168, cost: 13 }, B: { shows: 6, spend: 2179.4, purchases: 130, cost: 16.76 } } };

  it("RG: Layout A wins, in the record's words", () => {
    const line = callLine(RG)!;
    assert.equal(line.title, "Layout A wins the retargeting test");
    assert.equal(line.detail, "£13.00 per attributed purchase (168) against B's £16.76 (130) · 22 % cheaper · 6 shows · 14 days, Tue 17 – Mon 30 Nov");
    assert.equal(line.onAccept, "On accept: B pauses on 6 shows and each show's A takes its whole retargeting budget. New shows start on A.");
    assert.equal(line.writeText, "Ends the Meta A/B test on 6 shows · pauses 6 campaigns · ad-set budget writes");
    assert.equal(line.narrow, "Layout A wins · £13.00 vs £16.76 · 22 % cheaper");
    assert.equal(line.narrowSub, "6 shows · 14 days");
  });

  it("pooled is spend ÷ purchases summed across shows, never averaged show by show", () => {
    const read = pooled(
      [
        { show: "s1", arm: "A", date: "2026-11-20", spend: 100, purchases: 1 },
        { show: "s2", arm: "A", date: "2026-11-20", spend: 100, purchases: 19 },
      ],
      { from: "2026-11-17", to: "2026-11-30" },
    );
    assert.equal(read.arms.A.cost, 10, "£200 ÷ 20, not the mean of £100 and £5.26");
    const fromRows = pooledFromRows([{ date: "2026-11-18", campaign_name: "XMPL-WHSE · Retargeting · A/B · B", spend: "40", purchases: "2" }, { date: "2026-11-19", campaign_name: "XMPL-WHSE · Tickets", spend: 99, purchases: 9 }], "2026-11-30")!;
    assert.deepEqual([fromRows.from, fromRows.arms.B.spend, fromRows.arms.A.spend], ["2026-11-18", 40, 0]);
  });

  it("before the minimum, under the margin, and the 28-day fallback that keeps A", () => {
    assert.equal(words.notCalledYet({ day: 9, a: 21, b: 18, shows: 4 }), "Not called yet: day 9 of at least 14 · A 21 and B 18 attributed purchases, at least 30 each · 4 shows, at least 3");
    assert.equal(callFor({ ...RG, days: 13 }).kind, "not_yet");
    assert.equal(callFor({ ...RG, shows: 2 }).kind, "not_yet");
    const close = { ...RG, arms: { A: { shows: 6, spend: 1400, purchases: 100, cost: 14 }, B: { shows: 6, spend: 1500, purchases: 100, cost: 15 } } };
    assert.deepEqual(callFor(close), { kind: "too_close", a: 14, b: 15, pct: 6 });
    assert.equal(words.tooCloseToCall({ a: 14, b: 15, pct: 6 }), "Too close to call: A £14.00, B £15.00 per attributed purchase, 6 % apart (15 % needed).");
    assert.deepEqual(callFor({ ...close, days: 28 }), { kind: "no_clear_winner", a: 14, b: 15 });
    const fallback = callLine({ ...close, days: 28 })!;
    assert.equal(fallback.title, "No clear winner after 28 days: A £14.00, B £15.00 per attributed purchase.");
    assert.equal(fallback.winner, "A");
  });

  it("accepting once: B pauses on every show, each test ends, A takes the whole total; the other shows' call lines are applied", async () => {
    const mem = memoryDb({ meta_write_idempotency: [], onsale_refresh_lines: [{ id: "c1", kind: "retargeting_test_call", state: "applying", write: { callKey: "2026-11-17:A" } }, { id: "c2", kind: "retargeting_test_call", state: "to_review", write: { callKey: "2026-11-17:A" } }] });
    const calls: string[] = [];
    const write: CallWrite = {
      kind: "retargeting_test_call",
      callKey: "2026-11-17:A",
      winner: "A",
      shows: ["e1", "e2"].map((eventId) => ({
        eventId,
        code: eventId,
        draftId: `d-${eventId}`,
        studyId: `study-${eventId}`,
        campaigns: { A: `A-${eventId}`, B: `B-${eventId}` },
        adSets: { A: { bottom: { id: `A-b-${eventId}`, dailyMinor: 900 }, mid_bottom: { id: `A-mb-${eventId}`, dailyMinor: 450 }, mid: { id: `A-m-${eventId}`, dailyMinor: 450 } }, B: {} },
        totalMinor: 3600,
      })),
    };
    const out = await applyTestCall(
      { db: mem.db as never, userId: "u1", meta: { updateCampaign: async (id, params) => void calls.push(`campaign ${id} ${params.status}`), endAdStudy: async (id) => void calls.push(`end ${id}`), updateAdSetDailyBudget: async (id, minor) => void calls.push(`budget ${id} ${minor}`) } },
      { id: "c1", write: write as unknown as Record<string, unknown> },
      { plainMetaReason: (err) => String(err) },
    );
    assert.equal(out.state, "applied");
    assert.deepEqual(calls.slice(0, 5), ["campaign B-e1 PAUSED", "end study-e1", "budget A-b-e1 1800", "budget A-mb-e1 900", "budget A-m-e1 900"]);
    assert.equal(calls.length, 10);
    assert.deepEqual(new Set(mem.tables.meta_write_idempotency!.map((row) => row.op_kind)), new Set(["refresh_campaign_status_update", "retargeting_study_end", "refresh_adset_budget_update"]));
    assert.equal(mem.tables.onsale_refresh_lines!.find((row) => row.id === "c2")!.state, "applied");
    assert.deepEqual(takeWholeTotal({ bottom: { id: "b", dailyMinor: 901 }, mid_bottom: { id: "mb", dailyMinor: 450 } }, 2702).map((row) => row.after), [1802, 900]);
  });
});

describe("RT17: after the call, new shows start on the winner; under £6.00, layout A only", () => {
  it("a show with a winner builds one campaign on it; a small show says so", () => {
    const base = enteredLine();
    void base;
    const small = planRetargeting({ ...(JSON.parse(JSON.stringify({})) as object), eventId: "e2", eventCode: "XMPL-ROOF", runDay: "2026-11-17", eventDate: "2026-12-18", onSaleDay: "2026-11-06", read: { state: "platform_under_bar", pixel: { id: "px" }, pixelName: "P", domain: null, onDomain: null, platform: "Skiddle" } as never, last7SpendGbp: 406, minDailyMinor: 100, sources: SET, existing: null, legacy: [], budgetGbp: 4000, spendToDateGbp: 1500, committedGbp: 1000, main: null, ads: [{ adId: "a", name: "A" }], geoFromAdsetId: null, where: { draftId: "d", adAccountId: "act_1", campaignIds: ["c"] }, linksRead: "ok" } as RetargetingInput);
    assert.equal(small.view.create!.tooSmall, "Too small to test: £5.80 a day is under £6.00, so it runs layout A only.");
    assert.equal(small.build!.test, null);
    const won = planRetargeting({ ...(enteredLine().write as object), eventId: "e3", eventCode: "XMPL-NEW", runDay: "2026-12-02", eventDate: "2026-12-30", onSaleDay: "2026-11-30", read: { state: "platform_under_bar", pixel: { id: "px" }, pixelName: "P", domain: null, onDomain: null, platform: "Skiddle" } as never, last7SpendGbp: 1680, minDailyMinor: 100, sources: SET, existing: null, legacy: [], budgetGbp: 10000, spendToDateGbp: 0, committedGbp: 0, main: null, ads: [{ adId: "a", name: "A" }], geoFromAdsetId: null, where: { draftId: "d", adAccountId: "act_1", campaignIds: ["c"] }, linksRead: "ok", testWinner: "B" } as RetargetingInput);
    assert.equal(won.build!.test, null);
    assert.equal(won.build!.layout, "B");
    assert.equal(won.view.create!.tooSmall, null);
  });
});

describe("migration 259 against the live CHECKs (read 17 Nov 2026)", () => {
  const SQL = readFileSync(new URL("../../../supabase/migrations/259_retargeting_test.sql", import.meta.url), "utf8");
  it("line kinds: the 11 live plus retargeting_test_call; op kinds: 257's 17 plus the two study kinds; both dropped by name", () => {
    const live = ["add_creative", "claim_ready", "pause_creative", "bring_back_audience", "missing_default", "drop_audience", "move_budget", "purchase_campaign", "scale_purchase", "copy_audience", "retargeting_campaign"];
    const kinds = [...SQL.slice(SQL.indexOf("add constraint onsale_refresh_lines_kind_check")).split("alter table")[0]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(kinds, [...live, "retargeting_test_call"]);
    const ops = [...SQL.slice(SQL.indexOf("add constraint meta_write_idempotency_op_kind_check")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const kind of ["campaign_create", "refresh_campaign_status_update", "retargeting_audience_rule_update", "retargeting_study_create", "retargeting_study_end"]) assert.ok(ops.includes(kind), kind);
    assert.equal(ops.length, 19);
    assert.ok(SQL.indexOf("drop constraint if exists onsale_refresh_lines_kind_check") < SQL.indexOf("add constraint onsale_refresh_lines_kind_check"));
    assert.doesNotMatch(SQL, /do \$\$/i);
  });
});

describe("frame RG: the record's figures", () => {
  it("both arms, the pooled block and the call", async () => {
    const { rgPlan } = await import("../../../scripts/plan-frames/retargeting-fixtures.ts");
    const { view, line } = rgPlan();
    assert.equal(view.title, "XMPL-WHSE · Retargeting · A/B test");
    assert.deepEqual(view.test!.arms.map((arm) => [arm.label, arm.rows.map((row) => [row.cost, row.purchases]), arm.total.cost, arm.total.purchases]), [
      ["A · tiers by action", [[7, 9], [7.88, 4], [7.88, 4]], 7.41, 17],
      ["B · by recency", [[9, 7], [10.5, 3], [10.5, 3]], 9.69, 13],
    ]);
    assert.deepEqual(view.test!.pooled!.map((row) => [row.arm, row.shows, row.days, row.spend, row.purchases, row.cost]), [["A", 6, 14, 2184, 168, 13], ["B", 6, 14, 2179.4, 130, 16.76]]);
    assert.equal(line.title, "Layout A wins the retargeting test");
    assert.equal(words.armTierNarrow({ tier: "bottom", budgetMinor: 900, cost: 7, purchases: 9, frequency: 3.1 }), "Bottom · £9.00 a day · £7.00 · 9 purchases · frequency 3.1");
  });
});
