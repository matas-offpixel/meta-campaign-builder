import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { formatWallClockForTikTok } from "../../tiktok/write/schedule-time.ts";
import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import { collectPlanPreflight } from "../preflight.ts";
import {
  collectTikTokEarlyIssues,
  tikTokAdvertiserClockLabel,
  tikTokDailyFloorMessage,
  tikTokPixelNotFiredMessage,
  tikTokSalesPixelNotFiredMessage,
  tikTokUnverifiedFloorMessage,
} from "../tiktok-early.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan } from "../types.ts";

const WALKED_AT = new Date("2026-09-08T12:00:00.000Z");

function planWithTikTokShare(tiktokDaily: number): CampaignPlan {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    name: "Schak",
    status: "draft",
    intent: {
      eventId: "33333333-3333-4333-8333-333333333333",
      objectiveIntent: "purchase",
      target: { value: null, unit: null },
      budget: {
        totalDaily: 150,
        metaDaily: 142.5,
        tiktokDaily,
        googleDaily: 0,
      },
      destinationUrl: "https://tickets.example.com/schak",
      audienceClusterRef: null,
      creativeSetRef: null,
      startDate: "2026-09-08",
      endDate: "2026-10-23",
      startTime: "18:00",
      endTime: null,
    },
    launches: {
      meta: IDLE_PLAN_LAUNCH,
      tiktok: IDLE_PLAN_LAUNCH,
      google: IDLE_PLAN_LAUNCH,
    },
    createdAt: "2026-09-08T12:00:00.000Z",
    updatedAt: "2026-09-08T12:00:00.000Z",
  };
}

function electricGroupDraft() {
  const draft = createDefaultTikTokDraft("tt-electric");
  draft.accountSetup.advertiserId = "7681317718284304385";
  draft.accountSetup.currency = "GBP";
  draft.accountSetup.timezone = "Etc/GMT";
  draft.accountSetup.pixelId = "7682889598944002055";
  draft.accountSetup.pixelName = "NX Loves Pixel TT";
  draft.campaignSetup.objective = "CONVERSIONS";
  draft.budgetSchedule.adGroups = [
    { id: "ag-1", name: "Prospecting", budget: 7.5, startAt: null, endAt: null },
  ];
  return draft;
}

describe("TikTok early budget floor — Electric Group GBP 2026-09-08", () => {
  it("names both numbers when tiktokDaily is 7.50 against the £50 GBP floor", () => {
    const issues = collectTikTokEarlyIssues({
      tiktokDaily: 7.5,
      currency: "GBP",
      timezone: "Etc/GMT",
      objective: "TRAFFIC",
      pixelName: null,
      pixelId: null,
      adGroupCount: 1,
      now: WALKED_AT,
    });
    const floor = issues.find((issue) => issue.id === "tiktok:early:budget-floor");
    assert.ok(floor);
    assert.equal(floor?.blocking, true);
    assert.equal(
      floor?.message,
      "TikTok needs at least £50 a day — this plan gives it £7.50. Raise TikTok's share, or set it to 0.",
    );
  });

  it("says the per-ad-group floor when the draft has three ad groups", () => {
    assert.equal(
      tikTokDailyFloorMessage({
        currency: "GBP",
        dailyMin: 50,
        tiktokDaily: 50,
        adGroupCount: 3,
      }),
      "TikTok needs at least £50 a day each — three ad groups needs £150. This plan gives it £50. Raise TikTok's share, or set it to 0.",
    );
    const issues = collectTikTokEarlyIssues({
      tiktokDaily: 50,
      currency: "GBP",
      timezone: "Etc/GMT",
      objective: "TRAFFIC",
      pixelName: null,
      pixelId: null,
      adGroupCount: 3,
      now: WALKED_AT,
    });
    assert.match(
      issues.find((issue) => issue.id === "tiktok:early:budget-floor")?.message ?? "",
      /three ad groups needs £150/,
    );
  });

  it("warns by naming the currency when the floor is unverified — never silence", () => {
    const issues = collectTikTokEarlyIssues({
      tiktokDaily: 7.5,
      currency: "EUR",
      timezone: null,
      objective: "TRAFFIC",
      pixelName: null,
      pixelId: null,
      adGroupCount: 1,
      now: WALKED_AT,
    });
    const warning = issues.find(
      (issue) => issue.id === "tiktok:early:budget-currency",
    );
    assert.ok(warning);
    assert.equal(warning?.blocking, false);
    assert.equal(
      warning?.message,
      tikTokUnverifiedFloorMessage("EUR"),
    );
    assert.equal(
      warning?.message,
      "no TikTok minimum is documented for EUR — preflight is not checking the amount",
    );
    assert.equal(
      issues.some((issue) => issue.id === "tiktok:early:budget-floor"),
      false,
    );
  });
});

