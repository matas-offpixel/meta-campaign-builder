/**
 * The retargeting funnel (RF1–RF6, RF8, RF9) on fixtures: the words pinned
 * to the design list, the tiers' includes and leave-outs, RF3's table for
 * every stretch, the money from prospecting (full, short, none), the
 * frequency ceiling, missing access, and RF9's lines for Claude.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { RF_WORDS, WITHDRAWN, fill } from "../funnel-words.ts";
import {
  accessLine,
  capTiers,
  funnelAdSetName,
  funnelCampaignName,
  funnelSpecs,
  funnelTiersMatching,
  RF3,
  SPLIT_WITH_SIMILAR,
  splitTotal,
  stepsAfter,
  stretchOn,
  takeFromProspecting,
  tierAudienceLines,
  tierFromLine,
  type FunnelSources,
  type ProspectingBudget,
} from "../funnel.ts";
import { claudePlanLines, createLines, doneLine, matchedPagesLine, nextLine, planFunnelShow, planHead, shareLine, similarSkipRow, skipLine, skipReason, splitLine, wordsSplit, type FunnelShowPlan, type WiderWords } from "../funnel-plan.ts";
import { planWider } from "../show-campaigns.ts";

const TSV = new URL("./fixtures/words-retargeting-2026-11-27-r2.tsv", import.meta.url);

test("the words: the design list, row for row, character for character (sha 5de297b9…)", () => {
  const raw = readFileSync(TSV);
  assert.equal(createHash("sha256").update(raw).digest("hex"), "5de297b9c054063b04a506b086b5e76f799ada5a7a29add62fac396ffc5db2b2");
  const rows = raw.toString("utf8").split("\n").filter(Boolean).slice(1).map((line) => line.split("\t"));
  assert.equal(rows.length, 156);
  assert.deepEqual(Object.keys(RF_WORDS), rows.map((row) => row[0]));
  for (const [key, , words] of rows) assert.equal(RF_WORDS[key as keyof typeof RF_WORDS], words, key);
});

test("the words: the 10 withdrawn rows stay listed and nothing outside the list uses them", () => {
  assert.equal(WITHDRAWN.size, 10);
  for (const key of WITHDRAWN) assert.ok(key in RF_WORDS, key);
  const dir = new URL("../", import.meta.url);
  const files = ["funnel.ts", "funnel-plan.ts", "funnel-view.ts", "funnel-apply.ts", "plan.ts", "show-campaigns.ts", "runner.ts", "../mcp/tools/retargeting.ts", "../../components/dashboard/events/retargeting-panel.tsx"];
  for (const file of files) {
    const text = readFileSync(new URL(file, dir), "utf8");
    for (const key of WITHDRAWN) assert.ok(!text.includes(`"${key}"`), `${file} uses withdrawn ${key}`);
  }
});

const SHOW = "2026-12-12";
const ANNOUNCE = "2026-09-29";
const dates = { showDay: SHOW, announceDay: ANNOUNCE };

const SOURCES: FunnelSources = {
  pixelId: "px1",
  links: [
    { kind: "ticket", rule: "skiddle.com/e/1", host: "skiddle.com", name: "Skiddle", platform: "skiddle" },
    { kind: "landing", rule: "crqln.com/l/rudimental", host: "crqln.com", name: "crqln.com/l/rudimental", platform: null },
  ],
  accounts: [
    { pageId: "p1", name: "NX Newcastle", platform: "facebook", kind: "promoter", access: true },
    { pageId: "p1", name: "NX Newcastle", platform: "instagram", kind: "promoter", access: true },
    { pageId: "p2", name: "Rudimental", platform: "facebook", kind: "lineup", access: true },
    { pageId: "p3", name: "MC Fenn", platform: "instagram", kind: "lineup", access: false },
    { pageId: "p4", name: "Dawn Ray", platform: "facebook", kind: "lineup", access: false },
  ],
  videos: [
    { pageId: "p1", videoIds: ["v1", "v2"] },
    { pageId: "p3", videoIds: ["v3"] },
  ],
  lists: [
    { metaAudienceId: "sig1", name: "Signups", role: "signups", uploadedAt: "2026-11-01" },
    { metaAudienceId: "sim1", name: "Similar A", role: "similar", uploadedAt: "2026-11-01" },
    { metaAudienceId: "sim2", name: "Similar B", role: "similar", uploadedAt: "2026-11-01" },
    { metaAudienceId: "buy1", name: "Buyers", role: "buyers", uploadedAt: "2026-11-01" },
  ],
};

const BROAD: ProspectingBudget = { id: "as1", kind: "adset", name: "Broad · Advantage+", dailyMinor: 3600, adSets: 1 };
const PROSPECTING: ProspectingBudget[] = [BROAD, { id: "as2", kind: "adset", name: "Interests · drum & bass", dailyMinor: 1400, adSets: 1 }, { id: "as3", kind: "adset", name: "Lookalike 1 %", dailyMinor: 1000, adSets: 1 }];

test("RF1: Meta names", () => {
  assert.equal(funnelCampaignName("NX26-RUDIMENTAL"), "NX26-RUDIMENTAL · Retargeting");
  assert.equal(funnelAdSetName("NX26-RUDIMENTAL", "cold"), "NX26-RUDIMENTAL · Retargeting · Cold");
  assert.equal(funnelAdSetName("NX26-RUDIMENTAL", "warm"), "NX26-RUDIMENTAL · Retargeting · Warm");
  assert.equal(funnelAdSetName("NX26-RUDIMENTAL", "hot"), "NX26-RUDIMENTAL · Retargeting · Hot");
});

test("RF2: each tier's includes, one window per source, and its leave-outs", () => {
  const specs = funnelSpecs(SOURCES);
  assert.deepEqual(specs.map((spec) => spec.tier), ["cold", "warm", "hot"]);
  const [cold, warm, hot] = specs;
  const windows = (spec: typeof cold) => spec!.includes.map((aud) => `${aud.source}:${"retentionDays" in aud ? aud.retentionDays : "all"}${aud.kind === "video" ? `:${aud.threshold}` : ""}`);
  assert.deepEqual(windows(cold), ["video75:180:75", "engaged:180", "engaged:180", "followers:all", "followers:all"]);
  assert.deepEqual(windows(warm), ["visitors:60", "engaged:60", "engaged:60", "video95:60:95"]);
  assert.deepEqual(windows(hot), ["ticket:30", "checkout:30", "registrations:180", "signups:all", "engaged:30", "engaged:30", "similar:all", "similar:all"]);
  // Leave-outs: every tier to its right, and buyers.
  const keys = (list: { key: string }[]) => new Set(list.map((aud) => aud.key));
  const hotKeys = keys(hot!.includes);
  const warmKeys = keys(warm!.includes);
  assert.deepEqual(keys(hot!.excludes), new Set(["list:buy1"]));
  assert.deepEqual(keys(warm!.excludes), new Set([...hotKeys, "list:buy1"]));
  assert.deepEqual(keys(cold!.excludes), new Set([...warmKeys, ...hotKeys, "list:buy1"]));
  // RF6: no account without access is in any source (MC Fenn's videos, Dawn Ray's page).
  const pageIds = specs.flatMap((spec) => spec.includes.flatMap((aud) => ("pageIds" in aud ? aud.pageIds : "pageId" in aud ? [aud.pageId] : [])));
  assert.ok(!pageIds.includes("p3") && !pageIds.includes("p4"));
  // Nobody is in two tiers.
  for (const memberOf of [new Set(["rf:visitors:60", "rf:ticket:30"]), new Set([cold!.includes[0]!.key, "rf:visitors:60"]), new Set([cold!.includes[0]!.key])]) {
    assert.ok(funnelTiersMatching(specs, memberOf).length <= 1);
  }
  assert.deepEqual(funnelTiersMatching(specs, new Set([cold!.includes[0]!.key, "list:buy1"])), []);
});

test("TC9: the tier rows' words — no per-source account counts; one muted line says whose Pages, with its one-form", () => {
  const specs = funnelSpecs(SOURCES, { twoCampaigns: true });
  const [cold, warm, hot] = specs;
  assert.deepEqual(tierAudienceLines(cold), ["Video viewers 75 % · 180 days", "Page and Instagram engagers · 180 days", "Followers · all time"]);
  assert.deepEqual(tierAudienceLines(warm), ["Show page and ticket-link visitors · 60 days", "Page and Instagram engagers · 60 days", "Video viewers 95 % · 60 days", "2 similar lists"]);
  assert.deepEqual(tierAudienceLines(hot), ["Ticket-link visitors · 30 days", "Checkout starters", "Registrations · signup list", "Page and Instagram engagers · 30 days"]);
  assert.equal(tierFromLine(cold, SOURCES), "From the venue’s and promoter’s Pages and the lineup artists: 3 accounts");
  assert.equal(tierFromLine(cold, { ...SOURCES, accounts: SOURCES.accounts.slice(0, 1) }), "From the venue’s and promoter’s Pages and the lineup artists: 1 account");
  // TC4: similar lists move to Warm (one-form), Hot no longer lists them.
  assert.deepEqual(tierAudienceLines(funnelSpecs({ ...SOURCES, lists: SOURCES.lists.slice(0, 2) }, { twoCampaigns: true })[1]).at(-1), "1 similar list");
});

test("TC9: the venue's and promoter's Pages join Cold, Warm and Hot with exactly their sources and windows", () => {
  const sources: FunnelSources = {
    ...SOURCES,
    accounts: [
      { pageId: "v1", name: "NX Newcastle", platform: "facebook", kind: "venue", access: true },
      { pageId: "b1", name: "NX LOVES", platform: "facebook", kind: "promoter", access: true },
      { pageId: "a1", name: "Rudimental", platform: "facebook", kind: "lineup", access: true },
    ],
    videos: [{ pageId: "v1", videoIds: ["vv"] }],
  };
  const specs = funnelSpecs(sources, { twoCampaigns: true });
  const pagesOf = (tier: string, source: string) => specs.find((spec) => spec.tier === tier)!.includes.filter((aud) => aud.source === source).flatMap((aud) => ("pageIds" in aud ? aud.pageIds : "pageId" in aud ? [aud.pageId] : []));
  const days = (tier: string, source: string) => specs.find((spec) => spec.tier === tier)!.includes.filter((aud) => aud.source === source).map((aud) => ("retentionDays" in aud ? aud.retentionDays : "all"));
  for (const page of ["v1", "b1", "a1"]) {
    assert.ok(pagesOf("cold", "followers").includes(page), `followers ${page}`);
    assert.ok(pagesOf("cold", "engaged").includes(page), `cold engaged ${page}`);
    assert.ok(pagesOf("warm", "engaged").includes(page), `warm engaged ${page}`);
    assert.ok(pagesOf("hot", "engaged").includes(page), `hot engaged ${page}`);
  }
  assert.ok(pagesOf("cold", "video75").includes("v1") && pagesOf("warm", "video95").includes("v1"));
  assert.deepEqual([...new Set(days("cold", "engaged"))], [180]);
  assert.deepEqual([...new Set(days("cold", "video75"))], [180]);
  assert.deepEqual([...new Set(days("cold", "followers"))], ["all"]);
  assert.deepEqual([...new Set(days("warm", "engaged"))], [60]);
  assert.deepEqual([...new Set(days("warm", "video95"))], [60]);
  assert.deepEqual([...new Set(days("hot", "engaged"))], [30]);
  // Never in a genre group: Similar reads the page group only.
  const group = { id: "g", genreFamily: "dnb", pageIds: ["s1", "s2"], igIds: [], confirmed: true };
  const similar = funnelSpecs(sources, { twoCampaigns: true, pageGroup: group, genreFamily: "dnb" }).find((spec) => spec.tier === "similar")!;
  assert.deepEqual(similar.includes.flatMap((aud) => ("pageIds" in aud ? aud.pageIds : [])), ["s1", "s2"]);
  assert.deepEqual(matchedPagesLine({ venue: "NX Newcastle", brands: ["NX LOVES", "NX In Session"], artists: ["Rudimental", "MC Fenn", "Dawn Ray"] }), "Matched Pages · venue NX Newcastle · promoter NX LOVES, NX In Session · lineup Rudimental, MC Fenn, Dawn Ray. If one is wrong, Matas corrects it before the build.");
  assert.deepEqual(matchedPagesLine({ venue: null, brands: [], artists: ["XMPL Artist"] }), "Matched Pages · venue not matched · promoter not matched · lineup XMPL Artist. If one is wrong, Matas corrects it before the build.");
});

test("RF3 (one campaign, the fallback): the share and split for every stretch, overlaps taking the higher", () => {
  const cases: [string, keyof typeof RF3][] = [
    ["2026-10-01", "announce"], // announce, inside a payday window: payday only lifts inside "normally"
    ["2026-10-20", "normally"],
    ["2026-10-29", "payday"],
    ["2026-11-12", "final_month"], // final month and payday at 35 %: the run-in names it
    ["2026-11-28", "final_2w"],
    ["2026-12-05", "final_week"],
    ["2026-12-12", "final_week"],
  ];
  for (const [day, stretch] of cases) assert.equal(stretchOn(day, dates), stretch, day);
  assert.equal(stretchOn("2026-11-20", { showDay: SHOW, announceDay: "2026-11-15" }), "final_month");
  const expected = { announce: [25, 60, 30, 10], normally: [30, 40, 40, 20], payday: [35, 30, 45, 25], final_month: [35, 30, 45, 25], final_2w: [40, 20, 45, 35], final_week: [50, 10, 40, 50] } as const;
  for (const [stretch, [share, c, w, h]] of Object.entries(expected)) {
    const rule = RF3[stretch as keyof typeof RF3];
    assert.deepEqual([rule.share, rule.split.cold, rule.split.warm, rule.split.hot], [share, c, w, h], stretch);
  }
  assert.deepEqual(stepsAfter("2026-10-01", dates).map((step) => `${step.day} ${step.stretch}`), ["2026-10-13 normally", "2026-10-29 payday", "2026-11-28 final_2w", "2026-12-05 final_week"]);
});

const GROUP = { id: "g", genreFamily: "dnb", pageIds: ["s1", "s2", "s3", "s4"], igIds: [], confirmed: true };
const TWO = { twoCampaigns: true, pageGroup: GROUP, genreFamily: "dnb" };

test("TC5: the plan matches the confirmed split on every stretch, the shares RF3's", () => {
  const days: Record<string, string> = { announce: "2026-10-01", normally: "2026-10-20", payday: "2026-10-29", final_month: "2026-11-12", final_2w: "2026-11-28", final_week: "2026-12-05" };
  const expected = { announce: [25, 25, 45, 20, 10], normally: [30, 20, 30, 35, 15], payday: [35, 15, 25, 35, 25], final_month: [35, 15, 25, 35, 25], final_2w: [40, 10, 15, 40, 35], final_week: [50, 5, 10, 35, 50] } as const;
  for (const [stretch, [share, sm, c, w, h]] of Object.entries(expected)) {
    assert.deepEqual(SPLIT_WITH_SIMILAR[stretch as keyof typeof SPLIT_WITH_SIMILAR], { similar: sm, cold: c, warm: w, hot: h }, stretch);
    const plan = planFunnelShow({ code: "X", runDay: days[stretch]!, showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES, spec: TWO });
    assert.equal(plan.stretch, stretch);
    assert.equal(plan.share, share, stretch);
    const total = (6000 * share) / 100;
    assert.equal(plan.totalMinor, total, stretch);
    assert.deepEqual(plan.tiers, { similar: (total * sm) / 100, cold: (total * c) / 100, warm: (total * w) / 100, hot: (total * h) / 100 }, stretch);
    // Two campaigns: no prospecting ad set is lowered; Wider holds the rest.
    assert.deepEqual(plan.take.from, []);
  }
});

test("TC3: no group or no genre skips Similar, and its share goes to Cold, exactly; the line shows it there", () => {
  for (const spec of [{ twoCampaigns: true, pageGroup: null, genreFamily: "dnb" }, { twoCampaigns: true, pageGroup: null, genreFamily: null }, { twoCampaigns: true, pageGroup: { ...GROUP, confirmed: false }, genreFamily: "dnb" }, { twoCampaigns: true, pageGroup: GROUP, genreFamily: "dnb", similarTooSmall: true }]) {
    const plan = planFunnelShow({ code: "XMPL-ATTIC", runDay: "2026-11-26", showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES, spec });
    assert.deepEqual(plan.tiers, { similar: 0, cold: 315 + 525, warm: 735, hot: 525 }, JSON.stringify(spec));
    // Matas, 27 Nov: the line shows the budgets as they are — Similar £0.00, Cold holding its share.
    assert.deepEqual(wordsSplit(plan), plan.tiers);
    assert.ok(!plan.specs.some((row) => row.tier === "similar"));
  }
  assert.equal(similarSkipRow("no_group", { code: "NX26-RUDIMENTAL", genre: "drum & bass", minor: 315 }), "Similar skipped: there’s no drum & bass page group yet, so its £3.15 a day goes to Cold.");
  assert.equal(similarSkipRow("no_genre", { code: "XMPL-ATTIC", genre: null, minor: 315 }), "Similar skipped: XMPL-ATTIC has no genre, so its £3.15 a day goes to Cold.");
  // At most 5 pages an audience: 7 pages are two audiences, and the row says so.
  const seven = funnelSpecs(SOURCES, { twoCampaigns: true, pageGroup: { ...GROUP, pageIds: ["1", "2", "3", "4", "5", "6", "7"] }, genreFamily: "dnb" }).find((row) => row.tier === "similar")!;
  assert.deepEqual(seven.includes.map((aud) => ("pageIds" in aud ? aud.pageIds.length : 0)), [5, 2]);
  assert.deepEqual(seven.includes.map((aud) => ("retentionDays" in aud ? aud.retentionDays : null)), [365, 365]);
  assert.deepEqual(tierAudienceLines(seven, { genreLabel: "drum & bass" }), ["Engagers of the drum & bass page group · 7 pages · 365 days · 2 audiences, 5 pages each at most"]);
});

/** Wider as plan.ts sizes it, for the words. */
function widerOf(plan: FunnelShowPlan, runDay: string, endDay = SHOW): WiderWords {
  const w = planWider({ showDailyMinor: plan.showDailyMinor, retargetingMinor: plan.totalMinor, runDay, showDay: SHOW, endDay, adSets: 4, steps: plan.steps.filter((step) => step.day <= endDay) });
  return { lifetimeMinor: w.lifetimeMinor, dailyMinor: w.dailyMinor, daysLeft: w.daysLeft, endDay, sets: ["Broad", "Similar pages", "Lookalikes"], steps: w.steps };
}

