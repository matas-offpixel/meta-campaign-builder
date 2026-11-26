/**
 * The two-campaign record, staged (scratch/retargeting-two-campaigns-2026-11-26.md):
 * the Similar tier with and without a group, its proposed split (read from
 * the one config object), Similar lists in Warm, presale mode, Wider's ad
 * sets and settings, the Lookalikes ad set, Wider's lifetime step, the keep /
 * pause / fold advice, the page-group seed plan and the settings read-back.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { tierAdSetPayload, widerAdSetPayload, widerCampaignFields } from "../apply.ts";
import { capTiers, funnelSpecs, funnelTiersMatching, RF3, SPLIT_WITH_SIMILAR, splitOf, splitTotal, stepsAfter, type FunnelSources, type PageGroup } from "../funnel.ts";
import { planFunnelShow } from "../funnel-plan.ts";
import { planPageGroups } from "../page-groups.ts";
import { adviseExisting, advantageOff, geoExpansionOff, lookalikeOrigins, SHOW_CAMPAIGNS_RULED, untickLine, widerAfterStep, widerSpecs } from "../show-campaigns.ts";

const SOURCES: FunnelSources = {
  pixelId: "px1",
  links: [
    { kind: "ticket", rule: "skiddle.com/e/1", host: "skiddle.com", name: "Skiddle", platform: "skiddle" },
    { kind: "landing", rule: "crqln.com/l/x", host: "crqln.com", name: "crqln.com/l/x", platform: null },
  ],
  accounts: [
    { pageId: "1001", name: "NX Newcastle", platform: "facebook", kind: "promoter", access: true },
    { pageId: "1002", name: "Rudimental", platform: "facebook", kind: "lineup", access: true },
  ],
  videos: [{ pageId: "1001", videoIds: ["v1"] }],
  lists: [
    { metaAudienceId: "sig1", name: "Signups", role: "signups", uploadedAt: "2026-11-01" },
    { metaAudienceId: "sim1", name: "Melodic Techno Similar Data", role: "similar", uploadedAt: "2026-11-01" },
    { metaAudienceId: "buy1", name: "Buyers", role: "buyers", uploadedAt: "2026-11-01" },
  ],
};
const GROUP: PageGroup = { id: "g1", genreFamily: "drum_and_bass", pageIds: ["2001", "2002", "2003", "2004", "2005", "2006"], igIds: ["ig1"], confirmed: true };
const PROSPECTING = [{ id: "5001", kind: "adset" as const, name: "Broad · Advantage+", dailyMinor: 6000, adSets: 1 }];

describe("the staged record is off", () => {
  it("SHOW_CAMPAIGNS_RULED is false, and RF3's split gives Similar nothing", () => {
    assert.equal(SHOW_CAMPAIGNS_RULED, false);
    for (const stretch of Object.keys(RF3) as (keyof typeof RF3)[]) assert.equal(splitOf(stretch).similar, 0);
    assert.deepEqual(funnelSpecs(SOURCES, { pageGroup: GROUP }).map((spec) => spec.tier), ["cold", "warm", "hot"]);
  });
});

describe("Similar: the genre group's engagers, minus Cold", () => {
  it("with a confirmed group: ≤ 5 pages an audience; it leaves out every tier to its right and buyers; nobody is in two tiers", () => {
    const specs = funnelSpecs(SOURCES, { twoCampaigns: true, pageGroup: GROUP });
    assert.deepEqual(specs.map((spec) => spec.tier), ["similar", "cold", "warm", "hot"]);
    const similar = specs[0]!;
    assert.deepEqual(similar.includes.filter((aud) => aud.kind === "page_fb").map((aud) => ("pageIds" in aud ? aud.pageIds.length : 0)), [5, 1]);
    const right = new Set(specs.slice(1).flatMap((spec) => spec.includes.map((aud) => aud.key)));
    for (const key of right) assert.ok(similar.excludes.some((aud) => aud.key === key), key);
    assert.ok(similar.excludes.some((aud) => aud.key === "list:buy1"));
    assert.ok(funnelTiersMatching(specs, new Set([similar.includes[0]!.key, specs[1]!.includes[0]!.key])).length <= 1);
  });

  it("no group, or an unconfirmed one: no Similar tier, and its share goes to the others", () => {
    for (const pageGroup of [null, { ...GROUP, confirmed: false }]) {
      const specs = funnelSpecs(SOURCES, { twoCampaigns: true, pageGroup });
      assert.equal(specs[0]!.tier, "cold");
    }
    const plan = planFunnelShow({ code: "X", runDay: "2026-10-20", showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES, spec: { twoCampaigns: true, pageGroup: null } });
    assert.equal(plan.tiers.similar, 0);
    assert.equal(plan.tiers.cold + plan.tiers.warm + plan.tiers.hot, plan.totalMinor);
  });

  it("Similar lists move to Warm", () => {
    const specs = funnelSpecs(SOURCES, { twoCampaigns: true, pageGroup: GROUP });
    assert.ok(specs.find((spec) => spec.tier === "warm")!.includes.some((aud) => aud.key === "list:sim1"));
    assert.ok(!specs.find((spec) => spec.tier === "hot")!.includes.some((aud) => aud.key === "list:sim1"));
    // Under #1396 they stay in Hot.
    assert.ok(funnelSpecs(SOURCES).find((spec) => spec.tier === "hot")!.includes.some((aud) => aud.key === "list:sim1"));
  });
});

describe("the proposed split (one config object, not ruled)", () => {
  it("each stretch's split adds to 100, and a plan splits by it", () => {
    for (const [stretch, split] of Object.entries(SPLIT_WITH_SIMILAR)) assert.equal(split.similar + split.cold + split.warm + split.hot, 100, stretch);
    const plan = planFunnelShow({ code: "X", runDay: "2026-10-20", showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES, spec: { twoCampaigns: true, pageGroup: GROUP } });
    assert.equal(plan.stretch, "normally");
    const want = splitTotal(plan.totalMinor, SPLIT_WITH_SIMILAR.normally)!;
    assert.deepEqual(plan.tiers, want.tiers);
    assert.ok(plan.tiers.similar > 0);
  });

  it("the frequency cap passes Cold's extra to Similar, and Similar's back to prospecting", () => {
    const shares = { similar: 400, cold: 600, warm: 700, hot: 300 };
    const out = capTiers(shares, { cold: { frequency: 3.5, spendMinor: 2800 }, similar: { frequency: 3.4, spendMinor: 2100 } }, [{ id: "5001", kind: "adset", name: "Broad", beforeMinor: 6000, afterMinor: 4000 }]);
    assert.equal(out.caps.cold?.to, "similar");
    assert.equal(out.caps.similar?.to, "prospecting");
    assert.deepEqual(out.back, [{ id: "5001", name: "Broad", minor: 400 + 200 - 300 }]);
  });
});

describe("presale mode", () => {
  it("Hot is the sign-up page's visitors; registrants are left out of every tier; no ticket audiences", () => {
    const specs = funnelSpecs(SOURCES, { presale: true });
    const hot = specs.find((spec) => spec.tier === "hot")!;
    assert.ok(hot.includes.some((aud) => aud.key === "rf:signup_visitors:30"));
    assert.ok(!specs.flatMap((spec) => spec.includes).some((aud) => aud.source === "ticket" || aud.source === "checkout"));
    for (const spec of specs) {
      assert.ok(spec.excludes.some((aud) => aud.key === "rf:registrations:180"), spec.tier);
      assert.ok(spec.excludes.some((aud) => aud.key === "list:sig1"), spec.tier);
    }
    // On sale, registrants are in Hot.
    assert.ok(funnelSpecs(SOURCES).find((spec) => spec.tier === "hot")!.includes.some((aud) => aud.key === "rf:registrations:180"));
  });
});

describe("Wider", () => {
  const input = { sources: SOURCES, pageGroup: GROUP, lineupInterests: [{ id: "6003", name: "Rudimental" }], genreInterests: [{ id: "6004", name: "Drum and bass" }] };

  it("Broad, Similar pages, Interests and Lookalikes; each leaves out buyers, Hot and Warm, and Cold stays open", () => {
    const sets = widerSpecs(input);
    assert.deepEqual(sets.map((set) => set.key), ["broad", "similar_pages", "interests", "lookalikes"]);
    const specs = funnelSpecs(SOURCES, { twoCampaigns: true, pageGroup: GROUP });
    const cold = new Set(specs.find((spec) => spec.tier === "cold")!.includes.map((aud) => aud.key));
    for (const set of sets) {
      assert.ok(set.excludes.some((aud) => aud.key === "list:buy1"));
      assert.ok(set.excludes.some((aud) => aud.key === "rf:ticket:30"));
      assert.ok(!set.excludes.some((aud) => cold.has(aud.key)), "Cold stays open");
    }
    assert.deepEqual(sets[0]!.interests, input.lineupInterests);
  });

  it("the Lookalikes ad set: one 1 % GB lookalike per source — artist engagers and followers, signups, similar lists", () => {
    const lal = widerSpecs(input).find((set) => set.key === "lookalikes")!;
    const origins = lookalikeOrigins(SOURCES).map((aud) => aud.key);
    assert.deepEqual(lal.lookalikes.map((row) => row.originKey), origins);
    assert.ok(origins.includes("list:sig1") && origins.includes("list:sim1") && !origins.includes("list:buy1"));
    assert.ok(origins.some((key) => key.startsWith("rf:engaged_fb:180")) && origins.some((key) => key.startsWith("rf:followers_fb")));
    assert.ok(lal.lookalikes.every((row) => row.country === "GB" && row.ratio === 0.01));
  });

  it("settings: Advantage+ on for Wider (with #1387's age), off for Retargeting; the budget is the campaign's lifetime", () => {
    const wider = widerAdSetPayload({ name: "X · Wider · Broad", campaignId: "1", pixelId: "px1", customConversionId: null, endDay: "2026-12-12", location: { geo_locations: { cities: [{ key: "1" }] } }, interests: input.lineupInterests, suggestionIds: [], excludeIds: ["9"] });
    const targeting = wider.targeting as Record<string, unknown>;
    assert.deepEqual(targeting.targeting_automation, { advantage_audience: 1 });
    assert.equal(targeting.age_max, 65);
    assert.deepEqual(targeting.flexible_spec, [{ interests: [{ id: "6003", name: "Rudimental" }] }]);
    assert.equal(wider.daily_budget, undefined);
    assert.deepEqual(widerCampaignFields({ lifetimeMinor: 120000 }), { lifetime_budget: 120000, bid_strategy: "LOWEST_COST_WITHOUT_CAP" });
    const retargeting = tierAdSetPayload({ code: "X", tier: "cold", campaignId: "2", dailyMinor: 500, pixelId: "px1", customConversionId: null, endDay: "2026-12-12", location: { geo_locations: { cities: [{ key: "1" }] } }, includeIds: ["7"], excludeIds: [], name: "X · Retargeting · Cold" });
    assert.equal(((retargeting.targeting as Record<string, unknown>).targeting_automation as { advantage_audience: number }).advantage_audience, 0);
  });

  it("each step lowers Wider's remaining lifetime budget by the step × days left, never below £1.00 a day per ad set", () => {
    assert.deepEqual(widerAfterStep({ remainingMinor: 100000, stepMinor: 300, daysLeft: 14, adSets: 4 }), { afterMinor: 95800, floorMinor: 5600, lowered: 4200, atFloor: false });
    const floored = widerAfterStep({ remainingMinor: 6000, stepMinor: 600, daysLeft: 7, adSets: 4 });
    assert.deepEqual([floored.afterMinor, floored.atFloor], [2800, true]);
    // The steps it takes are RF3's, on the same days.
    assert.deepEqual(stepsAfter("2026-11-26", { showDay: "2026-12-12", announceDay: "2026-09-29" }).map((step) => step.day), ["2026-11-28", "2026-12-05"]);
  });
});

describe("existing campaigns: keep, pause or fold into Wider (advice only)", () => {
  it("prospecting folds, a lineup or old retargeting campaign pauses, anything else is kept; a paused campaign isn't listed", () => {
    const advice = adviseExisting([
      { id: "1", name: "X · Prospecting", adSetNames: ["Broad · Advantage+", "Interests · techno", "Lookalike 1 %"], delivering: true },
      { id: "2", name: "X · Lineup", adSetNames: ["Lineup · interests"], delivering: true },
      { id: "3", name: "X · Tests", adSetNames: ["X · Tests · A"], delivering: true },
      { id: "4", name: "X · Old", adSetNames: ["Broad"], delivering: false },
    ]);
    assert.deepEqual(advice.map((row) => [row.name, row.advice]), [["X · Prospecting", "fold"], ["X · Lineup", "pause"], ["X · Tests", "keep"]]);
  });
});

describe("page groups: the seed plan", () => {
  it("one group per client and genre from pages the business can build from; a confirmed group is never rewritten", () => {
    const plan = planPageGroups(
      [
        { clientId: "c1", pageId: "2001", igId: "ig1", name: "A", genreFamily: "techno", canBuild: true },
        { clientId: "c1", pageId: "2002", igId: null, name: "B", genreFamily: "techno", canBuild: true },
        { clientId: "c1", pageId: "2003", igId: null, name: "C", genreFamily: "techno", canBuild: false },
        { clientId: "c1", pageId: "2004", igId: null, name: "D", genreFamily: null, canBuild: true },
        { clientId: "c2", pageId: "3001", igId: null, name: "E", genreFamily: "techno", canBuild: true },
      ],
      [{ id: "g2", client_id: "c2", genre_family: "techno", page_ids: ["9999"], ig_ids: [], confirmed_at: "2026-11-26T10:00:00Z" }],
    );
    assert.deepEqual(plan, [
      { clientId: "c1", genreFamily: "techno", pageIds: ["2001", "2002"], igIds: ["ig1"], action: "insert" },
      { clientId: "c2", genreFamily: "techno", pageIds: ["3001"], igIds: [], action: "confirmed_kept" },
    ]);
  });
});

describe("the settings read-back (Matas, 26 Nov item 2)", () => {
  it("location expansion is off only when individual_setting.geo is 0 (a missing key isn't proof); a mismatch gets the untick line", () => {
    assert.equal(geoExpansionOff({ targeting_automation: { advantage_audience: 0, individual_setting: { geo: 0 } } }), true);
    assert.equal(geoExpansionOff({ targeting_automation: { advantage_audience: 0 } }), false);
    assert.equal(geoExpansionOff({ targeting_automation: { advantage_audience: 1, individual_setting: { age: 1, geo: 1 } } }), false);
    assert.equal(advantageOff({ targeting_automation: { advantage_audience: 0 } }), true);
    assert.equal(untickLine("X · Retargeting · Hot"), "Untick 'Reach more people likely to respond to your ads' in Ads Manager for X · Retargeting · Hot.");
  });
});
