import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { googleAdsCampaignDeepLink } from "../../google-ads/campaign-writer-types.ts";
import { buildTikTokAdsManagerUrl } from "../../tiktok/ads-manager-url.ts";
import { planAdsManagerLinks } from "../ads-manager-links.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan } from "../types.ts";

function plan(): CampaignPlan {
  return {
    id: "p1",
    userId: "u1",
    name: "BB26",
    status: "live_partial",
    intent: {
      eventId: "e1",
      objectiveIntent: "registration",
      target: { value: null, unit: null },
      budget: { totalDaily: 50, metaDaily: 50, tiktokDaily: 0, googleDaily: 0 },
      destinationUrl: "https://example.com",
      audienceClusterRef: null,
      creativeSetRef: null,
      startDate: null,
      endDate: null,
      startTime: null,
      endTime: null,
    },
    launches: {
      meta: {
        status: "live",
        platformCampaignId: "120251192700000",
        draftId: "d1",
        error: null,
      },
      tiktok: { ...IDLE_PLAN_LAUNCH },
      google: { ...IDLE_PLAN_LAUNCH },
    },
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
}

describe("planAdsManagerLinks reuses existing builders", () => {
  it("matches the Meta helper when account + campaign ids exist", () => {
    const href = planAdsManagerLinks(plan(), { metaAdAccountId: "act_1234567890" })[0].href;
    assert.equal(
      href,
      "https://business.facebook.com/adsmanager/manage/campaigns?act=1234567890&selected_campaign_ids=120251192700000",
    );
  });

  it("does not invent a TikTok campaign-selection param", () => {
    const tiktok = planAdsManagerLinks(plan(), { tiktokAdvertiserId: "99" })[1];
    assert.equal(tiktok.href, buildTikTokAdsManagerUrl("99"));
    assert.ok(tiktok.href);
    assert.doesNotMatch(tiktok.href ?? "", /campaign_id|selected_campaign/);
  });

  it("reuses the Google resource-name helper when both ids exist", () => {
    const withGoogle: CampaignPlan = {
      ...plan(),
      launches: {
        ...plan().launches,
        google: {
          status: "live",
          platformCampaignId: "customers/7932800197/campaigns/23874109408",
          draftId: null,
          error: null,
        },
      },
    };
    const google = planAdsManagerLinks(withGoogle, { googleCustomerId: "793-280-0197" })[2];
    assert.equal(
      google.href,
      googleAdsCampaignDeepLink(
        "customers/7932800197/campaigns/23874109408",
        "793-280-0197",
      ),
    );
  });
});

describe("plan UI honest copy", () => {
  it("list and workspace name empty states and the paused launch gate", () => {
    const list = readFileSync("app/(dashboard)/plans/page.tsx", "utf8");
    const library = readFileSync("components/library/plan-library.tsx", "utf8");
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    const nav = readFileSync("components/dashboard/dashboard-nav.tsx", "utf8");
    assert.match(list, /Migration 157 has not been applied/);
    assert.match(`${list}\n${library}`, /No plans yet/);
    assert.match(nav, /href: "\/plans"/);
    assert.match(workspace, /No events yet/);
    assert.doesNotMatch(workspace, /Migration 157 is required to persist/);

    /**
     * The launch verb, the killswitch reason and the Ads Manager escape
     * hatch are all copy now, and copy lives in one place so the canvas
     * components carry no long string literals of their own.
     */
    const copy = readFileSync("lib/plan/canvas.ts", "utf8");
    assert.match(copy, /Launch all \(paused\)|⏸ Launch/);
    assert.match(copy, /ENABLE_PLAN_FANOUT/);
    assert.match(copy, /Ads Manager/);
  });
});