test("TC1 / TW-A: the Create line names both campaigns, Wider first, then the split, the show's total and the next step", () => {
  const plan = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay: "2026-11-26", showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES, spec: TWO });
  const wider = widerOf(plan, "2026-11-26");
  assert.deepEqual(createLines(plan, wider, false), {
    lines: [
      "Wider · £663.00 lifetime to Sat 12 Dec (17 days, £39.00 a day) · Advantage+ audience · Broad, Similar pages, Lookalikes",
      "Retargeting · £21.00 a day · 35 % of the show’s daily spend · final month · Advantage+ off",
      "Similar £3.15 · Cold £5.25 · Warm £7.35 · Hot £5.25",
      "The show’s daily spend stays at £60.00: £39.00 Wider and £21.00 Retargeting.",
    ],
    muted: ["Location expansion off on every ad set."],
  });
  assert.equal(nextLine(plan, SHOW, wider), "Next: final 2 weeks from Sat 28 Nov · 40 % · Retargeting up £3.00 a day, Wider’s remaining budget down £45.00 (£3.00 a day × 15 days)");
  assert.equal(shareLine(plan), "£21.00 a day · 35 % of the show’s daily spend · final month");
  assert.equal(splitLine(plan.tiers), "Similar £3.15 · Cold £5.25 · Warm £7.35 · Hot £5.25");
  const last = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay: "2026-12-05", showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES, spec: TWO });
  assert.equal(nextLine(last, SHOW, widerOf(last, "2026-12-05")), "Last stretch: the show is Sat 12 Dec.");
});

