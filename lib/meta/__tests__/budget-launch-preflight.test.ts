/**
 * Launch budget gate, attach-mode budget shape, and the Review line.
 *
 * Run: node --test lib/meta/__tests__/budget-launch-preflight.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { buildAdSetPayload } from "../adset.ts";
import {
  CBO_CAMPAIGN_HAS_NO_BUDGET,
  budgetScheduleForAttach,
  describeLaunchBudget,
  refuseSilentDailyLaunch,
} from "../budget-launch.ts";
import type { AdSetSuggestion, AudienceSettings, BudgetScheduleSettings } from "../../types.ts";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../app/api/meta/launch-campaign/route.ts"),
  "utf8",
);

function adSet(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "s1",
    name: "London",
    sourceType: "blank",
    sourceId: "",
    sourceName: "No audience source",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 20,
    advantagePlus: true,
    enabled: true,
    ...overrides,
  } as AdSetSuggestion;
}

const audiences = {
  interestGroups: [],
  customAudienceGroups: [],
  pageGroups: [],
  savedAudiences: { audienceIds: [] },
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

function schedule(overrides: Partial<BudgetScheduleSettings> = {}): BudgetScheduleSettings {
  return {
    budgetLevel: "ad_set",
    budgetType: "daily",
    budgetAmount: 20,
    currency: "GBP",
    startDate: "2026-10-01",
    endDate: "2026-12-12",
    timezone: "Europe/London",
    ...overrides,
  } as BudgetScheduleSettings;
}

function build(row: AdSetSuggestion, budget: BudgetScheduleSettings) {
  return buildAdSetPayload(
    row,
    "camp_1",
    audiences,
    budget,
    "link_clicks",
    "traffic",
    undefined,
    false,
    undefined,
    "PAUSED",
  );
}

describe("launch budget preflight", () => {
  it("refuses a lifetime ad set whose lifetime_budget is 0 and names the ad set", () => {
    const message = refuseSilentDailyLaunch({
      budgetType: "lifetime",
      budgetLevel: "ad_set",
      campaign: {},
      adSets: [{ name: "London", lifetime_budget: 0, end_time: 1_700_000_000 }],
    });
    assert.equal(
      message,
      'Ad set "London" has no lifetime budget. Set it on the Budget step. Nothing was sent to Meta.',
    );
  });

  it("refuses a lifetime ad set that has no end date", () => {
    const message = refuseSilentDailyLaunch({
      budgetType: "lifetime",
      budgetLevel: "ad_set",
      campaign: {},
      adSets: [{ name: "London", lifetime_budget: 5000 }],
    });
    assert.match(message ?? "", /Ad set "London" has no end date/);
    assert.match(message ?? "", /Budget step/);
  });

  it("refuses a daily ad set budget of 0", () => {
    const message = refuseSilentDailyLaunch({
      budgetType: "daily",
      budgetLevel: "ad_set",
      campaign: {},
      adSets: [{ name: "London", daily_budget: 0 }],
    });
    assert.match(message ?? "", /Ad set "London" has no daily budget/);
  });

  it("allows a lifetime ABO payload with a positive lifetime budget and an end date", () => {
    const message = refuseSilentDailyLaunch({
      budgetType: "lifetime",
      budgetLevel: "ad_set",
      campaign: {},
      adSets: [{ name: "London", lifetime_budget: 5000, end_time: 1_700_000_000, bid_strategy: "LOWEST_COST_WITHOUT_CAP" }],
    });
    assert.equal(message, null);
  });

  it("refuses a CBO campaign payload that carries no budget", () => {
    const message = refuseSilentDailyLaunch({
      budgetType: "daily",
      budgetLevel: "campaign",
      campaign: {},
      adSets: [{}],
    });
    assert.equal(message, CBO_CAMPAIGN_HAS_NO_BUDGET);
  });

  it("refuses a CBO ad set that still carries a budget or bid strategy", () => {
    const message = refuseSilentDailyLaunch({
      budgetType: "daily",
      budgetLevel: "campaign",
      campaign: { daily_budget: 2000 },
      adSets: [{ name: "London", daily_budget: 2000, bid_strategy: "LOWEST_COST_WITHOUT_CAP" }],
    });
    assert.match(message ?? "", /Ad set "London"/);
    assert.match(message ?? "", /Budget step/);
  });

  it("allows a CBO payload whose ad sets carry none of the budget fields", () => {
    const message = refuseSilentDailyLaunch({
      budgetType: "lifetime",
      budgetLevel: "campaign",
      campaign: { lifetime_budget: 5000 },
      adSets: [{ name: "London", end_time: 1_700_000_000 }],
    });
    assert.equal(message, null);
  });

  it("refuses the payload a lifetime toggle emits when budgetLifetime was never set", () => {
    const payload = build(
      adSet({ budgetPerDay: 20 }),
      schedule({ budgetType: "lifetime", budgetAmount: 1700 }),
    );
    const message = refuseSilentDailyLaunch({
      budgetType: "lifetime",
      budgetLevel: "ad_set",
      campaign: {},
      adSets: [payload],
    });
    assert.equal(payload.lifetime_budget, 0);
    assert.match(message ?? "", /London/);
    assert.match(message ?? "", /lifetime budget/);
  });

  it("runs before createMetaCampaign and turns a payload-build throw into 400", () => {
    const refuseAt = routeSrc.indexOf("refuseSilentDailyLaunch(");
    const createAt = routeSrc.indexOf("createMetaCampaign(");
    assert.ok(refuseAt > 0);
    assert.ok(createAt > refuseAt);
    const fnAt = routeSrc.indexOf("function preflightAdSetPayloads");
    assert.ok(fnAt > 0);
    const fnBody = routeSrc.slice(fnAt, fnAt + 900);
    assert.match(fnBody, /try \{/);
    assert.match(fnBody, /catch \(err\)/);
    assert.match(
      routeSrc,
      /if \("error" in built\) \{\s*return launchJson\(\{ error: built\.error \}, \{ status: 400 \}\);/,
    );
    const attachAt = routeSrc.indexOf("budgetScheduleForAttach(draft.budgetSchedule, campaign)");
    assert.ok(attachAt > 0);
    const attachBody = routeSrc.slice(attachAt, attachAt + 800);
    assert.match(attachBody, /refuseSilentDailyLaunch\(/);
  });
});

describe("attach_campaign budget shape", () => {
  it("CBO target + ABO draft sends a budget-less ad set", () => {
    const attached = budgetScheduleForAttach(
      schedule({ budgetLevel: "ad_set", budgetType: "daily" }),
      { lifetime_budget: "5000" },
    );
    const payload = build(adSet({ budgetPerDay: 20, budgetLifetime: 850 }), attached);
    assert.equal(attached.budgetLevel, "campaign");
    assert.equal(payload.daily_budget, undefined);
    assert.equal(payload.lifetime_budget, undefined);
    assert.equal(payload.bid_strategy, undefined);
  });

  it("ABO target + CBO draft sends daily_budget from budgetPerDay", () => {
    const attached = budgetScheduleForAttach(
      schedule({ budgetLevel: "campaign", budgetType: "daily", budgetAmount: 50 }),
      { daily_budget: "0" },
    );
    const payload = build(adSet({ budgetPerDay: 20 }), attached);
    assert.equal(attached.budgetLevel, "ad_set");
    assert.equal(payload.daily_budget, 2000);
    assert.equal(payload.bid_strategy, "LOWEST_COST_WITHOUT_CAP");
  });
});

describe("review budget line", () => {
  it("states ad set lifetime with the total, the count, and the end date", () => {
    assert.equal(
      describeLaunchBudget({
        budgetLevel: "ad_set",
        budgetType: "lifetime",
        budgetAmount: 1700,
        currency: "GBP",
        enabledAdSetCount: 2,
        endDate: "2026-12-12",
      }),
      "Ad set level · Lifetime · GBP 1,700 across 2 ad sets · ends 12 Dec",
    );
  });

  it("states campaign-level daily as a per-day amount", () => {
    assert.equal(
      describeLaunchBudget({
        budgetLevel: "campaign",
        budgetType: "daily",
        budgetAmount: 50,
        currency: "GBP",
        enabledAdSetCount: 2,
        endDate: "2026-12-12",
      }),
      "Campaign level (CBO) · Daily · GBP 50/day",
    );
  });
});
