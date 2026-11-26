/**
 * The two-campaign record (docs/design-record/2026-11-26-retargeting-two-campaigns.html, TC1–TC9):
 * the Similar tier with and without a group, its proposed split (read from
 * the one config object), Similar lists in Warm, presale mode, Wider's ad
 * sets and settings, the Lookalikes ad set, Wider's lifetime step, the keep /
 * pause / fold advice, the page-group seed plan and the settings read-back.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { promotedObject, tierAdSetPayload, widerAdSetPayload, widerCampaignFields } from "../apply.ts";
import { capTiers, funnelSpecs, funnelTiersMatching, RF3, SPLIT_WITH_SIMILAR, splitOf, splitTotal, stepsAfter, type FunnelAudience, type FunnelSources, type PageGroup } from "../funnel.ts";
import { fill } from "../funnel-words.ts";
import { nextGivesBack, planFunnelShow, similarReturnLine, similarSkipLine } from "../funnel-plan.ts";
import { cardMeta, createTitle, runningPanel, similarReturnOf, widerRow } from "../funnel-view.ts";
import { funnelAudienceName, lookalikeName } from "../funnel-apply.ts";
import { similarStepDue } from "../runner.ts";
import { CONFIRMED_STATUS, confirmedGenreRows, noGenreLine, parseGenreRows, planPageGroups, sourcesFromGenreRows } from "../page-groups.ts";
import { adviseExisting, advantageOff, geoExpansionOff, geoNotReadLine, lookalikeOrigins, planWider, SHOW_CAMPAIGNS_RULED, untickLine, widerCampaignName, widerAdSetName, widerGive, widerSpecs } from "../show-campaigns.ts";

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
const GROUP: PageGroup = { id: "g1", genreFamily: "dnb", pageIds: ["2001", "2002", "2003", "2004", "2005", "2006"], igIds: ["ig1"], confirmed: true };
const PROSPECTING = [{ id: "5001", kind: "adset" as const, name: "Broad · Advantage+", dailyMinor: 6000, adSets: 1 }];

describe("the record is on", () => {
  it("SHOW_CAMPAIGNS_RULED is true; one campaign (the fallback) keeps RF3's split, with nothing for Similar", () => {
    assert.equal(SHOW_CAMPAIGNS_RULED, true);
    for (const stretch of Object.keys(RF3) as (keyof typeof RF3)[]) assert.equal(splitOf(stretch).similar, 0);
    assert.deepEqual(funnelSpecs(SOURCES, { pageGroup: GROUP }).map((spec) => spec.tier), ["cold", "warm", "hot"]);
  });

  it("TC1: the names exactly", () => {
    assert.equal(widerCampaignName("NX26-RUDIMENTAL"), "NX26-RUDIMENTAL · Wider");
    assert.deepEqual((["broad", "similar_pages", "interests", "lookalikes"] as const).map((key) => widerAdSetName("NX26-RUDIMENTAL", key)), ["NX26-RUDIMENTAL · Wider · Broad", "NX26-RUDIMENTAL · Wider · Similar pages", "NX26-RUDIMENTAL · Wider · Interests", "NX26-RUDIMENTAL · Wider · Lookalikes"]);
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

describe("the split (one config object, confirmed 26 Nov)", () => {
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
    const specs = funnelSpecs(SOURCES, { twoCampaigns: true, presale: true });
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

  it("TC7: a presale show's ad sets, in both campaigns, optimise on CompleteRegistration; on sale, the show's purchase", () => {
    assert.deepEqual(promotedObject({ pixelId: "px1", customConversionId: null, presale: true }), { pixel_id: "px1", custom_event_type: "COMPLETE_REGISTRATION" });
    assert.deepEqual(promotedObject({ pixelId: "px1", customConversionId: "cc1", presale: true }), { pixel_id: "px1", custom_event_type: "COMPLETE_REGISTRATION" });
    assert.deepEqual(promotedObject({ pixelId: "px1", customConversionId: "cc1" }), { pixel_id: "px1", custom_conversion_id: "cc1" });
    assert.deepEqual(promotedObject({ pixelId: "px1", customConversionId: null }), { pixel_id: "px1", custom_event_type: "PURCHASE" });
    const loc = { geo_locations: { cities: [{ key: "1" }] } };
    assert.deepEqual(widerAdSetPayload({ presale: true, name: "X · Wider · Broad", campaignId: "1", pixelId: "px1", customConversionId: null, endDay: "2026-12-04", location: loc, interests: [], suggestionIds: [], excludeIds: [] }).promoted_object, { pixel_id: "px1", custom_event_type: "COMPLETE_REGISTRATION" });
    assert.deepEqual(tierAdSetPayload({ presale: true, code: "X", tier: "hot", campaignId: "2", dailyMinor: 100, pixelId: "px1", customConversionId: null, endDay: "2027-02-13", location: loc, includeIds: ["7"], excludeIds: [] }).promoted_object, { pixel_id: "px1", custom_event_type: "COMPLETE_REGISTRATION" });
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

  it("TC6: each step lowers Wider's remaining lifetime budget by the step × days left, never below £1.00 a day per ad set", () => {
    assert.equal(widerGive({ remainingMinor: 100000, wantDailyMinor: 300, daysLeft: 14, adSets: 4 }), 300);
    // £60.00 left over 7 days with four ad sets keeps £28.00: a £6.00 step gives £4.57.
    assert.equal(widerGive({ remainingMinor: 6000, wantDailyMinor: 600, daysLeft: 7, adSets: 4 }), 457);
    assert.equal(widerGive({ remainingMinor: 2000, wantDailyMinor: 600, daysLeft: 7, adSets: 4 }), 0);
    // A step down gives Retargeting's money back to Wider in full.
    assert.equal(widerGive({ remainingMinor: 100, wantDailyMinor: -300, daysLeft: 7, adSets: 4 }), -300);
    const w = planWider({ showDailyMinor: 6000, retargetingMinor: 2100, runDay: "2026-11-26", showDay: "2026-12-12", adSets: 4, steps: [{ day: "2026-11-28", totalMinor: 2400 }, { day: "2026-12-05", totalMinor: 3000 }] });
    assert.deepEqual([w.lifetimeMinor, w.dailyMinor, w.daysLeft], [66300, 3900, 17]);
    assert.deepEqual(w.steps.map((step) => step.givenDailyMinor), [300, 600]);
    // TW-C's Wider row: what's left of the lifetime it was made with, and the last step (muted) or the floor (ochre).
    const made = { lifetimeMinor: w.lifetimeMinor, dailyMinor: w.dailyMinor, daysLeft: w.daysLeft, endDay: "2026-12-12", steps: w.steps, adSets: 4 };
    const before = widerRow({ ...made, remainingMinor: 58500, doneDays: [] }, { today: "2026-11-28", stretchOf: () => "final_2w" });
    assert.equal(before.row, "Wider · £585.00 of £663.00 lifetime left · £39.00 a day to Sat 12 Dec");
    assert.equal(before.line, null);
    const after = widerRow({ ...made, remainingMinor: 54000, doneDays: ["2026-11-28"] }, { today: "2026-11-28", stretchOf: () => "final_2w" });
    assert.equal(after.row, "Wider · £540.00 of £618.00 lifetime left · £36.00 a day to Sat 12 Dec");
    assert.deepEqual(after.line, { text: "Lowered by £45.00 on Sat 28 Nov: £3.00 a day × 15 days moved to Retargeting for final 2 weeks.", tone: "muted" });
    const floor = widerRow({ lifetimeMinor: 30000, dailyMinor: 1100, daysLeft: 4, endDay: "2026-11-30", remainingMinor: 4400, adSets: 4, doneDays: [], steps: [{ day: "2026-11-27", beforeMinor: 30000, afterMinor: 30000, wantDailyMinor: 900, givenDailyMinor: 900, atFloor: false }] }, { today: "2026-11-27", stretchOf: () => "final_week" });
    assert.equal(floor.row, "Wider · £44.00 of £300.00 lifetime left · £11.00 a day to Mon 30 Nov");
    assert.deepEqual(floor.line, { text: "Wider can give £7.00 a day of the £9.00 without going under £1.00 a day an ad set, so Retargeting rises by £7.00 a day.", tone: "ochre" });
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
  it("one group per client and genre, owned and client-shared alike, Pages and Instagram apart; a confirmed group is never rewritten; no genre is said, not guessed", () => {
    const { plan, counts } = planPageGroups(
      [
        { client_id: "c1", kind: "facebook_page", id: "2001", name: "A", genre_family: "techno", reach: "owned" },
        { client_id: "c1", kind: "instagram_account", id: "ig1", name: "A", genre_family: "techno", reach: "owned" },
        { client_id: "c1", kind: "facebook_page", id: "2002", name: "B", genre_family: "techno", reach: "client_shared" },
        { client_id: "c1", kind: "facebook_page", id: "2004", name: "D", genre_family: null, reach: "owned" },
        { client_id: "c2", kind: "facebook_page", id: "3001", name: "E", genre_family: "techno", reach: "owned" },
        { client_id: "c3", kind: "facebook_page", id: "4001", name: "F", genre_family: null, reach: "owned" },
      ],
      [{ id: "g2", client_id: "c2", genre_family: "techno", page_ids: ["9999"], ig_ids: [], confirmed_at: "2026-11-26T10:00:00Z" }],
    );
    assert.deepEqual(plan, [
      { clientId: "c1", genreFamily: "techno", pageIds: ["2001", "2002"], igIds: ["ig1"], action: "insert" },
      { clientId: "c2", genreFamily: "techno", pageIds: ["3001"], igIds: [], action: "confirmed_kept" },
    ]);
    assert.deepEqual(counts.find((row) => row.clientId === "c3"), { clientId: "c3", sources: 1, noGenre: 1, groups: 0 });
    assert.equal(noGenreLine(counts.find((row) => row.clientId === "c3")!), "client=c3: 1 of 1 pages and Instagram accounts have no genre yet, so no group is made. Set the genres first.");
  });
});

describe("the settings read-back (Matas, 26 Nov item 2)", () => {
  it("location expansion is off only when individual_setting.geo is 0 (a missing key isn't proof); a mismatch gets the untick line", () => {
    assert.equal(geoExpansionOff({ targeting_automation: { advantage_audience: 0, individual_setting: { geo: 0 } } }), true);
    assert.equal(geoExpansionOff({ targeting_automation: { advantage_audience: 0 } }), false);
    assert.equal(geoExpansionOff({ targeting_automation: { advantage_audience: 1, individual_setting: { age: 1, geo: 1 } } }), false);
    assert.equal(advantageOff({ targeting_automation: { advantage_audience: 0 } }), true);
    // Design's words on #1401 (27 Nov), curly quotes and apostrophes as ruled.
    assert.equal(untickLine("X · Retargeting · Hot"), "X · Retargeting · Hot still has location expansion on. Untick “Reach more people likely to respond to your ads” for it in Ads Manager.");
    assert.equal(geoNotReadLine("X · Retargeting · Hot"), "Location expansion couldn’t be read back for X · Retargeting · Hot, so it may be on. Check “Reach more people likely to respond to your ads” in Ads Manager.");
  });
});

describe("Matas, 26 Nov: no Similar this stretch, its share goes to Cold, and the plan says so", () => {
  const plan = (spec: Parameters<typeof planFunnelShow>[0]["spec"], over: Partial<Parameters<typeof planFunnelShow>[0]> = {}) =>
    planFunnelShow({ code: "X", runDay: "2026-10-20", showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: PROSPECTING, sources: SOURCES, spec, ...over });

  for (const [label, spec, reason, line] of [
    ["no genre", { twoCampaigns: true, pageGroup: null, genreFamily: null }, "no_genre", "Similar skipped: X has no genre, so its share goes to Cold."],
    ["no confirmed group", { twoCampaigns: true, pageGroup: { ...GROUP, confirmed: false }, genreFamily: "dnb" }, "no_group", "Similar skipped: no drum & bass page group yet, so its share goes to Cold."],
    // PENDING DESIGN: no row covers a group under Meta's minimum yet.
    ["a group under Meta's minimum", { twoCampaigns: true, pageGroup: GROUP, genreFamily: "dnb", similarTooSmall: true }, "too_small", "Similar skipped: its page group’s audience is under Meta’s minimum, so its share goes to Cold."],
  ] as const) {
    it(`${label}: normally, Cold is 30 + 20 = 50 %; Warm and Hot keep theirs; the line says so`, () => {
      const out = plan(spec);
      assert.equal(out.similarSkip, reason);
      assert.equal(out.tiers.similar, 0);
      assert.deepEqual(splitOf("normally", true, true), { similar: 0, cold: SPLIT_WITH_SIMILAR.normally.cold + SPLIT_WITH_SIMILAR.normally.similar, warm: SPLIT_WITH_SIMILAR.normally.warm, hot: SPLIT_WITH_SIMILAR.normally.hot });
      assert.deepEqual(out.tiers, splitTotal(out.totalMinor, splitOf("normally", true, true))!.tiers);
      assert.equal(similarSkipLine(reason, { code: "X", genre: spec.genreFamily ? "drum & bass" : null }), line);
    });
  }

  it("rechecked each read: a group confirmed later brings Similar back from the next step", () => {
    const built = { totalMinor: 1800, took: [] };
    const before = plan({ twoCampaigns: true, pageGroup: { ...GROUP, confirmed: false }, genreFamily: "dnb" }, { existing: built });
    assert.ok(before.steps.length > 0 && before.steps.every((step) => step.tiers.similar === 0));
    const after = plan({ twoCampaigns: true, pageGroup: GROUP, genreFamily: "dnb" }, { existing: built });
    assert.equal(after.similarSkip, null);
    assert.ok(after.steps[0]!.tiers.similar > 0);
  });
});

describe("the page genres file (Matas, 27 Nov): only rows he confirmed", () => {
  const CSV = [
    "business,page_id,page_name,category,followers,genre_draft,status",
    'XMPL Promotions,1000000001,"Rooftop, ""Sessions""",Club,1200,techno,confirmed',
    "XMPL Promotions,1000000002,Warehouse,Club,900,techno,confirmed",
    "XMPL Promotions,1000000003,Draft page,Club,800,techno,draft",
    "XMPL Promotions,1000000004,Unsure page,Club,700,house_tech,unsure",
    "XMPL Promotions,1000000005,Unknown,Club,600,?,confirmed",
    "XMPL Promotions,1000000006,Mixed,Club,500,no_single_genre,confirmed",
    "Other BM,1000000007,Elsewhere,Club,400,disco,confirmed",
  ].join("\n");

  it("reads quoted names; ignores draft, unsure and \"?\" rows (and no_single_genre); groups by client and genre", () => {
    const rows = parseGenreRows(CSV);
    assert.equal(rows[0]!.pageName, 'Rooftop, "Sessions"');
    assert.equal(CONFIRMED_STATUS, "confirmed");
    assert.deepEqual(confirmedGenreRows(rows).map((row) => row.pageId), ["1000000001", "1000000002", "1000000007"]);
    const { sources, unlinked } = sourcesFromGenreRows(rows, [{ client_id: "c1", business_name: "xmpl promotions " }]);
    assert.deepEqual(unlinked, ["Other BM"]);
    const { plan } = planPageGroups(sources, []);
    assert.deepEqual(plan, [{ clientId: "c1", genreFamily: "techno", pageIds: ["1000000001", "1000000002"], igIds: [], action: "insert" }]);
  });

  it("TC9: a venue's or promoter's Page never joins a group, whatever its row says", () => {
    const rows = parseGenreRows(CSV);
    const venueOrPromoter = new Set(["1000000002"]);
    const { sources, leftOut } = sourcesFromGenreRows(rows, [{ client_id: "c1", business_name: "XMPL Promotions" }], { venueOrPromoter });
    assert.equal(leftOut, 1);
    assert.deepEqual(planPageGroups(sources, [], { venueOrPromoter }).plan[0]!.pageIds, ["1000000001"]);
    // And from the Meta listing too.
    const listing = [
      { client_id: "c1", kind: "facebook_page" as const, id: "1000000001", name: "A", genre_family: "techno", reach: "owned" as const },
      { client_id: "c1", kind: "facebook_page" as const, id: "1000000002", name: "Venue", genre_family: "techno", reach: "owned" as const },
      { client_id: "c1", kind: "facebook_page" as const, id: "1000000009", name: "Mixed", genre_family: "no_single_genre", reach: "owned" as const },
    ];
    assert.deepEqual(planPageGroups(listing, [], { venueOrPromoter }).plan.map((row) => row.pageIds), [["1000000001"]]);
  });

  it("Similar's audiences are 365 days (Matas, 27 Nov), 5 pages an audience", () => {
    const similar = funnelSpecs(SOURCES, { twoCampaigns: true, pageGroup: GROUP, genreFamily: "dnb" }).find((spec) => spec.tier === "similar")!;
    assert.ok(similar.includes.every((aud) => "retentionDays" in aud && aud.retentionDays === 365));
    assert.deepEqual(similar.includes.filter((aud) => aud.kind === "page_fb").map((aud) => ("pageIds" in aud ? aud.pageIds.length : 0)), [5, 1]);
  });
});

describe("Matas, 27 Nov (\"Yes, at the next step\"): the read, the panel and Claude while Similar waits for its step", () => {
  const SHOW = "2026-12-12";
  const confirmed = { ...GROUP, genreFamily: "dnb" };
  const spec = { twoCampaigns: true, pageGroup: confirmed, genreFamily: "dnb" };
  const built = { totalMinor: 2400, took: [] };
  // Built without Similar; the final 2 weeks run (£24.00: Cold holds Similar's 10 %).
  const tiers = { similar: 0, cold: 600, warm: 960, hot: 840 };

  it("the read acts only on a live build without Similar, its group confirmed, on one of its step days, and never in a dry run", () => {
    const row = { event_id: "e", state: "live", mode: "live" as const, meta_campaign_id: "c", progress: { active: true, adSets: { cold: { id: "a", dailyMinor: 600 } } }, build: { wider: {} as never, spec: { twoCampaigns: true }, plan: { steps: [{ day: "2026-12-05" }] } as never } };
    const due = (over: Partial<Parameters<typeof similarStepDue>[0]> = {}) => similarStepDue({ dryRun: false, ruled: true, row: row as never, pageGroup: confirmed, day: "2026-12-05", ...over });
    assert.equal(due(), true);
    assert.equal(due({ day: "2026-12-04" }), false);
    assert.equal(due({ dryRun: true }), false);
    assert.equal(due({ pageGroup: { ...confirmed, confirmed: false } }), false);
    assert.equal(due({ row: { ...row, progress: { ...row.progress, adSets: { ...row.progress.adSets, similar: { id: "s", dailyMinor: 1 } } } } as never }), false);
    assert.equal(due({ row: { ...row, state: "paused" } as never }), false);
  });

  it("the panel: Similar's row says it comes back at the next step, with its £ a day; Cold shows its own plus Similar's", () => {
    const plan = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay: "2026-11-29", showDay: SHOW, announceDay: "2026-09-29", prospecting: [], sources: SOURCES, spec, existing: built, showDailyMinor: 6000 });
    const panel = runningPanel(plan, SOURCES, { showDay: SHOW, today: "2026-11-29", built: { tiers, took: [] }, spec });
    const similar = panel.tiers.find((row) => row.tier === "similar")!;
    assert.equal(similar.skipped, "Similar comes back at the next step, Sat 5 Dec: its £2.40 a day moves back from Cold then.");
    assert.equal(similar.budgetMinor, null);
    const cold = panel.tiers.find((row) => row.tier === "cold")!;
    assert.equal(cold.budgetMinor, 360);
    assert.ok(cold.lines.some((line) => line.text === "Plus £2.40 a day from Similar."));
    const refused = runningPanel(plan, SOURCES, { showDay: SHOW, today: "2026-11-29", built: { tiers, took: [], similarRefused: { day: "2026-11-28", reason: "Its audience is too small for Meta to deliver to." } }, spec });
    assert.equal(refused.tiers.find((row) => row.tier === "similar")!.skipped, "Similar couldn’t be added on Sat 28 Nov: Its audience is too small for Meta to deliver to. Its £2.40 a day stays in Cold.");
  });

  it("Claude: when Similar comes back, or why it couldn't be added", () => {
    assert.equal(similarReturnLine({ nextDay: "2026-12-05", refused: null }), "Similar comes back at the next step, Sat 5 Dec, now its page group is confirmed.");
    assert.equal(similarReturnLine({ nextDay: null, refused: null }), "Similar can’t come back: there’s no step left before the show, so its share stays in Cold.");
    assert.equal(similarReturnLine({ nextDay: "2026-12-05", refused: { day: "2026-11-28", reason: "Its audience is too small." } }), "Similar couldn’t be added on Sat 28 Nov: Its audience is too small. Its share stays in Cold.");
  });
});

describe("design's verdict on #1399 (27 Nov): the rows the code now writes", () => {
  it("names: the Create card's title, audiences and lookalikes (the source audience's name, never a key)", () => {
    assert.equal(createTitle("NX26-RUDIMENTAL"), "NX26-RUDIMENTAL · Wider and NX26-RUDIMENTAL · Retargeting");
    const cold = funnelSpecs(SOURCES, { twoCampaigns: true }).find((spec) => spec.tier === "cold")!;
    const engaged = cold.includes.find((aud) => aud.source === "engaged")! as Exclude<FunnelAudience, { kind: "list" }>;
    assert.equal(funnelAudienceName("NX26-RUDIMENTAL", engaged), "NX26-RUDIMENTAL · Page engagers · 180 days");
    assert.equal(lookalikeName("NX26-RUDIMENTAL", "NX26-RUDIMENTAL · Page engagers · 180 days"), "NX26-RUDIMENTAL · Lookalike 1 % UK · Page engagers · 180 days");
    assert.equal(lookalikeName("NX26-RUDIMENTAL", "Melodic Techno Similar Data"), "NX26-RUDIMENTAL · Lookalike 1 % UK · Melodic Techno Similar Data");
  });

  it("the tier card: only Hot's leave-out is lower-cased (r2), tier names keep their capitals; a step couldn't add Similar reads ochre", () => {
    const row = { tier: "hot", label: "Hot", audiences: [], from: null, skipped: null, leavesOut: "Signed up", frequency: null, budgetMinor: 100, lines: [] } as const;
    assert.equal(cardMeta(row as never), "leaves out signed up");
    assert.equal(cardMeta({ ...row, leavesOut: "Buyers" } as never), "leaves out buyers");
    assert.equal(cardMeta({ ...row, tier: "similar", leavesOut: "Cold · Warm · Hot · buyers" } as never), "leaves out Cold · Warm · Hot · buyers");
    assert.equal(cardMeta({ ...row, tier: "warm", leavesOut: "Hot · signed up" } as never), "leaves out Hot · signed up");
    const plan = planFunnelShow({ code: "X", runDay: "2026-11-29", showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: [], sources: SOURCES, spec: { twoCampaigns: true, pageGroup: GROUP, genreFamily: "dnb" }, existing: { totalMinor: 2400, took: [] }, showDailyMinor: 6000 });
    assert.equal(similarReturnOf(plan, { day: "2026-11-28", reason: "Its audience is too small." }, () => true)?.tone, "ochre");
    assert.equal(similarReturnOf(plan, null, () => true)?.tone, "muted");
    assert.equal(nextGivesBack({ stretch: "normally", date: "Mon 9 Nov", p: 30, x: "3.00", y: "60.00", n: 20 }), "Next: normally from Mon 9 Nov · 30 % · Retargeting down £3.00 a day, Wider’s remaining budget up £60.00 (£3.00 a day × 20 days)");
  });
});

describe("design's second verdict (27 Nov): the Similar step's own refusals are lower-case reasons inside rt.similar.back.failed", () => {
  it("each reads as one sentence on the row and for Claude", () => {
    const plan = planFunnelShow({ code: "X", runDay: "2026-11-29", showDay: "2026-12-12", announceDay: "2026-09-29", prospecting: [], sources: SOURCES, spec: { twoCampaigns: true, pageGroup: GROUP, genreFamily: "dnb" }, existing: { totalMinor: 2400, took: [] }, showDailyMinor: 6000 });
    const rows = { owner: "the show’s owner isn’t known", token: "there’s no Facebook token for the show’s owner", draft: "the build has no draft to record its writes on", error: "the read hit an unexpected error" };
    for (const [key, words] of Object.entries(rows)) {
      const reason = fill(`rt.similar.fail.${key}` as never);
      assert.equal(reason, words);
      assert.equal(similarReturnOf(plan, { day: "2026-11-28", reason }, () => true)?.text, `Similar couldn’t be added on Sat 28 Nov: ${words}. Its £2.40 a day stays in Cold.`);
      assert.equal(similarReturnLine({ nextDay: null, refused: { day: "2026-11-28", reason } }), `Similar couldn’t be added on Sat 28 Nov: ${words}. Its share stays in Cold.`);
    }
  });
});