test("TC6: each step lowers Wider's lifetime by the step × days left, never under £1.00 a day per Wider ad set", () => {
  const plan = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay: "2026-11-26", showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES, spec: TWO });
  const w = planWider({ showDailyMinor: 6000, retargetingMinor: plan.totalMinor, runDay: "2026-11-26", showDay: SHOW, adSets: 4, steps: plan.steps });
  assert.deepEqual(w.steps.map((step) => [step.day, step.beforeMinor, step.afterMinor, step.givenDailyMinor, step.atFloor]), [
    ["2026-11-28", 66300, 66300 - 300 * 15, 300, false],
    ["2026-12-05", 66300 - 4500, 66300 - 4500 - 600 * 8, 600, false],
  ]);
  // The floor: £44.00 left over 4 days with four ad sets keeps £16.00, so a £9.00 step gives £7.00.
  const tight = planWider({ showDailyMinor: 2000, retargetingMinor: 900, runDay: "2026-11-27", showDay: "2026-11-30", adSets: 4, steps: [{ day: "2026-11-27", totalMinor: 2000 }] });
  assert.equal(tight.lifetimeMinor, 4400);
  assert.deepEqual([tight.steps[0]!.wantDailyMinor, tight.steps[0]!.givenDailyMinor, tight.steps[0]!.atFloor], [1100, 700, true]);
  const remaining = tight.steps[0]!.afterMinor;
  assert.ok(remaining >= 100 * 4 * 4);
});

