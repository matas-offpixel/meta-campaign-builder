/**
 * Lowest-cost CBO attach uses the live ad sets' optimisation.
 * A cost-cap campaign keeps the draft's goal.
 * A refusal is decided before any audience, creative, or ad set POST.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import type { AdSetSuggestion, AudienceSettings, BudgetScheduleSettings } from "../../types.ts";
import { buildAdSetPayload } from "../adset.ts";
import {
  attachCampaignTargets,
  attachOptimisationWarningForCampaign,
  decideAttachOptimisation,
  LOWEST_COST_SAME_OPTIMISATION,
} from "../attach-optimisation.ts";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../app/api/meta/launch-campaign/route.ts"),
  "utf8",
);

function makeAdSet(): AdSetSuggestion {
  return {
    id: "s1",
    name: "Fixture Ad Set",
    sourceType: "blank",
    sourceId: "",
    sourceName: "Blank",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 10,
    advantagePlus: true,
    enabled: true,
  } as AdSetSuggestion;
}

const emptyAudiences = {
  interestGroups: [],
  customAudienceGroups: [],
  pageGroups: [],
  savedAudiences: [],
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

const cboSchedule = {
  budgetLevel: "campaign",
  budgetType: "lifetime",
  startDate: "",
  endDate: "",
  adSets: [],
} as unknown as BudgetScheduleSettings;

function landingPageViewsCampaign(bidStrategy: string | undefined) {
  return {
    bid_strategy: bidStrategy,
    daily_budget: "5000",
    adsets: {
      data: [
        { optimization_goal: "LANDING_PAGE_VIEWS", promoted_object: {} },
        { optimization_goal: "LANDING_PAGE_VIEWS", promoted_object: {} },
      ],
    },
  };
}

describe("lowest-cost CBO attach", () => {
  it("a purchase draft sent into a landing-page-views campaign uses landing page views", () => {
    const decision = decideAttachOptimisation({
      campaignName: "[IRWOHD] Traffic",
      draftObjective: "purchase",
      draftOptimisationGoal: "conversions",
      campaign: landingPageViewsCampaign("LOWEST_COST_WITHOUT_CAP"),
    });
    assert.equal(decision.action, "use_campaign");
    if (decision.action !== "use_campaign") return;
    assert.equal(decision.objective, "traffic");
    assert.equal(decision.optimisationGoal, "landing_page_views");
    assert.equal(
      decision.warning,
      "This campaign optimises for Landing page views; new ad sets will too.",
    );

    const payload = buildAdSetPayload(
      makeAdSet(),
      "52531006358507",
      emptyAudiences,
      cboSchedule,
      decision.optimisationGoal,
      decision.objective,
      "pixel-from-the-purchase-draft",
    );
    assert.equal(payload.optimization_goal, "LANDING_PAGE_VIEWS");
    assert.equal(payload.destination_type, "WEBSITE");
    assert.equal(payload.promoted_object, undefined);
    assert.equal(JSON.stringify(payload).includes("PURCHASE"), false);
  });

  it("no bid_strategy on a campaign budget is still lowest cost", () => {
    const decision = decideAttachOptimisation({
      campaignName: "[IRWOHD] Traffic",
      draftObjective: "purchase",
      draftOptimisationGoal: "conversions",
      campaign: landingPageViewsCampaign(undefined),
    });
    assert.equal(decision.action, "use_campaign");
  });

  it("a cost-cap campaign keeps the purchase draft's goal", () => {
    const decision = decideAttachOptimisation({
      campaignName: "[IRWOHD] Traffic",
      draftObjective: "purchase",
      draftOptimisationGoal: "conversions",
      campaign: landingPageViewsCampaign("COST_CAP"),
    });
    assert.equal(decision.action, "keep_draft");

    const payload = buildAdSetPayload(
      makeAdSet(),
      "52531006358507",
      emptyAudiences,
      cboSchedule,
      "conversions",
      "purchase",
      "pixel-from-the-purchase-draft",
    );
    assert.equal(payload.optimization_goal, "OFFSITE_CONVERSIONS");
    assert.equal(payload.promoted_object?.custom_event_type, "PURCHASE");
    assert.equal(payload.destination_type, "WEBSITE");
  });

  it("a tie on a lowest-cost campaign refuses, and that refusal is before any create", () => {
    const decision = decideAttachOptimisation({
      campaignName: "[IRWOHD] Traffic",
      draftObjective: "purchase",
      draftOptimisationGoal: "conversions",
      campaign: {
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        lifetime_budget: "9000",
        adsets: {
          data: [
            { optimization_goal: "LANDING_PAGE_VIEWS" },
            { optimization_goal: "LINK_CLICKS" },
          ],
        },
      },
    });
    assert.equal(decision.action, "refuse");
    if (decision.action !== "refuse") return;
    assert.equal(decision.message.includes(LOWEST_COST_SAME_OPTIMISATION), true);
    assert.equal(decision.message.includes("no audience, creative, or ad set was created"), true);

    const refusal = routeSrc.indexOf('if (optimisation?.action === "refuse")');
    const phase15 = routeSrc.indexOf("PHASE 1.5 — Create engagement");
    const audiencePost = routeSrc.indexOf("await createEngagementAudienceWithRecovery", refusal);
    const creativePost = routeSrc.indexOf('"creative_upload"', refusal);
    assert.ok(refusal > 0, "launch route returns the optimisation refusal");
    assert.ok(refusal < phase15, "refusal is before engagement audiences");
    assert.ok(refusal < audiencePost, "refusal is before the audience POST");
    assert.ok(creativePost === -1 || refusal < creativePost, "refusal is before the creative POST");
    assert.match(routeSrc, /decideAttachOptimisation\(\{[\s\S]*?campaign: live/);
  });

  it("an empty campaign list still keeps the singular campaign to read live", () => {
    assert.deepEqual(
      attachCampaignTargets([], { id: "52531006358507" }),
      [{ id: "52531006358507" }],
    );
    assert.deepEqual(attachCampaignTargets(undefined, undefined), []);
  });

  it("Step 1 names the change when the draft's goal differs", () => {
    const warning = attachOptimisationWarningForCampaign({
      campaignName: "[IRWOHD] Traffic",
      draftObjective: "purchase",
      draftOptimisationGoal: "conversions",
      delivery: {
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
        dailyBudget: "5000",
        adSets: [{ optimization_goal: "LANDING_PAGE_VIEWS" }, { optimization_goal: "LANDING_PAGE_VIEWS" }],
      },
    });
    assert.equal(warning, "This campaign optimises for Landing page views; new ad sets will too.");
    assert.equal(
      attachOptimisationWarningForCampaign({
        campaignName: "[IRWOHD] Traffic",
        draftObjective: "purchase",
        draftOptimisationGoal: "conversions",
        delivery: null,
      }),
      null,
    );
  });
});
