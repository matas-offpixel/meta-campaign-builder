/**
 * The Retargeting campaign's create path (RT1, RT2, RT4, HR1, HR3) on fakes
 * only: no Meta call is real. The gates before any write; the steps in
 * order (campaign paused with no budget, audiences, three tier ad sets
 * paused with daily budgets and the hotter tiers left out, ads, switched
 * on last); a launched_ad_sets row per tier; Retry never makes a second
 * campaign or audience; RT9's refresh hooks.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { purchaseCampaignInput } from "../../onsale-refresh/purchase-campaign.ts";
import { listRowPayload } from "../list-row.ts";


describe("RT9: the refresh never treats the Retargeting campaign as its own", () => {
  it("the Purchase campaign line doesn't read `{code} · Retargeting` as a running Purchase campaign", () => {
    const row = (campaign: string, goal: string, event: string) => ({ meta_ad_id: `${campaign}-ad`, meta_adset_id: `${campaign}-set`, meta_campaign_id: `${campaign}-id`, date: "2026-11-16", ad_name: "ad", adset_name: "set", campaign_name: campaign, spend: 10, landing_page_views: 0, purchases: 1, actions: [], promoted_event: event, optimization_goal: goal });
    const input = purchaseCampaignInput({
      rows: [row("XMPL-ROOF · Retargeting", "OFFSITE_CONVERSIONS", "PURCHASE"), row("XMPL-ROOF · Tickets", "OFFSITE_CONVERSIONS", "INITIATED_CHECKOUT")],
      eventCode: "XMPL-ROOF",
      eventName: "Roof",
      runDay: "2026-11-17",
      eventDate: "2026-12-18",
      windowStart: "2026-11-10",
      windowEnd: "2026-11-16",
      onSaleDay: "2026-11-06",
      read: undefined,
      scores: new Map(),
      budgets: null,
      budgetGbp: 4000,
      spendToDateGbp: 1500,
      draftOf: () => null,
    });
    assert.equal(input.existing, null);
    assert.equal(input.main?.campaignKey, "XMPL-ROOF · Tickets");
  });
});

describe("HR2: a list with a role is a meta_custom_audiences row", () => {
  it("customer_list, its role and show, no window, and its upload time", () => {
    const row = listRowPayload({ userId: "u1", clientId: "c1", eventId: "e1", name: "Roof buyers", role: "buyers", metaAudienceId: "123", adAccountId: "act_1", now: new Date("2026-11-17T09:00:00Z") });
    assert.deepEqual([row.audience_subtype, row.list_role, row.retention_days, row.event_id, row.meta_audience_id, row.status], ["customer_list", "buyers", null, "e1", "123", "ready"]);
    assert.deepEqual(row.source_meta, { subtype: "customer_list", role: "buyers", uploadedAt: "2026-11-17T09:00:00.000Z" });
  });
});