test("TC7: a presale show — sign-ups left out of both campaigns, Hot is sign-up page visitors not signed up, Warm show page visitors", () => {
  const presale: FunnelSources = { ...SOURCES, links: SOURCES.links.filter((link) => link.kind === "landing") };
  const specs = funnelSpecs(presale, { ...TWO, presale: true });
  const hot = specs.find((spec) => spec.tier === "hot")!;
  const warm = specs.find((spec) => spec.tier === "warm")!;
  assert.deepEqual(tierAudienceLines(hot, { presale: true }), ["Sign-up page visitors · 30 days · not signed up", "Page and Instagram engagers · 30 days"]);
  assert.equal(tierAudienceLines(warm, { presale: true })[0], "Show page visitors · 60 days");
  for (const spec of specs) {
    assert.ok(spec.excludes.some((aud) => aud.source === "registrations"), `${spec.tier} leaves out the registrants`);
    assert.ok(spec.excludes.some((aud) => aud.key === "list:sig1"), `${spec.tier} leaves out the signups list`);
    assert.ok(!spec.includes.some((aud) => aud.source === "registrations" || aud.source === "signups"), `${spec.tier} doesn't include sign-ups`);
  }
  const plan = planFunnelShow({ code: "XMPL-CELLAR", runDay: "2026-11-26", showDay: "2027-02-13", announceDay: "2026-11-23", prospecting: [{ id: "p", kind: "adset", name: "Broad", dailyMinor: 4000, adSets: 1 }], sources: presale, spec: { ...TWO, presale: true } });
  const wider = widerOf(plan, "2026-11-26", "2026-12-04");
  assert.deepEqual(createLines(plan, wider, true).lines, [
    "Wider · £270.00 lifetime to Fri 4 Dec (9 days, £30.00 a day) · Advantage+ audience · Broad, Similar pages, Lookalikes",
    "Retargeting · £10.00 a day · 25 % of the show’s daily spend · announce · Advantage+ off",
    "Similar £2.50 · Cold £4.50 · Warm £2.00 · Hot £1.00",
    "The show’s daily spend stays at £40.00: £30.00 Wider and £10.00 Retargeting.",
    "Presale: signing up is the goal, so sign-ups are left out of both campaigns and get the presale reminder and WhatsApp invite instead.",
  ]);
  assert.equal(nextLine(plan, "2027-02-13", wider, { onSaleDay: "2026-12-04" }), "On sale from Fri 4 Dec: sign-ups move into Hot, and buying becomes the goal.");
});