describe("TikTok early pixel — NX Loves Pixel TT has not fired", () => {
  it("states the pixel sentence and the Traffic alternative for CONVERSIONS + events: []", () => {
    const message = tikTokPixelNotFiredMessage("NX Loves Pixel TT");
    assert.equal(
      message,
      "NX Loves Pixel TT has not fired yet — TikTok cannot optimise for a conversion until it does. Install it on the landing page, or run Traffic for now.",
    );
    const issues = collectTikTokEarlyIssues({
      tiktokDaily: 50,
      currency: "GBP",
      timezone: "Etc/GMT",
      objective: "CONVERSIONS",
      pixelName: "NX Loves Pixel TT",
      pixelId: "7682889598944002055",
      pixelEvents: [],
      adGroupCount: 1,
      now: WALKED_AT,
    });
    const pixel = issues.find((issue) => issue.id === "tiktok:early:pixel-events");
    assert.ok(pixel);
    assert.equal(pixel?.blocking, true);
    assert.equal(pixel?.message, message);
    assert.match(pixel?.message ?? "", /Traffic/);
  });

  it("does not invent an empty-pixel finding when events were not loaded", () => {
    const issues = collectTikTokEarlyIssues({
      tiktokDaily: 50,
      currency: "GBP",
      timezone: "Etc/GMT",
      objective: "CONVERSIONS",
      pixelName: "NX Loves Pixel TT",
      pixelId: "7682889598944002055",
      adGroupCount: 1,
      now: WALKED_AT,
    });
    assert.equal(
      issues.some((issue) => issue.id === "tiktok:early:pixel-events"),
      false,
    );
  });
});

describe("TikTok advertiser clock — Etc/GMT vs Europe/London", () => {
  it("names Etc/GMT and that it is an hour behind London until 25 Oct", () => {
    assert.equal(
      tikTokAdvertiserClockLabel("Etc/GMT", WALKED_AT),
      "times are the advertiser's clock (Etc/GMT) — an hour behind London until 25 Oct",
    );
  });

  it("the clock label is mounted where TikTok schedule times are entered", () => {
    const src = readFileSync(
      "components/tiktok-wizard/steps/budget-schedule.tsx",
      "utf8",
    );
    assert.match(src, /tikTokAdvertiserClockLabel/);
    assert.match(src, /accountSetup\.timezone/);
  });

  it("the empty-pixel sentence is mounted where the pixel is chosen", () => {
    const src = readFileSync(
      "components/tiktok-wizard/steps/account-setup.tsx",
      "utf8",
    );
    assert.match(src, /tikTokPixelNotFiredMessage/);
    assert.match(src, /tikTokSalesPixelNotFiredMessage/);
    assert.match(src, /isTikTokConversionObjective/);
  });

  it("states the Sales sentence at the objective when the pixel has events: []", () => {
    assert.equal(
      tikTokSalesPixelNotFiredMessage("Ironworks Pixel"),
      "Ironworks Pixel has not fired any events yet — Sales cannot optimise for a purchase until it does. Install it on the checkout, or run Traffic for now.",
    );
    const src = readFileSync(
      "components/tiktok-wizard/steps/campaign-setup.tsx",
      "utf8",
    );
    assert.match(src, /tikTokSalesPixelNotFiredMessage/);
    assert.match(src, /id="tiktok-objective"/);
  });

  it("does not rewrite formatWallClockForTikTok — naive times stay the advertiser wall clock", () => {
    assert.equal(
      formatWallClockForTikTok("2026-09-08T18:00", "Etc/GMT"),
      "2026-09-08 18:00:00",
    );
    assert.equal(
      formatWallClockForTikTok("2026-08-21T12:50", "America/New_York"),
      "2026-08-21 12:50:00",
    );
    assert.equal(
      formatWallClockForTikTok("2026-01-15T17:00:00.000Z", "Europe/London"),
      "2026-01-15 17:00:00",
    );
  });
});

describe("collectPlanPreflight surfaces the early findings", () => {
  it("blocks a 7.50 GBP TikTok share before launch preflight walks the tree", () => {
    const plan = planWithTikTokShare(7.5);
    const result = collectPlanPreflight(
      plan,
      { tiktok: electricGroupDraft() },
      null,
      { now: WALKED_AT },
    );
    const floor = result.issues.find(
      (issue) => issue.id === "tiktok:early:budget-floor",
    );
    assert.equal(
      floor?.message,
      "TikTok needs at least £50 a day — this plan gives it £7.50. Raise TikTok's share, or set it to 0.",
    );
    const clock = result.issues.find(
      (issue) => issue.id === "tiktok:early:advertiser-clock",
    );
    assert.equal(
      clock?.message,
      "times are the advertiser's clock (Etc/GMT) — an hour behind London until 25 Oct",
    );
    assert.equal(clock?.blocking, false);
  });

  it("uses the pixel sentence when the caller knows events is empty", () => {
    const plan = planWithTikTokShare(50);
    const draft = electricGroupDraft();
    draft.budgetSchedule.adGroups[0].budget = 50;
    const result = collectPlanPreflight(plan, { tiktok: draft }, null, {
      pixelEvents: [],
      now: WALKED_AT,
    });
    const pixel = result.issues.find(
      (issue) => issue.id === "tiktok:early:pixel-events",
    );
    assert.equal(
      pixel?.message,
      "NX Loves Pixel TT has not fired yet — TikTok cannot optimise for a conversion until it does. Install it on the landing page, or run Traffic for now.",
    );
    assert.equal(
      result.issues.some((issue) =>
        issue.message.includes("requires an optimisation event from the selected pixel"),
      ),
      false,
    );
  });
});
