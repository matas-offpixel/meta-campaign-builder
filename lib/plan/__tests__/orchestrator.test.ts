import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isPlanFanoutEnabled, planFanoutGateState } from "../gate.ts";
import { orchestratePlanLaunch, type PlanLaunchers } from "../orchestrator.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan } from "../types.ts";

function goldenPlan(): CampaignPlan {
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

function launchers(overrides: Partial<PlanLaunchers> = {}): PlanLaunchers {
  return {
    meta: async () => ({ ok: true, campaignId: "meta_1" }),
    tiktok: async () => ({ ok: true, campaignId: "tt_1" }),
    google: async () => ({ ok: true, campaignId: "gg_1" }),
    ...overrides,
  };
}

describe("ENABLE_PLAN_FANOUT gate", () => {
  it("is disabled unless the env value is exactly 1", () => {
    assert.equal(isPlanFanoutEnabled({}), false);
    assert.equal(isPlanFanoutEnabled({ ENABLE_PLAN_FANOUT: "true" }), false);
    assert.equal(isPlanFanoutEnabled({ ENABLE_PLAN_FANOUT: "1" }), true);
    assert.equal(planFanoutGateState({}).skippedReason, "killswitch");
    assert.equal(planFanoutGateState({ ENABLE_PLAN_FANOUT: "1" }).skippedReason, null);
  });
});

describe("orchestratePlanLaunch", () => {
  it("does not call any launcher when the killswitch is off", async () => {
    let calls = 0;
    const result = await orchestratePlanLaunch({
      plan: goldenPlan(),
      env: {},
      launchers: launchers({
        meta: async () => {
          calls += 1;
          return { ok: true };
        },
      }),
    });
    assert.equal(result.skippedReason, "killswitch");
    assert.equal(calls, 0);
    assert.equal(result.plan.status, "draft");
  });

  it("records a sibling failure as live_partial and continues", async () => {
    const order: string[] = [];
    const result = await orchestratePlanLaunch({
      plan: goldenPlan(),
      env: { ENABLE_PLAN_FANOUT: "1" },
      launchers: launchers({
        meta: async () => {
          order.push("meta");
          return { ok: true, campaignId: "meta_1" };
        },
        tiktok: async () => {
          order.push("tiktok");
          return { ok: false, error: "TikTok advertiser is required" };
        },
        google: async () => {
          order.push("google");
          return { ok: true, campaignId: "gg_1" };
        },
      }),
    });
    assert.deepEqual(order, ["meta", "tiktok", "google"]);
    assert.equal(result.plan.status, "live_partial");
    assert.equal(result.plan.launches.meta.status, "live");
    assert.equal(result.plan.launches.tiktok.status, "failed");
    assert.equal(result.plan.launches.google.status, "live");
    assert.equal(result.plan.launches.meta.platformCampaignId, "meta_1");
  });

  it("skips adapters already live and zero-budget adapters", async () => {
    const plan = goldenPlan();
    plan.launches.meta = {
      status: "live",
      platformCampaignId: "already",
      draftId: "d1",
      error: null,
    };
    plan.intent.budget.googleDaily = 0;
    let metaCalls = 0;
    let googleCalls = 0;
    const result = await orchestratePlanLaunch({
      plan,
      env: { ENABLE_PLAN_FANOUT: "1" },
      launchers: launchers({
        meta: async () => {
          metaCalls += 1;
          return { ok: true, campaignId: "new" };
        },
        google: async () => {
          googleCalls += 1;
          return { ok: true, campaignId: "gg" };
        },
      }),
    });
    assert.equal(metaCalls, 0);
    assert.equal(googleCalls, 0);
    assert.equal(result.plan.launches.meta.platformCampaignId, "already");
    assert.equal(result.plan.launches.google.status, "skipped");
    assert.equal(result.plan.launches.tiktok.status, "live");
  });

  it("logs the full outgoing payload before each write", async () => {
    const logged: string[] = [];
    await orchestratePlanLaunch({
      plan: goldenPlan(),
      env: { ENABLE_PLAN_FANOUT: "1" },
      logOutgoing: (adapter, payload) => {
        logged.push(adapter);
        assert.ok(payload && typeof payload === "object");
      },
      launchers: launchers(),
    });
    assert.deepEqual(logged, ["meta", "tiktok", "google"]);
  });
});

describe("plan fan-out isolation", () => {
  it("no cron route imports lib/plan", () => {
    const vercel = readFileSync("vercel.json", "utf8");
    assert.doesNotMatch(vercel, /plan\/launch|lib\/plan/);
    const cronIndex = readFileSync("app/api/cron/optimisation-tick/route.ts", "utf8");
    assert.doesNotMatch(cronIndex, /lib\/plan/);
  });

  it("the launch route threads createPaused true into Meta and sits behind the gate", () => {
    const route = readFileSync("app/api/plan/launch/route.ts", "utf8");
    assert.match(route, /createPaused:\s*true/);
    assert.match(route, /planFanoutGateState/);
    assert.match(route, /skippedReason/);
    assert.match(route, /metaLaunchPost/);
    assert.match(route, /handleTikTokLaunch/);
  });
});
