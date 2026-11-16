/**
 * A new ad set's line shows what Apply writes (design, 16 Nov): "starts at
 * £{daily} a day, {ad set}'s daily budget" — the copied ad set's daily
 * budget, read in the purchase read's ad-set batch, which Apply writes as the
 * new ad set's daily_budget and funds on. Recent spend sits beside it only
 * marked as spend, never as the start amount. Under a campaign budget Apply
 * writes no ad-set budget: "shares the campaign budget".
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { weeklyMoved, type Funding } from "../new-adset.ts";
import { ONSALE_PHASE } from "../phase-config.ts";
import { audienceLines, type AdSetInput, type CampaignInput, type ClusterInput } from "../rules.ts";
import { planRun } from "../schedule.ts";

const PLAN = planRun({ day: "2026-11-16", eventDate: "2026-12-27", config: ONSALE_PHASE, shadow: true });

type Meta = NonNullable<AdSetInput["meta"]>;
const DAILY = (minor: number): Meta => ({ dailyBudgetMinor: minor, lifetimeBudgetMinor: null, pixelId: "645185673672763" });
const CBO: Meta = { dailyBudgetMinor: null, lifetimeBudgetMinor: null, pixelId: "645185673672763" };

function adSet(overrides: Partial<AdSetInput> & Pick<AdSetInput, "adsetId" | "name">): AdSetInput {
  return { adsetIds: [overrides.adsetId], firstDay: "2026-10-30", lastDay: "2026-11-15", weekSpend: 40, weekResults: 5, totalSpend: 100, totalResults: 12, delivering: true, recentDailySpend: 5, deliveringAds: 3, ...overrides };
}

const CLUSTER: ClusterInput = { id: "k1", name: "Disc Genre", client: "Puzzle", index: 0.7, confidence: 0.5, confidenceWord: "ok", usedOnEvent: false, interestList: [{ id: "601", name: "Disc Genre" }] };

/** Adv+ (£1.50 per IC, £5.00 a day recent spend) is the copy; Lineup the giver. */
function input(meta: { adv?: Meta; broad?: Meta; lineup?: Meta } = {}, extra: Partial<CampaignInput> = {}): CampaignInput {
  return {
    eventId: "e1",
    eventCode: "P26-BDAY",
    eventName: "Puzzle 4th Birthday",
    campaignKey: "[P26-BDAY] Puzzle - 27 Dec - On Sale",
    campaignIds: ["c1"],
    adAccountId: "act_9",
    draft: { draftId: "d1", adAccountId: "act_9", copy: null, budgetLevel: "ad_set" },
    eventDate: "2026-12-27",
    signup: { event: "CompleteRegistration", registrations180: 420, landing30: 300, ticket30: 40 },
    country: "GB",
    landingUrl: "https://puzzle.crqln.com/l/p26-bday",
    ticketUrl: "https://www.skiddle.com/e/41234567/",
    videoPlays: 900,
    onSaleDay: "2026-10-30",
    plan: PLAN,
    resultEvent: "initiate_checkout",
    weekSpend: 100,
    weekResults: 32,
    totalSpend: 600,
    totalResults: 200,
    totalFirstDay: "2026-10-29",
    ads: [],
    adSets: [
      adSet({ adsetId: "adv", name: "Adv+", weekSpend: 30, weekResults: 20, ...(meta.adv ? { meta: meta.adv } : {}) }),
      adSet({ adsetId: "broad", name: "Broad", weekSpend: 40, weekResults: 10, ...(meta.broad ? { meta: meta.broad } : {}) }),
      adSet({ adsetId: "lineup", name: "Lineup — Primary", weekSpend: 30, weekResults: 2, ...(meta.lineup ? { meta: meta.lineup } : {}) }),
    ],
    clusters: [CLUSTER],
    supply: [],
    claims: [],
    budgetGbp: 4500,
    spendToDateGbp: 2123.58,
    ticketingLinked: false,
    ticketingProvider: null,
    last14: { ic: 60, purchases: 0, lpv: 0 },
    sinceOnSale: { ic: 200, purchases: 0, fromDay: "2026-10-30" },
    ...extra,
  };
}

const lines = (i: CampaignInput) => audienceLines(i, ONSALE_PHASE).lines;
const of = (i: CampaignInput, ruleId: string) => lines(i).find((line) => line.ruleId === ruleId)!;

