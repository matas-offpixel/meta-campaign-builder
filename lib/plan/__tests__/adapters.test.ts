import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateGoogleSearchPlan } from "../../google-search/validation.ts";
import { validateCampaignPayload } from "../../meta/campaign.ts";
import { validateCreativePayload } from "../../meta/creative.ts";
import { collectTikTokLaunchPreflight } from "../../tiktok/write/preflight.ts";
import { planToGoogleDraft } from "../adapters/google.ts";
import { planToMetaDraft } from "../adapters/meta.ts";
import { mapIntentToTikTokObjective, planToTikTokDraft } from "../adapters/tiktok.ts";
import { collectPlanPreflight } from "../preflight.ts";
import {
  IDLE_PLAN_LAUNCH,
  type CampaignPlan,
  type CampaignPlanObjectiveIntent,
} from "../types.ts";

function goldenPlan(overrides: Partial<CampaignPlan["intent"]> = {}): CampaignPlan {
  const now = "2026-08-25T12:00:00.000Z";
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    name: "BB26 Kayode",
    status: "draft",
    intent: {
      eventId: "33333333-3333-4333-8333-333333333333",
      objectiveIntent: "registration",
      target: { value: null, unit: null },
      budget: {
        totalDaily: 110,
        metaDaily: 40,
        tiktokDaily: 50,
        googleDaily: 20,
      },
      destinationUrl: "https://tickets.example.com/bb26",
      audienceClusterRef: "Music & Nightlife",
      creativeSetRef: null,
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      startTime: null,
      endTime: null,
      ...overrides,
    },
    launches: {
      meta: IDLE_PLAN_LAUNCH,
      tiktok: IDLE_PLAN_LAUNCH,
      google: IDLE_PLAN_LAUNCH,
    },
    createdAt: now,
    updatedAt: now,
  };
}

describe("plan adapters — golden plan invariants", () => {
  const plan = goldenPlan();

  it("threads event, destination URL, and daily split onto each existing draft shape", () => {
    const meta = planToMetaDraft(plan);
    const tiktok = planToTikTokDraft(plan);
    const google = planToGoogleDraft(plan);

    assert.equal(meta.settings.eventId, plan.intent.eventId);
    assert.equal(meta.settings.objective, plan.intent.objectiveIntent);
    assert.equal(meta.budgetSchedule.budgetAmount, plan.intent.budget.metaDaily);
    assert.ok(meta.creatives.some((c) => c.destinationUrl === plan.intent.destinationUrl));
    assert.ok(
      meta.adSetSuggestions.some((s) => s.budgetPerDay === plan.intent.budget.metaDaily),
    );
    assert.ok(
      meta.audiences.interestGroups.some(
        (g) => g.clusterType === plan.intent.audienceClusterRef,
      ),
    );

    assert.equal(tiktok.eventId, plan.intent.eventId);
    assert.equal(tiktok.campaignSetup.objective, "LEAD_GENERATION");
    assert.notEqual(tiktok.campaignSetup.objective, "CONVERSIONS");
    assert.equal(tiktok.budgetSchedule.dailyBudget, plan.intent.budget.tiktokDaily);
    assert.ok(
      tiktok.creatives.items.some((c) => c.landingPageUrl === plan.intent.destinationUrl),
    );
    assert.ok(
      tiktok.budgetSchedule.adGroups.some((g) => g.budget === plan.intent.budget.tiktokDaily),
    );

    assert.equal(google.plan.event_id, plan.intent.eventId);
    assert.equal(google.plan.total_budget, plan.intent.budget.googleDaily);
    assert.ok(
      google.campaigns.some((c) => c.daily_budget === plan.intent.budget.googleDaily),
    );
    const rsaUrls = google.campaigns.flatMap((c) =>
      c.ad_groups.flatMap((g) => g.rsas.map((r) => r.final_url)),
    );
    assert.ok(rsaUrls.includes(plan.intent.destinationUrl));
    assert.ok(
      google.campaigns.every((c) => c.ad_groups.every((g) => g.keywords.length === 0)),
      "Google adapter must not invent keywords",
    );
  });

  it("maps every internal intent to a live TikTok objective (never retired CONVERSIONS)", () => {
    const intents: CampaignPlanObjectiveIntent[] = [
      "purchase",
      "registration",
      "traffic",
      "awareness",
      "engagement",
    ];
    for (const intent of intents) {
      const mapped = mapIntentToTikTokObjective(intent);
      assert.notEqual(mapped, "CONVERSIONS");
    }
    assert.equal(mapIntentToTikTokObjective("traffic"), "TRAFFIC");
    assert.equal(mapIntentToTikTokObjective("awareness"), "AWARENESS");
    assert.equal(mapIntentToTikTokObjective("engagement"), "ENGAGEMENT");
  });
});

describe("plan-level preflight reuses platform validators", () => {
  it("surfaces the union of existing Meta / TikTok / Google issues", () => {
    const plan = goldenPlan();
    const result = collectPlanPreflight(plan);

    const metaCampaign = validateCampaignPayload({
      metaAdAccountId:
        result.drafts.meta.settings.metaAdAccountId ||
        result.drafts.meta.settings.adAccountId,
      name: result.drafts.meta.settings.campaignName,
      objective: result.drafts.meta.settings.objective,
    });
    const metaCreativeMessages = result.drafts.meta.creatives.flatMap(
      (c) => validateCreativePayload(c).errors,
    );
    const tiktok = collectTikTokLaunchPreflight(result.drafts.tiktok);
    const google = validateGoogleSearchPlan(result.drafts.google);

    const planMessages = (adapter: "meta" | "tiktok" | "google", blocking: boolean) =>
      result.issues
        .filter((i) => i.adapter === adapter && i.blocking === blocking)
        .map((i) => i.message)
        .sort();

    assert.deepEqual(
      planMessages("meta", true).sort(),
      [...Object.values(metaCampaign.errors), ...metaCreativeMessages].sort(),
    );
    assert.deepEqual(
      planMessages("tiktok", true),
      tiktok.issues.map((i) => i.message).sort(),
    );
    assert.deepEqual(
      planMessages("google", true),
      google
        .filter((i) => i.severity === "error")
        .map((i) => (i.scope ? `${i.scope}: ${i.message}` : i.message))
        .sort(),
    );
    assert.equal(result.ok, false);
  });

  it("names a zero-budget adapter as skipped, not a silent omit", () => {
    const plan = goldenPlan({
      budget: { totalDaily: 90, metaDaily: 40, tiktokDaily: 50, googleDaily: 0 },
    });
    const result = collectPlanPreflight(plan);
    const skip = result.issues.find((i) => i.id === "google:skipped_zero_budget");
    assert.ok(skip);
    assert.equal(skip?.blocking, false);
    assert.match(skip?.message ?? "", /skipped/);
    assert.equal(result.drafts.google.plan.event_id, plan.intent.eventId);
  });
});
