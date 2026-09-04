/**
 * The five states §2 says the canvas has. Not a test file — the glob is
 * `*.test.ts` — just the plans every canvas test reads from, so "ready"
 * means the same thing in each of them.
 */

import { EMPTY_CHANNEL_FACTS } from "../canvas-facts.ts";
import type { PlanPreflightIssue } from "../preflight.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan } from "../types.ts";

export const FIXTURE_NOW = new Date("2026-09-04T12:00:00.000Z");
export const FIXTURE_EVENT_ID = "33333333-3333-4333-8333-333333333333";

/** DOD, the plan the ship report's ASCII is taken from. */
export function basePlan(): CampaignPlan {
  const now = "2026-09-01T09:00:00.000Z";
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    name: "",
    status: "draft",
    intent: {
      eventId: FIXTURE_EVENT_ID,
      objectiveIntent: "registration",
      target: { value: 1.2, unit: "reg" },
      budget: { totalDaily: 120, metaDaily: 96, tiktokDaily: 18, googleDaily: 6 },
      destinationUrl: null,
      audienceClusterRef: null,
      creativeSetRef: null,
      startDate: "2026-09-04",
      endDate: "2026-09-27",
      startTime: "18:00",
      endTime: null,
    },
    launches: {
      meta: { ...IDLE_PLAN_LAUNCH },
      tiktok: { ...IDLE_PLAN_LAUNCH },
      google: { ...IDLE_PLAN_LAUNCH },
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** No Meta draft — TikTok and Google read `○ waiting for f`. */
export function waitingPlan(): CampaignPlan {
  return basePlan();
}

export function readyPlan(): CampaignPlan {
  const plan = basePlan();
  return {
    ...plan,
    launches: {
      meta: { ...IDLE_PLAN_LAUNCH, draftId: "meta-draft" },
      tiktok: { ...IDLE_PLAN_LAUNCH, draftId: "tiktok-draft" },
      google: { ...IDLE_PLAN_LAUNCH, draftId: "google-draft" },
    },
  };
}

export function launchedPlan(): CampaignPlan {
  const plan = readyPlan();
  return {
    ...plan,
    status: "published",
    launches: {
      meta: {
        ...plan.launches.meta,
        status: "live",
        platformCampaignId: "meta_camp",
      },
      tiktok: {
        ...plan.launches.tiktok,
        status: "live",
        platformCampaignId: "tt_camp",
      },
      google: {
        ...plan.launches.google,
        status: "live",
        platformCampaignId: "g_camp",
      },
    },
  };
}

/** Same launches as LAUNCHED — the difference is spend in the rollups. */
export const livePlan = launchedPlan;

export const FIXTURE_LIVE_SPEND = 842.5;

export function blockingIssues(): PlanPreflightIssue[] {
  return [
    {
      id: "meta-audiences",
      adapter: "meta",
      field: "audiences",
      message: "No audiences on the Meta draft",
      blocking: true,
      href: "/campaign/meta-draft?step=3",
    },
    {
      id: "meta-creatives",
      adapter: "meta",
      field: "creatives",
      message: "No creatives on the Meta draft",
      blocking: true,
      href: "/campaign/meta-draft?step=4",
    },
  ];
}

export function factsBundle(): typeof EMPTY_CHANNEL_FACTS {
  return {
    meta: [
      { n: 6, noun: "audiences" },
      { n: 12, noun: "creatives" },
      { n: 4, noun: "ad sets" },
    ],
    tiktok: [{ n: 5, noun: "videos" }],
    google: [
      { n: 84, noun: "keywords" },
      { n: 31, noun: "negatives" },
    ],
  };
}

export const FIXTURE_HREFS = {
  meta: "/campaign/meta-draft",
  tiktok: "/tiktok-campaign/tiktok-draft",
  google: "/google-search/google-draft",
};
