/**
 * A small invented client for HE6's tests: two shows and an undated brand
 * campaign on a Meta account shared with another promoter. Show names and
 * figures only.
 *
 * Expected D12 paid spend (to 2026-11-04): Meta 525 (465 with an
 * ad-level row + 60 rollup-only), TikTok 85, Google 37.5 → 647.5.
 */

import type { MetaAdDay, ObjectiveBudgetInput } from "../types.ts";

export const S1 = "e-night-one";
export const S2 = "e-night-two";
export const BRAND = "e-brand";

function ad(p: Partial<MetaAdDay> & Pick<MetaAdDay, "campaignId" | "campaignName" | "day" | "spend">): MetaAdDay {
  return {
    adSetId: null,
    impressions: 0,
    reach: 0,
    linkClicks: 0,
    landingPageViews: 0,
    registrations: 0,
    leads: 0,
    purchases: 0,
    campaignObjective: null,
    optimizationGoal: null,
    promotedEvent: null,
    ...p,
  };
}

export function fixture(): ObjectiveBudgetInput {
  return {
    client: { id: "c1", name: "Riverside Venue" },
    events: [
      { eventId: S1, code: "RV01", name: "Night One", showDate: "2026-10-03", kind: "event", linkedCampaignIds: ["m1"], budgetMarketing: 10000 },
      { eventId: S2, code: "RV02", name: "Night Two", showDate: "2026-10-10", kind: "event", linkedCampaignIds: [], budgetMarketing: 8000 },
      { eventId: BRAND, code: "RVBR", name: "Brand (always-on)", showDate: null, kind: "brand_campaign", linkedCampaignIds: [], budgetMarketing: 5000 },
    ],
    metaAdDays: [
      // Linked to Night One: a Complete Registration sales ad set.
      ad({ campaignId: "m1", campaignName: "Night One — Signups", adSetId: "a1", day: "2026-09-01", spend: 100, impressions: 20000, reach: 5000, linkClicks: 400, landingPageViews: 300, registrations: 80, campaignObjective: "OUTCOME_SALES", optimizationGoal: "OFFSITE_CONVERSIONS", promotedEvent: "COMPLETE_REGISTRATION" }),
      // Tagged [RV01]: purchase; its second day has no promoted event stored (the ad set's first non-null wins).
      ad({ campaignId: "m2", campaignName: "[RV01] Purchase", adSetId: "a2", day: "2026-09-20", spend: 200, impressions: 15000, reach: 4000, linkClicks: 300, landingPageViews: 150, purchases: 10, campaignObjective: "OUTCOME_SALES", optimizationGoal: "OFFSITE_CONVERSIONS", promotedEvent: "PURCHASE" }),
      ad({ campaignId: "m2", campaignName: "[RV01] Purchase", adSetId: "a2", day: "2026-09-21", spend: 20, impressions: 1000, reach: 800, linkClicks: 20, landingPageViews: 10, purchases: 1, campaignObjective: "OUTCOME_SALES", optimizationGoal: "OFFSITE_CONVERSIONS", promotedEvent: null }),
      ad({ campaignId: "m3", campaignName: "[RV02] Traffic", adSetId: "a3", day: "2026-09-21", spend: 50, impressions: 9000, reach: 6000, linkClicks: 500, landingPageViews: 400, campaignObjective: "OUTCOME_TRAFFIC", optimizationGoal: "LANDING_PAGE_VIEWS" }),
      ad({ campaignId: "m4", campaignName: "[RVBR] Engagement", adSetId: "a4", day: "2026-09-02", spend: 30, impressions: 12000, reach: 9000, linkClicks: 40, campaignObjective: "OUTCOME_ENGAGEMENT", optimizationGoal: "POST_ENGAGEMENT" }),
      // A lead-form ad set: its result is leads.
      ad({ campaignId: "m5", campaignName: "[RV02] Lead form", adSetId: "a5", day: "2026-09-05", spend: 40, impressions: 5000, reach: 3500, linkClicks: 90, leads: 20, campaignObjective: "OUTCOME_LEADS", optimizationGoal: "LEAD_GENERATION" }),
      // Another promoter on the same account: no show of this client, so left out.
      ad({ campaignId: "m6", campaignName: "[OTHER01] Someone else", adSetId: "a6", day: "2026-09-20", spend: 999, purchases: 50, campaignObjective: "OUTCOME_SALES", optimizationGoal: "OFFSITE_CONVERSIONS", promotedEvent: "PURCHASE" }),
      // No [CODE]: reaches Night Two through campaign_event_overrides only.
      ad({ campaignId: "m7", campaignName: "Autumn reach", adSetId: "a7", day: "2026-09-22", spend: 25, impressions: 7000, reach: 3000, linkClicks: 10, campaignObjective: "OUTCOME_AWARENESS", optimizationGoal: "REACH" }),
    ],
    googleDays: [
      { eventCode: "RV01", campaignId: "g1", channelType: "SEARCH", day: "2026-09-20", spend: 12.5, impressions: 800, clicks: 50, conversions: 0, conversionValue: 0 },
      { eventCode: "RV02", campaignId: "g2", channelType: "DISPLAY", day: "2026-09-22", spend: 5, impressions: 3000, clicks: 6, conversions: 0, conversionValue: 0 },
    ],
    rollups: [
      // Before ad-level insights were stored: the rollup is the only Meta figure.
      { eventId: S1, day: "2026-08-25", meta: 60, tiktok: null, google: null, metaSynced: true, tiktokSynced: false, googleSynced: false },
      // Lower than the ad-level sum (100): D12 takes the larger.
      { eventId: S1, day: "2026-09-01", meta: 90, tiktok: null, google: null, metaSynced: true, tiktokSynced: false, googleSynced: false },
      { eventId: S2, day: "2026-09-21", meta: 50, tiktok: 70, google: 20, metaSynced: true, tiktokSynced: true, googleSynced: true },
      { eventId: BRAND, day: "2026-09-02", meta: 30, tiktok: 15, google: null, metaSynced: true, tiktokSynced: true, googleSynced: false },
    ],
    overrides: { meta: { m7: S2 }, google: {} },
    additionalSpend: [{ eventId: S1, scope: "event", day: "2026-09-10", amount: 150 }],
    entries: [
      { id: "b1", eventId: null, kind: "credit", label: "Google promo credit", amount: 40, spent: null, day: "2026-09-30" },
      { id: "b2", eventId: S1, kind: "sub_budget", label: "Night One afters", amount: 500, spent: 120, day: null },
      { id: "b3", eventId: S2, kind: "sub_budget", label: "Night Two afters", amount: 300, spent: null, day: null },
      { id: "b4", eventId: null, kind: "sms_cost", label: "SMS, September", amount: 80, spent: null, day: "2026-09-30" },
      // After the read's day: left out.
      { id: "b5", eventId: null, kind: "credit", label: "Later credit", amount: 999, spent: null, day: "2026-12-01" },
    ],
    d2c: {
      rate: { rate: null, currency: "GBP" },
      rows: [
        {
          id: "w1",
          provider: "bird",
          account_id: "bird-ws",
          external_id: "x1",
          channel: "whatsapp",
          client_id: "c1",
          event_id: S1,
          attribution: "show",
          audience_kind: "marketing",
          name: "Night One presale",
          sent_at: "2026-09-15T10:00:00Z",
          sent: 1100,
          delivered: 1000,
          read: 600,
          clicked: 100,
          opens_unique_raw: null,
          opens_unique_filtered: null,
          open_rate_filtered: null,
          fetched_at: null,
        },
      ],
    },
  };
}