test("RF4 (one campaign, the fallback): a full take leaves the show's total the same; no ad set under £1.00; a campaign budget keeps £1.00 an ad set", () => {
  const take = takeFromProspecting(PROSPECTING, 4500);
  assert.equal(take.takenMinor, 4500);
  assert.deepEqual(take.from.map((row) => [row.id, row.beforeMinor, row.afterMinor]), [["as1", 3600, 100], ["as2", 1400, 400]]);
  const cbo = takeFromProspecting([{ id: "c1", kind: "campaign", name: "Prospecting", dailyMinor: 1000, adSets: 4 }], 900);
  assert.deepEqual([cbo.takenMinor, cbo.from[0]!.afterMinor, cbo.short], [600, 400, true]);
  const plan = planFunnelShow({ code: "X", runDay: "2026-11-26", showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES });
  const after = PROSPECTING.reduce((sum, row) => sum + (plan.take.from.find((line) => line.id === row.id)?.afterMinor ?? row.dailyMinor), 0);
  assert.equal(after + plan.totalMinor, plan.showDailyMinor);
});

test("RF8: a tier under £1.00 gets £1.00 from the largest other tier", () => {
  assert.deepEqual(splitTotal(500, RF3.announce.split), { tiers: { similar: 0, cold: 250, warm: 150, hot: 100 }, atFloor: ["hot"] });
  assert.equal(splitTotal(299, RF3.announce.split), null);
});

