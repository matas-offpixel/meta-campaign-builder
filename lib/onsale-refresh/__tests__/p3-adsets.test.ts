/**
 * P3, design's ruling on the two new-ad-set kinds: an interest cluster
 * brought back, and a missing standing default. Fakes only: no Meta call.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { APPLY_ENV, applyGates } from "../apply-gates.ts";
import { applyAccepted, type ApplyDeps, type RefreshMeta } from "../apply.ts";
import type { AudienceSpec, AudienceState, NewAdSetDeps } from "../apply-adsets.ts";
import { MOVES_SWITCHED_OFF, audienceName, urlFragment } from "../apply-adsets.ts";
import { signupFacts } from "../load.ts";
import {
  ALL_INTERESTS_RETIRED,
  AUDIENCE_BUILDING,
  AUDIENCE_TOO_SMALL,
  NO_BUDGET_TO_START,
  SIGNUP_NOT_READ,
  appliedNewAdSet,
  audienceOnlyTargeting,
  budgetText,
  clusterTargeting,
  clusterWrite,
  decideFunding,
  defaultWrite,
  interestsLine,
  lookalikeEvidence,
  retargetingEvidence,
  seedTooSmall,
} from "../new-adset.ts";
import { ONSALE_PHASE } from "../phase-config.ts";
import { audienceLines, type AdSetInput, type CampaignInput } from "../rules.ts";
import { planRun } from "../schedule.ts";
import { OR8_CLUSTER, OR8_LOOKALIKE, OR8_RETARGETING, OR8_SEED, OR9_RESULTS } from "../../../scripts/plan-frames/refresh-fixtures.ts";
import { memoryDb, type MemoryDb } from "./memory-db.ts";

const EMBEDS = { onsale_refresh_proposals: { table: "onsale_refresh_proposals", key: "proposal_id" } };
const ENV = { [APPLY_ENV]: "1", OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED: "true", OFFPIXEL_META_AUDIENCE_WRITES_ENABLED: "true", ENABLE_OPTIMISATION_WRITES: "1" };
const live = (env: Record<string, string> = ENV) => applyGates(env, "live");
const NOW = new Date("2026-12-07T09:04:00Z");
const WHERE = { campaignIds: ["c1"], adAccountId: "act_9", draftId: "d1" };
const INTERESTS = [
  { id: "601", name: "Disc Genre" },
  { id: "602", name: "Minimal techno" },
  { id: "603", name: "Deep house" },
];

const SOURCE_TARGETING = {
  geo_locations: { countries: ["GB"] },
  age_min: 16,
  age_max: 45,
  publisher_platforms: ["facebook", "instagram"],
  excluded_custom_audiences: [{ id: "900" }],
  flexible_spec: [{ interests: [{ id: "1", name: "Techno" }], behaviors: [{ id: "b1", name: "Frequent travellers" }] }],
};

function clusterLine(id = "cl", write: Record<string, unknown> = {}) {
  return {
    id,
    proposal_id: "p1",
    position: 1,
    kind: "bring_back_audience",
    title: "Disc Genre",
    state: "accepted",
    reason: null,
    target: {},
    evidence: {},
    applied_result: null,
    write: { kind: "new_adset", source: "cluster", clusterId: "k1", clusterName: "Disc Genre", interests: INTERESTS, copyFrom: { adsetId: "303", name: "Adv+", dailyGbp: 14.5 }, giver: { adsetId: "302", name: "Lineup — Primary" }, budgetLevel: "ad_set", eventCode: "P26-BDAY", ...WHERE, ...write },
  };
}

function defaultLine(which: "retargeting" | "registrations_lookalike", id = which, write: Record<string, unknown> = {}) {
  return {
    ...clusterLine(id),
    kind: "missing_default",
    title: which === "retargeting" ? "Retargeting" : "Registrations lookalike",
    write: { kind: "new_adset", source: which, signupEvent: "CompleteRegistration", seed: 3105, country: "GB", landingUrl: "https://puzzle.crqln.com/l/p26-bday?utm=x", ticketUrl: "https://www.skiddle.com/e/41234567/", copyFrom: { adsetId: "303", name: "Adv+", dailyGbp: 14.5 }, giver: { adsetId: "302", name: "Lineup — Primary" }, budgetLevel: "ad_set", eventCode: "P26-BDAY", ...WHERE, ...write },
  };
}

function seed(lines: Record<string, unknown>[], overrides: { spend?: number; budget?: number | null; stored?: Record<string, unknown>[] } = {}): MemoryDb {
  return memoryDb(
    {
      events: [{ id: "e1", user_id: "u1", budget_marketing: overrides.budget === undefined ? 4500 : overrides.budget, event_date: "2026-12-27" }],
      event_daily_rollups: [{ event_id: "e1", date: "2026-12-06", ad_spend: overrides.spend ?? 3860 }],
      onsale_refresh_proposals: [{ id: "p1", event_id: "e1", campaign_key: "On Sale", campaign_ids: ["c1"], window_end: "2026-12-06", cycle_monday: "2026-12-07" }],
      onsale_refresh_lines: lines,
      onsale_refresh_audiences: overrides.stored ?? [],
      campaign_drafts: [{ id: "d1", event_id: "e1", user_id: "u1", ad_account_id: "act_9", status: "published", meta_campaign_id: "c1", import_campaign_id: null, creatives: [] }],
      launched_ad_sets: [],
      meta_write_idempotency: [],
    },
    EMBEDS,
  );
}

type Fake = NewAdSetDeps["meta"] & { calls: string[]; payloads: Record<string, unknown>[]; specs: AudienceSpec[]; states: Map<string, AudienceState>; failAdsOnce: number };

function fakes(opts: { cbo?: boolean; retired?: string[]; giverBudget?: number; ads?: number } = {}) {
  const calls: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  const specs: AudienceSpec[] = [];
  const states = new Map<string, AudienceState>();
  let n = 0;
  const meta: Fake = {
    calls,
    payloads,
    specs,
    states,
    failAdsOnce: 0,
    async readAdSetForCopy(id) {
      calls.push(`copy:${id}`);
      return id === "303" ? { id, name: "Adv+", campaign_id: "c1", effective_status: "ACTIVE", status: "ACTIVE", targeting: SOURCE_TARGETING, daily_budget: "1450", optimization_goal: "OFFSITE_CONVERSIONS", billing_event: "IMPRESSIONS", bid_strategy: "LOWEST_COST_WITHOUT_CAP", promoted_object: { pixel_id: "645185673672763", custom_event_type: "INITIATED_CHECKOUT" }, attribution_spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }], destination_type: "WEBSITE", end_time: "2026-12-27T23:00:00+0000" } : null;
    },
    async readCampaignBudget() {
      return opts.cbo ? { daily: 20000, lifetime: null } : { daily: null, lifetime: null };
    },
    async listAdsForCopy() {
      const count = opts.ads ?? 7;
      return [...Array.from({ length: count }, (_, i) => ({ id: `a${i}`, name: `Ad ${i}`, creativeId: `cr${i}`, effectiveStatus: "ACTIVE" })), { id: "off", name: "Off", creativeId: "crOff", effectiveStatus: "PAUSED" }];
    },
    async readAdSet(id) {
      return { id, campaignId: "c1", dailyBudget: id === "302" ? (opts.giverBudget ?? 4000) : 1450 };
    },
    async createAdSet(_account, payload) {
      calls.push("adset");
      payloads.push(payload);
      return `new${++n}`;
    },
    async createAd(_account, ad) {
      calls.push(`ad:${ad.creative.creative_id}:${ad.status}`);
      if (meta.failAdsOnce > 0) {
        meta.failAdsOnce -= 1;
        throw Object.assign(new Error("User request limit reached"), { code: 17 });
      }
      return `ad${++n}`;
    },
    async updateAdSetDailyBudget(id, minor) {
      calls.push(`budget:${id}:${minor}`);
    },
    async checkInterests(interests) {
      const retired = new Set(opts.retired ?? []);
      return { valid: interests.filter((interest) => !retired.has(interest.name)), retired: interests.filter((interest) => retired.has(interest.name)).map((interest) => interest.name) };
    },
    async audienceState(id) {
      return states.get(id) ?? "ready";
    },
  };
  const ensureAudience = async (spec: AudienceSpec) => {
    specs.push(spec);
    calls.push(`audience:${spec.part}`);
    return { metaAudienceId: `aud-${spec.part}`, reused: false };
  };
  return { meta, ensureAudience };
}

function deps(mem: MemoryDb, fake: ReturnType<typeof fakes>, env: Record<string, string> = ENV): ApplyDeps {
  const refresh = {} as RefreshMeta;
  return { db: mem.db, env, meta: refresh, copyFromDrive: async () => ({ ok: false, reason: "no Drive" }), upload: async () => ({}), adsets: fake, now: NOW };
}

const apply = (mem: MemoryDb, fake: ReturnType<typeof fakes>, opts: { env?: Record<string, string>; retry?: boolean } = {}) => applyAccepted({ deps: deps(mem, fake, opts.env), eventId: "e1", userId: "u1", gates: live(opts.env), retry: opts.retry, appliedByName: "Matas" });
const lineOf = (mem: MemoryDb, id: string) => mem.tables.onsale_refresh_lines!.find((row) => row.id === id)!;

// ── Budget: the CBO / ABO matrix ─────────────────────────────────────────────

describe("P3 new ad sets: money (design's ruling) — CBO shares, ABO headroom, ABO move, ABO none", () => {
  it("decideFunding", () => {
    const base = { dailyGbp: 14.5, budget: 4500, spend: 3860, today: "2026-12-07", eventDate: "2026-12-27", appliedMovesGbp: 0, giver: { adsetId: "302", name: "Lineup — Primary" } };
    assert.deepEqual(decideFunding({ ...base, budgetLevel: "campaign" }), { mode: "cbo" });
    assert.deepEqual(decideFunding({ ...base, budgetLevel: "campaign", budget: null }), { mode: "cbo" }, "CBO adds no spend: no budget needed");
    assert.deepEqual(decideFunding({ ...base, budgetLevel: "ad_set" }), { mode: "headroom", dailyGbp: 14.5 }, "£14.50 × 20 = £290 ≤ £640");
    assert.deepEqual(decideFunding({ ...base, budgetLevel: "ad_set", spend: 4300 }), { mode: "none" }, "£290 > £200 left, and a week (£101.50) is past the £40 cap");
  });

  it("the move is inside the cap, else none", () => {
    const base = { budgetLevel: "ad_set" as const, budget: 4500, today: "2026-12-07", eventDate: "2026-12-27", giver: { adsetId: "302", name: "Lineup — Primary" } };
    // £1,000 left: headroom £14.50 × 20 = £290 fits.
    assert.equal(decideFunding({ ...base, dailyGbp: 14.5, spend: 3500, appliedMovesGbp: 0 }).mode, "headroom");
    // £200 left, cap £40: £5 a day × 20 = £100 fits headroom.
    assert.equal(decideFunding({ ...base, dailyGbp: 5, spend: 4300, appliedMovesGbp: 0 }).mode, "headroom");
    // £60 left, cap £12: £1.50 × 20 = £30 fits headroom; £5 × 20 = £100 doesn't; a week of £5 (£35) is past the £12 cap → none.
    assert.equal(decideFunding({ ...base, dailyGbp: 5, spend: 4440, appliedMovesGbp: 0 }).mode, "none");
    // £1,000 left, but £14.50 × 80 days won't fit; a week (£101.50) fits the £200 cap → move.
    assert.equal(decideFunding({ ...base, dailyGbp: 14.5, spend: 3500, appliedMovesGbp: 0, eventDate: "2027-02-25" }).mode, "move");
    // The same with £150 of the cap already moved → none.
    assert.equal(decideFunding({ ...base, dailyGbp: 14.5, spend: 3500, appliedMovesGbp: 150, eventDate: "2027-02-25" }).mode, "none");
    assert.equal(decideFunding({ ...base, dailyGbp: 14.5, spend: 0, budget: null, appliedMovesGbp: 0 }).mode, "none", "ABO with no budget: none");
    assert.equal(budgetText({ mode: "cbo" }), "shares the campaign budget");
    assert.equal(budgetText({ mode: "headroom", dailyGbp: 14.5 }), "£14.50 a day from plan headroom");
    assert.equal(budgetText({ mode: "move", dailyGbp: 14.5, fromAdsetId: "302", fromName: "Lineup — Primary" }), "£14.50 a day moved from Lineup — Primary");
  });

  it("CBO: the copy shares the campaign budget — no daily_budget, no bid strategy, no giver write", async () => {
    const mem = seed([clusterLine()], { budget: null });
    const fake = fakes({ cbo: true });
    await apply(mem, fake);
    assert.equal(lineOf(mem, "cl").state, "applied");
    const payload = fake.meta.payloads[0]!;
    assert.equal(payload.daily_budget, undefined);
    assert.equal(payload.bid_strategy, undefined);
    assert.ok(!fake.meta.calls.some((call) => call.startsWith("budget:")));
  });

  it("ABO, headroom: the copy takes the copied set's daily budget", async () => {
    const mem = seed([clusterLine()]);
    const fake = fakes();
    await apply(mem, fake);
    assert.equal(fake.meta.payloads[0]!.daily_budget, 1450);
    assert.deepEqual((lineOf(mem, "cl").applied_result as { funding: unknown }).funding, { mode: "headroom", dailyGbp: 14.5 });
    assert.ok(!fake.meta.calls.some((call) => call.startsWith("budget:")));
  });

  it("ABO, move: the giving side down first, then the new ad set; a week of it counts against the cap", async () => {
    const mem = seed([clusterLine("cl", { copyFrom: { adsetId: "303", name: "Adv+", dailyGbp: 14.5 } })], { spend: 4300, budget: 4600 });
    const fake = fakes();
    await apply(mem, fake);
    // £300 left; £14.50 × 20 = £290 fits headroom — so push the show out to force a move.
    assert.equal(lineOf(mem, "cl").state, "applied");
    const moving = seed([clusterLine()], { spend: 3500 });
    moving.tables.events![0]!.event_date = "2027-02-25";
    const fake2 = fakes();
    await apply(moving, fake2);
    assert.equal(lineOf(moving, "cl").state, "applied", String(lineOf(moving, "cl").reason));
    const order = fake2.meta.calls.filter((call) => call.startsWith("budget:") || call === "adset");
    assert.deepEqual(order, ["budget:302:2550", "adset"], "giver (£40.00 − £14.50 a day) before the new ad set");
    assert.equal((lineOf(moving, "cl").applied_result as { movedWeeklyGbp: number }).movedWeeklyGbp, 101.5);
  });

  it("ABO, move with the budget write's gate off: nothing is made", async () => {
    const mem = seed([clusterLine()], { spend: 3500 });
    mem.tables.events![0]!.event_date = "2027-02-25";
    const fake = fakes();
    await apply(mem, fake, { env: { ...ENV, ENABLE_OPTIMISATION_WRITES: "0" } });
    assert.equal(lineOf(mem, "cl").reason, MOVES_SWITCHED_OFF);
    assert.ok(!fake.meta.calls.includes("adset"));
  });

  it("ABO, no budget to start it: fails with the ruled sentence and writes nothing", async () => {
    const mem = seed([clusterLine()], { budget: null });
    const fake = fakes();
    await apply(mem, fake);
    assert.equal(lineOf(mem, "cl").reason, "No budget to start it: set this event's budget, or there's nothing left to move this refresh.");
    assert.equal(lineOf(mem, "cl").reason, NO_BUDGET_TO_START);
    assert.ok(!fake.meta.calls.includes("adset"));
  });
});

// ── The cluster ──────────────────────────────────────────────────────────────

describe("P3 new ad sets: an interest cluster brought back", () => {
  it("a copy with only the interests changed, 6 creatives reused (no uploads), live, named [CODE] {cluster}", async () => {
    const mem = seed([clusterLine()]);
    const fake = fakes();
    await apply(mem, fake);
    const payload = fake.meta.payloads[0]!;
    assert.equal(payload.name, "[P26-BDAY] Disc Genre");
    assert.equal(payload.status, "ACTIVE");
    assert.equal(payload.campaign_id, "c1");
    for (const field of ["optimization_goal", "billing_event", "promoted_object", "attribution_spec", "destination_type", "end_time"]) assert.deepEqual(payload[field], (await fake.meta.readAdSetForCopy("303"))![field], field);
    const targeting = payload.targeting as Record<string, unknown>;
    assert.deepEqual(targeting.geo_locations, SOURCE_TARGETING.geo_locations);
    assert.deepEqual(targeting.excluded_custom_audiences, SOURCE_TARGETING.excluded_custom_audiences);
    assert.deepEqual(targeting.publisher_platforms, SOURCE_TARGETING.publisher_platforms);
    assert.deepEqual(targeting.flexible_spec, [{ behaviors: [{ id: "b1", name: "Frequent travellers" }] }, { interests: INTERESTS }], "the interests replaced; the rest of the spec kept");
    assert.deepEqual(fake.meta.calls.filter((call) => call.startsWith("ad:")), ["ad:cr0:ACTIVE", "ad:cr1:ACTIVE", "ad:cr2:ACTIVE", "ad:cr3:ACTIVE", "ad:cr4:ACTIVE", "ad:cr5:ACTIVE"], "at most 6, delivering only");
    assert.equal(lineOf(mem, "cl").reason, "new ad set live, 6 ads");
    assert.deepEqual(mem.tables.onsale_refresh_audiences!.map((row) => [row.kind, row.part, row.campaign_key, row.meta_adset_id]), [["cluster", "adset", "On Sale::k1", "new1"]], "stored, so the next refresh doesn't propose it again");
  });

  it("interests Meta has retired are left out and listed; none left and the line fails", async () => {
    const mem = seed([clusterLine()]);
    const fake = fakes({ retired: ["Minimal techno"] });
    await apply(mem, fake);
    assert.equal(lineOf(mem, "cl").reason, "new ad set live, 6 ads. Left out, no longer offered by Meta: Minimal techno.");
    assert.equal(lineOf(mem, "cl").reason, OR9_RESULTS.cluster);
    assert.deepEqual(((fake.meta.payloads[0]!.targeting as Record<string, unknown>).flexible_spec as { interests?: unknown }[]).at(-1)!.interests, [INTERESTS[0], INTERESTS[2]]);
    const none = seed([clusterLine()]);
    const fake2 = fakes({ retired: INTERESTS.map((interest) => interest.name) });
    await apply(none, fake2);
    assert.equal(lineOf(none, "cl").reason, ALL_INTERESTS_RETIRED);
    assert.ok(!fake2.meta.calls.includes("adset"));
  });

  it("a partial: the ad set live, some ads; Retry makes only the missing ads, never a second ad set", async () => {
    const mem = seed([clusterLine()]);
    const fake = fakes();
    fake.meta.failAdsOnce = 2;
    await apply(mem, fake);
    assert.equal(lineOf(mem, "cl").state, "failed");
    assert.equal(lineOf(mem, "cl").reason, "Ad set live · 4 of 6 ads — Meta didn't take this — it's limiting calls on this account. Retry in a few minutes.");
    await apply(mem, fake, { retry: true });
    assert.equal(lineOf(mem, "cl").state, "applied");
    assert.equal(fake.meta.calls.filter((call) => call === "adset").length, 1, "one ad set");
    assert.equal(fake.meta.calls.filter((call) => call.startsWith("ad:")).length, 8, "6 tried, 2 retried");
  });

  it("a copy source no longer delivering: nothing is made", async () => {
    const mem = seed([clusterLine("cl", { copyFrom: { adsetId: "999", name: "Gone", dailyGbp: 5 } })]);
    const fake = fakes();
    await apply(mem, fake);
    assert.equal(lineOf(mem, "cl").reason, "The ad set it copies isn't delivering any more, so nothing was made.");
  });
});

// ── The standing defaults ────────────────────────────────────────────────────

describe("P3 new ad sets: a missing standing default", () => {
  it("retargeting: one audience from the pixel and video sources (landing page, ticket link, video viewers, registrations); the ad set aimed at it only", async () => {
    const mem = seed([defaultLine("retargeting")]);
    const fake = fakes();
    await apply(mem, fake);
    assert.equal(lineOf(mem, "retargeting").state, "applied", String(lineOf(mem, "retargeting").reason));
    assert.deepEqual(fake.meta.specs.map((spec) => [spec.part, spec.subtype, spec.name]), [
      ["landing", "website_pixel", "[P26-BDAY] landing page 30d"],
      ["ticket", "website_pixel", "[P26-BDAY] ticket link 30d"],
      ["video", "video_views", "[P26-BDAY] 75% video views 60d"],
      ["registrations", "website_pixel", "[P26-BDAY] CompleteRegistration 180d"],
    ]);
    const pixel = fake.meta.specs.filter((spec) => spec.subtype === "website_pixel") as Extract<AudienceSpec, { subtype: "website_pixel" }>[];
    assert.deepEqual(pixel.map((spec) => [spec.pixelId, spec.pixelEvent, spec.urlContains, spec.retentionDays]), [
      ["645185673672763", "PageView", ["puzzle.crqln.com/l/p26-bday"], 30],
      ["645185673672763", "PageView", ["skiddle.com/e/41234567"], 30],
      ["645185673672763", "CompleteRegistration", [], 180],
    ]);
    const targeting = fake.meta.payloads[0]!.targeting as Record<string, unknown>;
    assert.deepEqual(targeting.custom_audiences, ["aud-landing", "aud-ticket", "aud-video", "aud-registrations"].map((id) => ({ id })));
    assert.equal(targeting.flexible_spec, undefined, "interests and lookalikes come off");
    assert.equal(targeting.age_min, 18, "the 18+ floor");
    assert.deepEqual(targeting.geo_locations, SOURCE_TARGETING.geo_locations, "geography stays");
    assert.equal(fake.meta.payloads[0]!.name, "[P26-BDAY] Retargeting");
    assert.equal(lineOf(mem, "retargeting").reason, "audience made, new ad set live, 6 ads");
    assert.equal(mem.tables.onsale_refresh_audiences!.filter((row) => row.part !== "adset").length, 4, "every audience id stored on the event");
  });

  it("the lookalike: 1 % in the event's country, seeded from registrations; named per the ruling", async () => {
    const mem = seed([defaultLine("registrations_lookalike")]);
    const fake = fakes();
    await apply(mem, fake);
    const lookalike = fake.meta.specs.find((spec) => spec.part === "lookalike") as Extract<AudienceSpec, { subtype: "lookalike" }>;
    assert.deepEqual([lookalike.originAudienceId, lookalike.ratio, lookalike.country], ["aud-registrations", 0.01, "GB"]);
    assert.deepEqual((fake.meta.payloads[0]!.targeting as Record<string, unknown>).custom_audiences, [{ id: "aud-lookalike" }], "the lookalike only");
    assert.equal(fake.meta.payloads[0]!.name, "[P26-BDAY] Registrations lookalike 1%");
  });

  it("reuses a stored audience instead of building it again", async () => {
    const mem = seed([defaultLine("registrations_lookalike")], { stored: [{ id: "s1", event_id: "e1", user_id: "u1", kind: "registrations_lookalike", part: "registrations", campaign_key: "", meta_audience_id: "existing-seed" }] });
    const fake = fakes();
    await apply(mem, fake);
    assert.deepEqual(fake.meta.specs.map((spec) => spec.part), ["lookalike"], "the seed is reused, only the lookalike is built");
    assert.equal((fake.meta.specs[0] as Extract<AudienceSpec, { subtype: "lookalike" }>).originAudienceId, "existing-seed");
  });

  it("still being built: fails with the ruled sentence, keeps the ids; a retry after it's built makes one ad set, not two, and no second audience", async () => {
    const mem = seed([defaultLine("registrations_lookalike")]);
    const fake = fakes();
    fake.meta.states.set("aud-lookalike", "building");
    await apply(mem, fake);
    assert.equal(lineOf(mem, "registrations_lookalike").reason, AUDIENCE_BUILDING);
    assert.equal(lineOf(mem, "registrations_lookalike").reason, OR9_RESULTS.building);
    assert.ok(!fake.meta.calls.includes("adset"));
    fake.meta.states.set("aud-lookalike", "ready");
    await apply(mem, fake, { retry: true });
    await apply(mem, fake, { retry: true });
    assert.equal(lineOf(mem, "registrations_lookalike").state, "applied");
    assert.equal(fake.meta.calls.filter((call) => call === "adset").length, 1, "one ad set");
    assert.equal(fake.meta.specs.length, 2, "seed and lookalike built once each");
  });

  it("too small after creation: fails with the ruled sentence, and the audience is kept", async () => {
    const mem = seed([defaultLine("registrations_lookalike")]);
    const fake = fakes();
    fake.meta.states.set("aud-lookalike", "too_small");
    await apply(mem, fake);
    assert.equal(lineOf(mem, "registrations_lookalike").reason, "Meta didn't take this — the audience is too small to deliver.");
    assert.equal(lineOf(mem, "registrations_lookalike").reason, AUDIENCE_TOO_SMALL);
    assert.ok(mem.tables.onsale_refresh_audiences!.some((row) => row.part === "lookalike" && row.meta_audience_id === "aud-lookalike"));
  });

  it("a seed of 99 is refused before Accept; 100 is accepted", () => {
    const plan = planRun({ day: "2026-12-07", eventDate: "2026-12-27", config: ONSALE_PHASE, shadow: false });
    const set = (adsetId: string, name: string, extra: Partial<AdSetInput> = {}): AdSetInput => ({ adsetId, adsetIds: [adsetId], name, firstDay: "2026-11-01", lastDay: "2026-12-06", weekSpend: 70, weekResults: 10, totalSpend: 300, totalResults: 40, delivering: true, recentDailySpend: 10, deliveringAds: 4, ...extra });
    const input = (registrations: number): CampaignInput => ({
      eventId: "e1",
      eventCode: "P26-BDAY",
      eventName: "Puzzle",
      campaignKey: "Purchase",
      campaignIds: ["c1"],
      adAccountId: "act_9",
      draft: { draftId: "d1", adAccountId: "act_9", copy: null, budgetLevel: "campaign" },
      eventDate: "2026-12-27",
      signup: { event: "CompleteRegistration", registrations180: registrations, landing30: 10, ticket30: 5 },
      country: "GB",
      onSaleDay: "2026-10-30",
      plan,
      resultEvent: "initiate_checkout",
      weekSpend: 140,
      weekResults: 20,
      totalSpend: 600,
      totalResults: 80,
      totalFirstDay: "2026-11-01",
      ads: [],
      adSets: [set("s1", "Broad — Primary"), set("s2", "Lineup — Primary", { weekSpend: 100 })],
      clusters: [],
      supply: [],
      claims: [],
      budgetGbp: 4500,
      spendToDateGbp: 3860,
      ticketingLinked: false,
      ticketingProvider: null,
      last14: { ic: 40, purchases: 0, lpv: 0 },
      sinceOnSale: { ic: 80, purchases: 0, fromDay: "2026-10-30" },
    });
    const lookalike = (n: number) => audienceLines(input(n), ONSALE_PHASE).lines.find((line) => line.ruleId === "missing_default.registrations_lookalike")!;
    assert.equal(lookalike(99).blockedReason, "Too few registrations for a lookalike yet: 99 of 100.");
    assert.equal(lookalike(100).blockedReason, null);
    assert.equal(seedTooSmall(64), OR8_SEED);
    // The page fires no signup the ads have recorded: no registrations to build from.
    const unread = audienceLines({ ...input(500), signup: { event: null, registrations180: 0, landing30: 0, ticket30: 0 } }, ONSALE_PHASE).lines.find((line) => line.ruleId === "missing_default.registrations_lookalike")!;
    assert.equal(unread.blockedReason, SIGNUP_NOT_READ);
    // The default's ad set already stored: not proposed again.
    assert.ok(!audienceLines({ ...input(500), storedDefaults: ["registrations_lookalike"] }, ONSALE_PHASE).lines.some((line) => line.ruleId === "missing_default.registrations_lookalike"));
  });
});

// ── Registrations come from the pixel ────────────────────────────────────────

describe("P3: registrations are the page's own signup event on the pixel, read, never guessed", () => {
  const row = (date: string, extra: Record<string, unknown>) => ({ meta_ad_id: "a", meta_adset_id: "s", meta_campaign_id: "c", ad_account_id: "9", date, ad_name: "a", adset_name: "s", campaign_name: "c", spend: 1, landing_page_views: 3, purchases: 0, actions: [], ...extra });
  it("the signup ad sets' promoted event first, else the pixel action recorded; none → null", () => {
    assert.equal(signupFacts([row("2026-11-01", { promoted_event: "LEAD", actions: [{ action_type: "offsite_conversion.fb_pixel_complete_registration", value: 9 }] })], "2026-12-06").event, "Lead");
    assert.equal(signupFacts([row("2026-11-01", { actions: [{ action_type: "offsite_conversion.fb_pixel_complete_registration", value: 9 }] })], "2026-12-06").event, "CompleteRegistration");
    assert.equal(signupFacts([row("2026-11-01", { actions: [{ action_type: "offsite_conversion.fb_pixel_lead", value: 2 }] })], "2026-12-06").event, "Lead");
    assert.equal(signupFacts([row("2026-11-01", {})], "2026-12-06").event, null);
  });

  it("our counts: registrations over 180 days, landing-page visitors (LPV) and ticket-link visitors (IC) over 30", () => {
    const facts = signupFacts(
      [
        row("2026-05-01", { actions: [{ action_type: "offsite_conversion.fb_pixel_complete_registration", value: 50 }] }),
        row("2026-10-01", { actions: [{ action_type: "offsite_conversion.fb_pixel_complete_registration", value: 30 }, { action_type: "omni_initiated_checkout", value: 4 }] }),
        row("2026-11-20", { actions: [{ action_type: "offsite_conversion.fb_pixel_complete_registration", value: 5 }, { action_type: "omni_initiated_checkout", value: 7 }], landing_page_views: 40 }),
      ],
      "2026-12-06",
    );
    assert.deepEqual(facts, { event: "CompleteRegistration", registrations180: 35, landing30: 40, ticket30: 7 });
  });
});

// ── Words ────────────────────────────────────────────────────────────────────

describe("P3 new ad sets: design's words, and OR8 / OR9's", () => {
  it("the cluster's and the defaults' lines", () => {
    const copy = { adsetId: "303", name: "Adv+", cprGbp: 6.1, resultLabel: "IC", dailyGbp: 14.5, creatives: 6 };
    assert.equal(clusterWrite(copy, { mode: "headroom", dailyGbp: 14.5 }), OR8_CLUSTER.write);
    assert.equal(interestsLine(["Disc Genre", "Minimal techno", "Deep house", "a", "b", "c", "d"]), OR8_CLUSTER.extra);
    assert.equal(defaultWrite({ ...copy, name: "Broad — Primary", creatives: 4 }, { mode: "headroom", dailyGbp: 3.8 }), OR8_RETARGETING.write);
    assert.equal(retargetingEvidence({ landing: 1840, ticket: 412, registrations: 3105 }), OR8_RETARGETING.extra);
    assert.equal(lookalikeEvidence(64, "GB"), OR8_LOOKALIKE.extra);
    assert.equal(appliedNewAdSet("retargeting", 4), OR9_RESULTS.retargeting);
    assert.equal(audienceName("P26-BDAY", "video", null, "GB"), "[P26-BDAY] 75% video views 60d");
    assert.equal(urlFragment("https://www.skiddle.com/e/41234567/?utm=1"), "skiddle.com/e/41234567");
  });

  it("targeting: a cluster keeps everything but the interests; a default its audience only, 18+", () => {
    assert.deepEqual(clusterTargeting({ flexible_spec: [{ interests: [{ id: "1", name: "x" }] }] }, [{ id: "2", name: "y" }]).flexible_spec, [{ interests: [{ id: "2", name: "y" }] }]);
    const aimed = audienceOnlyTargeting({ ...SOURCE_TARGETING, interests: [{ id: "1" }], targeting_automation: { advantage_audience: 1 } }, ["a1"]);
    assert.deepEqual(aimed.custom_audiences, [{ id: "a1" }]);
    assert.equal(aimed.interests, undefined);
    assert.equal(aimed.flexible_spec, undefined);
    assert.equal(aimed.age_min, 18);
    assert.deepEqual(aimed.targeting_automation, { advantage_audience: 0 });
    assert.deepEqual(aimed.excluded_custom_audiences, SOURCE_TARGETING.excluded_custom_audiences);
  });
});

// ── No customer list, anywhere in this path ──────────────────────────────────

describe("P3: no customer-file or user-hash upload anywhere in this path (ops)", () => {
  const FILES = [
    "lib/onsale-refresh/apply-adsets.ts",
    "lib/onsale-refresh/new-adset.ts",
    "lib/onsale-refresh/apply.ts",
    "app/api/events/[id]/onsale-refresh/apply/route.ts",
    // The audience builder this path calls.
    "lib/meta/audience-write.ts",
    "lib/meta/audience-payload.ts",
    "lib/db/meta-custom-audiences.ts",
  ];
  it("never names a customer-file endpoint, a user-hash schema or a customer-file source", () => {
    for (const file of FILES) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /customaudiences\/[^"'`]*\/users|\/users["'`?]|usersofanyaudience/i, `${file}: a /users upload endpoint`);
      assert.doesNotMatch(source, /EMAIL_SHA256|PHONE_SHA256|MADID|EXTERN_ID|customer_file_source|"schema"\s*:/i, `${file}: a user-hash schema`);
      assert.doesNotMatch(source, /subtype:\s*["']CUSTOM["']/, `${file}: a CUSTOM (customer list) subtype`);
    }
  });

  it("the specs this path hands the builder are pixel, video and lookalike only", () => {
    const source = readFileSync("lib/onsale-refresh/apply-adsets.ts", "utf8");
    const subtypes = [...source.matchAll(/subtype: "([a-z_]+)"/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(subtypes)].sort(), ["lookalike", "video_views", "website_pixel"]);
  });
});
