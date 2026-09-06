import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveChannelDefaults } from "../../clients/channel-defaults.ts";
import { collectPlanPreflight } from "../preflight.ts";
import { unconnectedShareIssue } from "../unconnected-share.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan } from "../types.ts";

function draftPlan(budget: CampaignPlan["intent"]["budget"]): CampaignPlan {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    name: "D.O.D",
    status: "draft",
    intent: {
      eventId: "33333333-3333-4333-8333-333333333333",
      objectiveIntent: "registration",
      target: { value: null, unit: null },
      budget,
      destinationUrl: "https://tickets.example.com/dod",
      audienceClusterRef: null,
      creativeSetRef: null,
      startDate: "2026-08-27",
      endDate: null,
      startTime: null,
      endTime: null,
    },
    launches: {
      meta: IDLE_PLAN_LAUNCH,
      tiktok: IDLE_PLAN_LAUNCH,
      google: IDLE_PLAN_LAUNCH,
    },
    createdAt: "2026-08-26T12:00:00.000Z",
    updatedAt: "2026-08-26T12:00:00.000Z",
  };
}

const metaConnected = resolveChannelDefaults(null, {
  metaAdAccountId: "act_1073273492854557",
});
const metaChannel = {
  stored: null,
  overrides: { metaAdAccountId: "act_1073273492854557" },
};

describe("unconnected share blocks Launch (item 19)", () => {
  it("a draft with TikTok at 29% and no tiktok account is blocked with the exact string", () => {
    const plan = draftPlan({
      totalDaily: 100,
      metaDaily: 71,
      tiktokDaily: 29,
      googleDaily: 0,
    });
    const issue = unconnectedShareIssue(plan, metaConnected);
    assert.ok(issue);
    assert.equal(issue?.blocking, true);
    assert.equal(
      issue?.message,
      "TikTok has 29% of the budget but no account — connect, or set TikTok to 0",
    );
    const result = collectPlanPreflight(plan, undefined, metaChannel);
    assert.equal(result.ok, false);
    assert.equal(
      result.issues.find((row) => row.id === "plan:unconnected_share")?.message,
      "TikTok has 29% of the budget but no account — connect, or set TikTok to 0",
    );
  });

  it("names every unconnected channel in one sentence", () => {
    const plan = draftPlan({
      totalDaily: 35,
      metaDaily: 20,
      tiktokDaily: 10,
      googleDaily: 5,
    });
    const issue = unconnectedShareIssue(plan, metaConnected);
    assert.equal(
      issue?.message,
      "TikTok and Google hold 43% of the budget but no accounts — connect, or set them to 0",
    );
  });

  it("already-live plans are untouched", () => {
    const plan = draftPlan({
      totalDaily: 35,
      metaDaily: 20,
      tiktokDaily: 10,
      googleDaily: 5,
    });
    plan.status = "live";
    plan.id = "299dd4e5-0000-4000-8000-000000000000";
    assert.equal(unconnectedShareIssue(plan, metaConnected), null);
  });
});