test("RF5 (RF-B): Hot capped, its extra to Warm; Cold capped, its extra back to Broad; lifts at 3 or under", () => {
  const shares = { similar: 0, cold: 480, warm: 1080, hot: 840 };
  const took = [{ id: "as1", kind: "adset" as const, name: "Broad · Advantage+", beforeMinor: 3600, afterMinor: 1200 }];
  const out = capTiers(shares, { cold: { frequency: 3.2, spendMinor: 2450 }, warm: { frequency: 2.1, spendMinor: 7000 }, hot: { frequency: 3.6, spendMinor: 3640 } }, took);
  assert.deepEqual(out.budgets, { similar: 0, cold: 350, warm: 1400, hot: 520 });
  assert.deepEqual(out.caps.hot, { capMinor: 520, frequency: 3.6, extraMinor: 320, to: "warm" });
  assert.deepEqual(out.plus.warm, [{ from: "hot", minor: 320 }]);
  assert.equal(out.caps.cold?.to, "prospecting");
  assert.deepEqual(out.back, [{ id: "as1", name: "Broad · Advantage+", minor: 130 }]);
  assert.equal(fill("rt.cap", { c: "5.20", f: "3.6", x: "3.20", to: "Warm" }), "Capped at £5.20 a day: frequency 3.6 over 7 days. £3.20 a day went to Warm.");
  const lifted = capTiers(shares, { hot: { frequency: 3, spendMinor: 100 } }, took);
  assert.deepEqual(lifted.budgets, shares);
  assert.deepEqual(lifted.caps, {});
});

