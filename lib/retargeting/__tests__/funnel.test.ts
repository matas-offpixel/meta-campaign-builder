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

import { RF_WORDS, fill } from "../funnel-words.ts";
import {
  accessLine,
  capTiers,
  funnelAdSetName,
  funnelCampaignName,
  funnelSpecs,
  funnelTiersMatching,
  RF3,
  splitTotal,
  stepsAfter,
  stretchOn,
  takeFromProspecting,
  tierAudienceLines,
  type FunnelSources,
  type ProspectingBudget,
} from "../funnel.ts";
import { claudePlanLines, doneLine, nextLine, planFunnelShow, planHead, shareLine, skipLine, skipReason, splitLine, takeLines } from "../funnel-plan.ts";

const TSV = new URL("./fixtures/words-retargeting-2026-11-26.tsv", import.meta.url);

test("the words: the design list, row for row, character for character (sha fcbd2820…)", () => {
  const raw = readFileSync(TSV);
  assert.equal(createHash("sha256").update(raw).digest("hex"), "fcbd282068d78ab9a9810e52c79c568d641b9581ba34cad830e896f9f886546c");
  const rows = raw.toString("utf8").split("\n").filter(Boolean).slice(1).map((line) => line.split("\t"));
  assert.equal(rows.length, 65);
  assert.deepEqual(Object.keys(RF_WORDS), rows.map((row) => row[0]));
  for (const [key, , words] of rows) assert.equal(RF_WORDS[key as keyof typeof RF_WORDS], words, key);
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

test("RF2: the tier rows' words", () => {
  const specs = funnelSpecs(SOURCES);
  assert.deepEqual(tierAudienceLines(specs[0], SOURCES), ["Video viewers 75 % · 180 days · 1 account", "Page and Instagram engagers · 180 days · 3 accounts", "Followers · all time · 3 accounts"]);
  assert.deepEqual(tierAudienceLines(specs[1], SOURCES), ["Show page and ticket-link visitors · 60 days", "Page and Instagram engagers · 60 days · 3 accounts", "Video viewers 95 % · 60 days · 1 account"]);
  assert.deepEqual(tierAudienceLines(specs[2], SOURCES), ["Ticket-link visitors · 30 days", "Checkout starters", "Registrations · signup list", "Page and Instagram engagers · 30 days · 3 accounts", "2 similar lists"]);
});

test("RF3: the share and split for every stretch, overlaps taking the higher", () => {
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
  // A show announced inside its final month: the higher wins.
  assert.equal(stretchOn("2026-11-20", { showDay: SHOW, announceDay: "2026-11-15" }), "final_month");
  const expected = { announce: [25, 60, 30, 10], normally: [30, 40, 40, 20], payday: [35, 30, 45, 25], final_month: [35, 30, 45, 25], final_2w: [40, 20, 45, 35], final_week: [50, 10, 40, 50] } as const;
  for (const [stretch, [share, c, w, h]] of Object.entries(expected)) {
    const rule = RF3[stretch as keyof typeof RF3];
    assert.deepEqual([rule.share, rule.split.cold, rule.split.warm, rule.split.hot], [share, c, w, h], stretch);
    const day = cases.find((row) => row[1] === stretch)![0];
    const plan = planFunnelShow({ code: "X", runDay: day, showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES });
    assert.equal(plan.share, share, stretch);
    assert.equal(plan.targetMinor, 6000 * share / 100);
    assert.equal(plan.totalMinor, plan.tiers.cold + plan.tiers.warm + plan.tiers.hot);
  }
  // Every later step is a change of rule; payday into final month (the same rule) is none.
  assert.deepEqual(stepsAfter("2026-10-01", dates).map((step) => `${step.day} ${step.stretch}`), ["2026-10-13 normally", "2026-10-29 payday", "2026-11-28 final_2w", "2026-12-05 final_week"]);
});

test("RF-A: the Create line at announce and in the final week (the frames' figures)", () => {
  const announce = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay: "2026-10-01", showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES });
  assert.equal(shareLine(announce), "£15.00 a day · 25 % of the show’s daily spend · announce");
  assert.equal(splitLine(announce.tiers), "Cold £9.00 · Warm £4.50 · Hot £1.50");
  assert.deepEqual(takeLines(announce), ["Takes £15.00 a day from prospecting, largest first: Broad · Advantage+ £36.00 → £21.00. The show stays at £60.00 a day."]);
  assert.equal(nextLine(announce, SHOW), "Next: normally from Tue 13 Oct · 30 % · moves £3.00 a day from Broad · Advantage+ to retargeting");
  const last = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay: "2026-12-05", showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES });
  assert.equal(shareLine(last), "£30.00 a day · 50 % of the show’s daily spend · final week");
  assert.equal(splitLine(last.tiers), "Cold £3.00 · Warm £12.00 · Hot £15.00");
  assert.deepEqual(takeLines(last), ["Takes £30.00 a day from prospecting, largest first: Broad · Advantage+ £36.00 → £6.00. The show stays at £60.00 a day."]);
  assert.equal(nextLine(last, SHOW), "Last stretch: the show is Sat 12 Dec.");
});