describe("a new ad set's line: the start amount Apply writes", () => {
  it("headroom: starts at the copied ad set's daily budget; recent spend beside it, marked as spend", () => {
    const i = input({ adv: DAILY(1450), broad: DAILY(2000), lineup: DAILY(2000) });
    const retargeting = of(i, "missing_default.retargeting");
    assert.deepEqual(retargeting.evidence.funding, { mode: "headroom", dailyGbp: 14.5 });
    assert.equal(retargeting.writeText, "New audience and ad set: a copy of Adv+ aimed at this audience only · 3 creatives reused · starts at £14.50 a day, Adv+'s daily budget, from plan headroom (recent spend £5.00 a day) · goes in live");
    assert.equal(retargeting.narrow.writeText, "New audience and ad set from Adv+ · starts at £14.50 a day, from plan headroom · live");
    const cluster = of(i, "bring_back.client_cluster");
    assert.equal(cluster.writeText, "New ad set: a copy of Adv+ (£1.50 per IC) with these interests · 3 creatives reused · starts at £14.50 a day, Adv+'s daily budget, from plan headroom (recent spend £5.00 a day) · goes in live");
    assert.equal(cluster.narrow.writeText, "New ad set from Adv+ · starts at £14.50 a day, from plan headroom · live");
    // Accept re-decides the funding on write.copyFrom.dailyGbp: the figure Apply writes, not the spend.
    assert.equal((retargeting.write!.copyFrom as { dailyGbp: number }).dailyGbp, 14.5);
  });

  it("move: the same start amount, moved from the giver; a week of it counts against the cap; spend equal to it isn't repeated", () => {
    // £200 left: £5.00 a day to the show doesn't fit headroom, a week (£35) fits the £40 cap.
    const i = input({ adv: DAILY(500), broad: DAILY(2000), lineup: DAILY(2000) }, { spendToDateGbp: 4300 });
    const line = of(i, "missing_default.retargeting");
    const funding = line.evidence.funding as Funding;
    assert.deepEqual(funding, { mode: "move", dailyGbp: 5, fromAdsetId: "lineup", fromName: "Lineup — Primary" });
    assert.equal(weeklyMoved(funding), 35);
    assert.equal(line.writeText, "New audience and ad set: a copy of Adv+ aimed at this audience only · 3 creatives reused · starts at £5.00 a day, Adv+'s daily budget, moved from Lineup — Primary · goes in live");
    assert.equal(line.narrow.writeText, "New audience and ad set from Adv+ · starts at £5.00 a day, moved from Lineup — Primary · live");
  });

  it("the start amount, not the spend, decides the funding: £14.50 a day doesn't fit £200 of headroom or the £40 cap", () => {
    const line = of(input({ adv: DAILY(1450), broad: DAILY(2000), lineup: DAILY(2000) }, { spendToDateGbp: 4300 }), "missing_default.retargeting");
    assert.deepEqual(line.evidence.funding, { mode: "none" }, "on the £5.00 spend it would have read as a move");
    assert.equal(line.writeText, "New audience and ad set: a copy of Adv+ aimed at this audience only · 3 creatives reused · no budget yet · goes in live");
    assert.equal(line.narrow.writeText, "New audience and ad set from Adv+ · no budget yet · live");
    assert.match(line.blockedReason ?? "", /^No budget to start it/);
  });

  it("campaign budget: Apply writes no ad-set budget, so it shares the campaign's; no spend shown", () => {
    const i = input({ adv: CBO, broad: CBO, lineup: CBO });
    for (const ruleId of ["missing_default.retargeting", "missing_default.registrations_lookalike", "bring_back.client_cluster"]) {
      const line = of(i, ruleId);
      assert.deepEqual(line.evidence.funding, { mode: "cbo" }, ruleId);
      assert.match(line.writeText, / · shares the campaign budget · goes in live$/, ruleId);
      assert.match(line.narrow.writeText ?? "", / · shares the campaign budget · live$/, ruleId);
      assert.doesNotMatch(line.writeText, /starts at|recent spend/, ruleId);
    }
  });

  it("the budget not read: no figure is named as the start; the spend shows only as spend", () => {
    const line = of(input(), "missing_default.retargeting");
    assert.equal(line.writeText, "New audience and ad set: a copy of Adv+ aimed at this audience only · 3 creatives reused · starts at Adv+'s daily budget, from plan headroom (recent spend £5.00 a day) · goes in live");
    assert.equal(line.narrow.writeText, "New audience and ad set from Adv+ · starts at Adv+'s daily budget, from plan headroom · live");
  });
});