test("RF6 (RF-C): missing access is said once, with the one-form, and every tier still builds", () => {
  assert.equal(accessLine(SOURCES.accounts), "No advertiser access to 2 accounts, so their followers, engagers and video viewers aren’t in any tier: MC Fenn (Instagram) · Dawn Ray (Facebook). Ask each artist’s team for advertiser access.");
  assert.equal(accessLine(SOURCES.accounts.filter((row) => row.pageId !== "p4")), "No advertiser access to MC Fenn (Instagram), so its followers, engagers and video viewers aren’t in any tier. Ask the artist’s team for advertiser access.");
  assert.equal(accessLine(SOURCES.accounts.filter((row) => row.access !== false)), null);
  const plan = planFunnelShow({ code: "X", runDay: "2026-11-26", showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES, spec: TWO });
  assert.deepEqual(plan.specs.map((spec) => spec.tier), ["similar", "cold", "warm", "hot"]);
  assert.equal(plan.audiences.missingAccess, 2);
});

test("TC8 (TW-D): the plan's lines for Claude, the head, the skips and the done line", () => {
  const plan = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay: "2026-11-26", showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES, spec: TWO });
  const lines = claudePlanLines(plan, SOURCES, { wider: widerOf(plan, "2026-11-26"), pages: { venue: "NX Newcastle", brands: ["NX LOVES", "NX In Session"], artists: ["Rudimental", "MC Fenn", "Dawn Ray"] } });
  assert.match(lines[0]!, /^NX26-RUDIMENTAL · final month · 35 %: Wider £663\.00 lifetime \(£39\.00 a day\) · Retargeting £21\.00 a day: Similar £3\.15 · Cold £5\.25 · Warm £7\.35 · Hot £5\.25 · audiences 0 made, \d+ to make, 2 missing access$/);
  assert.equal(lines[1], "Matched Pages · venue NX Newcastle · promoter NX LOVES, NX In Session · lineup Rudimental, MC Fenn, Dawn Ray. If one is wrong, Matas corrects it before the build.");
  assert.equal(lines[2], "Needs advertiser access: MC Fenn (Instagram) · Dawn Ray (Facebook).");
  assert.equal(lines[3], "Then final 2 weeks from Sat 28 Nov at 40 %, as a scheduled change.");
  const attic = planFunnelShow({ code: "XMPL-ATTIC", runDay: "2026-11-26", showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES, spec: { twoCampaigns: true, genreFamily: null } });
  const atticLines = claudePlanLines(attic, SOURCES, { wider: widerOf(attic, "2026-11-26"), existing: [{ name: "XMPL-ATTIC · Prospecting", action: "fold" }, { name: "XMPL-ATTIC · Lineup", action: "pause" }, { name: "XMPL-ATTIC · Brand", action: "keep" }] });
  assert.match(atticLines[0]!, /Similar £0\.00 · Cold £8\.40 ·/);
  assert.ok(atticLines.includes("Similar skipped: XMPL-ATTIC has no genre, so its share goes to Cold."));
  assert.ok(atticLines.includes("Existing prospecting: XMPL-ATTIC · Prospecting · fold into Wider, once Matas says yes."));
  assert.ok(atticLines.includes("Existing prospecting: XMPL-ATTIC · Lineup · pause, once Matas says yes."));
  assert.ok(atticLines.includes("Existing prospecting: XMPL-ATTIC · Brand · keep."));
  assert.equal(planHead({ shows: 14, build: 11, skipped: 3 }), "14 shows on sale: 11 to build, 3 skipped.");
  assert.equal(skipLine("XMPL-ATTIC", "no_link"), "XMPL-ATTIC · skipped: it has no ticket link.");
  assert.equal(skipLine("XMPL-DOCKS", "soon"), "XMPL-DOCKS · skipped: the show is within 3 days.");
  assert.equal(skipLine("XMPL-ROOF", "built"), "XMPL-ROOF · skipped: it already has a Wider or Retargeting campaign.");
  assert.equal(doneLine({ code: "NX26-RUDIMENTAL", live: false, adSets: 8, made: 6 }), "Done: NX26-RUDIMENTAL · Wider and Retargeting created paused · 8 ad sets · 6 audiences made.");
  assert.equal(doneLine({ code: "NX26-RUDIMENTAL", live: true, adSets: 8, made: 6 }), "Done: NX26-RUDIMENTAL · Wider and Retargeting created live · 8 ad sets · 6 audiences made.");
  assert.equal(skipReason({ archived: false, built: false, runDay: "2026-12-10", showDay: SHOW, pixelId: "px1", hasTicketLink: true, plan }), "soon");
});