test("RF4: a full take leaves the show's total the same; no ad set under £1.00; a campaign budget keeps £1.00 an ad set", () => {
  const take = takeFromProspecting(PROSPECTING, 4500);
  assert.equal(take.takenMinor, 4500);
  assert.deepEqual(take.from.map((row) => [row.id, row.beforeMinor, row.afterMinor]), [["as1", 3600, 100], ["as2", 1400, 400]]);
  const cbo = takeFromProspecting([{ id: "c1", kind: "campaign", name: "Prospecting", dailyMinor: 1000, adSets: 4 }], 900);
  assert.deepEqual([cbo.takenMinor, cbo.from[0]!.afterMinor, cbo.short], [600, 400, true]);
  const plan = planFunnelShow({ code: "X", runDay: "2026-11-26", showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES });
  const after = PROSPECTING.reduce((sum, row) => sum + (plan.take.from.find((line) => line.id === row.id)?.afterMinor ?? row.dailyMinor), 0);
  assert.equal(after + plan.totalMinor, plan.showDailyMinor);
});

test("RF4: short prospecting takes what's there and says so; nothing to give says so and has no Create", () => {
  const roof: ProspectingBudget[] = [
    { id: "b1", kind: "adset", name: "Broad · Advantage+", dailyMinor: 500, adSets: 1 },
    { id: "b2", kind: "adset", name: "Lookalike 1 %", dailyMinor: 300, adSets: 1 },
    { id: "b3", kind: "adset", name: "Interests", dailyMinor: 200, adSets: 1 },
    { id: "b4", kind: "campaign", name: "Brand", dailyMinor: 3000, adSets: 30 },
  ];
  const plan = planFunnelShow({ code: "XMPL-ROOF", runDay: "2026-10-01", showDay: SHOW, announceDay: ANNOUNCE, prospecting: roof, sources: SOURCES });
  assert.equal(shareLine(plan), "£10.00 a day · 25 % of the show’s daily spend · announce");
  assert.deepEqual(takeLines(plan), [
    "Takes £7.00 a day from prospecting, largest first: Broad · Advantage+ £5.00 → £1.00 · Lookalike 1 % £3.00 → £1.00 · Interests £2.00 → £1.00. The show stays at £40.00 a day.",
    "Prospecting can give £7.00 of the £10.00 without going under £1.00 an ad set, so retargeting starts at £7.00 a day.",
  ]);
  assert.equal(plan.totalMinor, 700);
  assert.deepEqual(plan.tiers, { similar: 0, cold: 390, warm: 210, hot: 100 });
  assert.deepEqual(plan.atFloor, ["hot"]);
  assert.ok(claudePlanLines(plan, SOURCES).includes("Prospecting can give £7.00 of the £10.00."));
  const none = planFunnelShow({ code: "XMPL-NONE", runDay: "2026-10-01", showDay: SHOW, announceDay: ANNOUNCE, prospecting: [{ id: "n1", kind: "adset", name: "Broad", dailyMinor: 100, adSets: 1 }], sources: SOURCES });
  assert.equal(none.noMoney, true);
  assert.deepEqual(takeLines(none), ["Prospecting has nothing above £1.00 an ad set to give, so there’s no money for retargeting. Raise the show’s budget first."]);
  assert.equal(skipReason({ archived: false, built: false, runDay: "2026-10-01", showDay: SHOW, pixelId: "px1", hasTicketLink: true, plan: none }), "no_money");
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
  // 3.0 is not over the ceiling.
  const lifted = capTiers(shares, { hot: { frequency: 3, spendMinor: 100 } }, took);
  assert.deepEqual(lifted.budgets, shares);
  assert.deepEqual(lifted.caps, {});
});

