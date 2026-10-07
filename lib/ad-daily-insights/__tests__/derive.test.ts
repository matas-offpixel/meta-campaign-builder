import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AD_DAILY_INSIGHTS_FIELDS,
  LEAD_ACTION_TYPES,
  PURCHASE_ACTION_TYPES,
  REGISTRATION_ACTION_TYPES,
  deriveAdDailyInsight,
} from "../derive.ts";

const FETCHED = new Date("2026-10-07T02:30:00Z");

function row(actions: { action_type: string; value: string }[], extra: Record<string, unknown> = {}) {
  return {
    date_start: "2026-10-05",
    ad_id: "120001",
    ad_name: "Hero video",
    adset_id: "800",
    adset_name: "Lookalikes",
    campaign_id: "700",
    campaign_name: "[BB26-KAYODE] Presale",
    spend: "12.34",
    impressions: "1000",
    reach: "800",
    clicks: "40",
    inline_link_clicks: "25",
    actions,
    ...extra,
  };
}

describe("action-type lists", () => {
  it("are stated exactly; view_content is in none of them", () => {
    assert.deepEqual(REGISTRATION_ACTION_TYPES, [
      "offsite_conversion.fb_pixel_complete_registration",
      "complete_registration",
    ]);
    assert.deepEqual(LEAD_ACTION_TYPES, ["offsite_conversion.fb_pixel_lead", "lead"]);
    assert.deepEqual(PURCHASE_ACTION_TYPES, ["offsite_conversion.fb_pixel_purchase"]);
    for (const list of [REGISTRATION_ACTION_TYPES, LEAD_ACTION_TYPES, PURCHASE_ACTION_TYPES]) {
      assert.ok(!(list as readonly string[]).some((t) => t.includes("view_content")));
    }
  });

  it("the Meta fields string is the one the cron sends", () => {
    assert.equal(
      AD_DAILY_INSIGHTS_FIELDS,
      "spend,impressions,reach,clicks,inline_link_clicks,actions,video_15_sec_watched_actions,video_p100_watched_actions,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name",
    );
  });
});

describe("deriveAdDailyInsight", () => {
  it("registrations and leads are separate, pixel-first, never summed across aliases", () => {
    const out = deriveAdDailyInsight(
      "act_1",
      row([
        { action_type: "complete_registration", value: "4" },
        { action_type: "offsite_conversion.fb_pixel_complete_registration", value: "4" },
        { action_type: "lead", value: "20" },
        { action_type: "offsite_conversion.fb_pixel_lead", value: "20" },
        { action_type: "offsite_conversion.fb_pixel_view_content", value: "300" },
        { action_type: "view_content", value: "300" },
        { action_type: "omni_complete_registration", value: "4" },
        { action_type: "onsite_web_lead", value: "20" },
      ]),
      FETCHED,
    )!;
    assert.equal(out.registrations, 4);
    assert.equal(out.leads, 20);
    assert.equal(out.purchases, 0);
    assert.equal(out.result_action_type, "offsite_conversion.fb_pixel_complete_registration");
    assert.equal(out.actions.length, 8, "raw rows kept for re-derivation");
  });

  it("view_content alone is not a registration; plain alias counts when the pixel type is absent", () => {
    const viewOnly = deriveAdDailyInsight("act_1", row([{ action_type: "view_content", value: "50" }]))!;
    assert.equal(viewOnly.registrations, 0);
    assert.equal(viewOnly.result_action_type, null);
    const plain = deriveAdDailyInsight("act_1", row([{ action_type: "complete_registration", value: "3" }]))!;
    assert.equal(plain.registrations, 3);
    assert.equal(plain.result_action_type, "complete_registration");
  });

  it("result type falls through registrations → leads → purchases", () => {
    const lead = deriveAdDailyInsight("act_1", row([{ action_type: "offsite_conversion.fb_pixel_lead", value: "2" }]))!;
    assert.equal(lead.result_action_type, "offsite_conversion.fb_pixel_lead");
    const purchase = deriveAdDailyInsight(
      "act_1",
      row([
        { action_type: "purchase", value: "9" },
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "3" },
      ]),
    )!;
    assert.equal(purchase.purchases, 3, "fb_pixel_purchase only, same as event_daily_rollups");
    assert.equal(purchase.result_action_type, "offsite_conversion.fb_pixel_purchase");
  });

  it("maps delivery, link clicks, LPV and the three video counts", () => {
    const out = deriveAdDailyInsight(
      "act_1",
      row([
        { action_type: "landing_page_view", value: "7" },
        { action_type: "video_view", value: "5" },
        { action_type: "video_15_sec_watched_actions", value: "0" },
      ], {
        video_15_sec_watched_actions: [{ action_type: "video_view", value: "3" }],
        video_p100_watched_actions: [{ action_type: "video_view", value: "2" }],
      }),
      FETCHED,
    )!;
    assert.deepEqual(
      {
        ad_account_id: out.ad_account_id,
        meta_ad_id: out.meta_ad_id,
        meta_adset_id: out.meta_adset_id,
        meta_campaign_id: out.meta_campaign_id,
        date: out.date,
        campaign_name: out.campaign_name,
        spend: out.spend,
        impressions: out.impressions,
        reach: out.reach,
        clicks: out.clicks,
        link_clicks: out.link_clicks,
        landing_page_views: out.landing_page_views,
        video_plays_3s: out.video_plays_3s,
        video_plays_15s: out.video_plays_15s,
        video_plays_p100: out.video_plays_p100,
        fetched_at: out.fetched_at,
      },
      {
        ad_account_id: "act_1",
        meta_ad_id: "120001",
        meta_adset_id: "800",
        meta_campaign_id: "700",
        date: "2026-10-05",
        campaign_name: "[BB26-KAYODE] Presale",
        spend: 12.34,
        impressions: 1000,
        reach: 800,
        clicks: 40,
        link_clicks: 25,
        landing_page_views: 7,
        video_plays_3s: 5,
        video_plays_15s: 3,
        video_plays_p100: 2,
        fetched_at: "2026-10-07T02:30:00.000Z",
      },
    );
  });

  it("drops rows without an ad id or date", () => {
    assert.equal(deriveAdDailyInsight("act_1", { ...row([]), ad_id: undefined }), null);
    assert.equal(deriveAdDailyInsight("act_1", { ...row([]), date_start: "" }), null);
  });
});