test("RF6 (RF-C): missing access is said once, with the one-form, and every tier still builds", () => {
  assert.equal(accessLine(SOURCES.accounts), "No advertiser access to 2 accounts, so their followers, engagers and video viewers aren’t in any tier: MC Fenn (Instagram) · Dawn Ray (Facebook). Ask each artist’s team for advertiser access.");
  assert.equal(accessLine(SOURCES.accounts.filter((row) => row.pageId !== "p4")), "No advertiser access to MC Fenn (Instagram), so its followers, engagers and video viewers aren’t in any tier. Ask the artist’s team for advertiser access.");
  assert.equal(accessLine(SOURCES.accounts.filter((row) => row.access !== false)), null);
  const plan = planFunnelShow({ code: "X", runDay: "2026-11-26", showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES });
  assert.deepEqual(plan.specs.map((spec) => spec.tier), ["cold", "warm", "hot"]);
  assert.equal(plan.audiences.missingAccess, 2);
});

test("RF9 (RF-E): the plan's lines for Claude, the head, the skips and the done line", () => {
  const plan = planFunnelShow({ code: "NX26-RUDIMENTAL", runDay: "2026-11-26", showDay: SHOW, announceDay: ANNOUNCE, prospecting: PROSPECTING, sources: SOURCES, made: new Set(["rf:visitors:60", "rf:ticket:30", "rf:checkout:30", "rf:registrations:180"]) });
  const lines = claudePlanLines(plan, SOURCES);
  assert.match(lines[0]!, /^NX26-RUDIMENTAL · final month · 35 % · £21\.00 a day: Cold £6\.30 · Warm £9\.45 · Hot £5\.25 · from Broad · Advantage\+ £36\.00 → £15\.00 · audiences 4 made, \d+ to make, 2 missing access$/);
  assert.equal(lines[1], "Needs advertiser access: MC Fenn (Instagram) · Dawn Ray (Facebook).");
  assert.equal(lines[2], "Then final 2 weeks from Sat 28 Nov at 40 %, as a scheduled change.");
  assert.equal(planHead({ shows: 14, build: 11, skipped: 3 }), "14 shows on sale: 11 to build, 3 skipped.");
  assert.equal(skipLine("XMPL-ATTIC", "no_link"), "XMPL-ATTIC · skipped: it has no ticket link.");
  assert.equal(skipLine("XMPL-DOCKS", "soon"), "XMPL-DOCKS · skipped: the show is within 3 days.");
  assert.equal(skipLine("XMPL-ROOF", "built"), "XMPL-ROOF · skipped: it already has a Retargeting campaign.");
  assert.equal(doneLine({ code: "NX26-RUDIMENTAL", live: false, made: 6, takenMinor: 2100 }), "Done: NX26-RUDIMENTAL · Retargeting created paused · 3 ad sets · 6 audiences made. Takes £21.00 a day from prospecting once it’s live.");
  assert.equal(doneLine({ code: "NX26-RUDIMENTAL", live: true, made: 6, takenMinor: 2100 }), "Done: NX26-RUDIMENTAL · Retargeting created live · 3 ad sets · 6 audiences made. Takes £21.00 a day from prospecting.");
  assert.equal(skipReason({ archived: false, built: false, runDay: "2026-12-10", showDay: SHOW, pixelId: "px1", hasTicketLink: true, plan }), "soon");
});
