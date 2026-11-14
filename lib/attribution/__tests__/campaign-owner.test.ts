import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tiktokCampaignCountsForEvent } from "../../tiktok/rollup-insights.ts";
import { withClearedTikTokDays } from "../../dashboard/tiktok-rollup-leg.ts";
import { campaignBelongsTo, campaignOwner, caseCollisions, isMissingOverridesTable, nameCarriesCode } from "../campaign-owner.ts";

describe("[CODE] in a campaign name (HN2)", () => {
  it("matches case-insensitively, reads en and em dashes as hyphens", () => {
    assert.ok(nameCarriesCode("[NX26-Locklead] Locklead - SIGNUP", "NX26-LOCKLEAD"));
    assert.ok(nameCarriesCode("[nx26–ipc] On sale", "NX26-IPC"));
  });

  it("accepts the \"[CODE[\" bracket typo", () => {
    assert.ok(nameCarriesCode("[NX26-ROBBIEDOHERTY[ Signup – Lifetime", "NX26-ROBBIEDOHERTY"));
  });

  it("needs the code to end at the bracket", () => {
    assert.equal(nameCarriesCode("[NX26-DO] test", "NX26-DOD"), false);
    assert.equal(nameCarriesCode("[NX26-DODX] test", "NX26-DOD"), false);
    assert.equal(nameCarriesCode("AZYR - SIGNUP", "NX26-AZYR"), false);
  });

  it("two codes that differ only by case match exactly as written (UTB0046-New / UTB0046-NEW on prod)", () => {
    const events = [
      { eventId: "a", code: "UTB0046-New" },
      { eventId: "b", code: "UTB0046-NEW" },
    ];
    assert.deepEqual([...caseCollisions(events.map((e) => e.code))], ["utb0046-new"]);
    assert.equal(campaignOwner(events, { id: "1", name: "[UTB0046-NEW] Video" }, new Map())?.eventId, "b");
    assert.equal(campaignOwner(events, { id: "2", name: "[UTB0046-New] Video" }, new Map())?.eventId, "a");
    assert.equal(campaignOwner(events, { id: "3", name: "[utb0046-new] Video" }, new Map()), null);
  });

  it("an override beats the name; a campaign with no override still matches by [CODE]", () => {
    const events = [
      { eventId: "azyr", code: "NX26-AZYR" },
      { eventId: "lock", code: "NX26-LOCKLEAD" },
    ];
    const overrides = new Map([["1880462786907170", "lock"]]);
    assert.equal(campaignOwner(events, { id: "1880462786907170", name: "[NX26-AZYR] Locklead - SIGNUP 2" }, overrides)?.eventId, "lock");
    assert.equal(campaignOwner(events, { id: "999", name: "[NX26-AZYR] Presale" }, overrides)?.eventId, "azyr");
    assert.equal(campaignBelongsTo(events[0], { id: "1880462786907170", name: "[NX26-AZYR] Locklead - SIGNUP 2" }, overrides), false);
  });

  it("an unapplied migration 240 reads as no overrides", () => {
    assert.ok(isMissingOverridesTable(new Error('campaign_event_overrides: relation "public.campaign_event_overrides" does not exist')));
    assert.equal(isMissingOverridesTable(new Error("timeout")), false);
  });
});

describe("TikTok rollup leg", () => {
  it("an override counts a campaign for its event only; no override falls back to the name", () => {
    const overrides = new Map([["c1", "lock"]]);
    const base = { campaignId: "c1", name: "[NX26-AZYR] Locklead - SIGNUP 2", overrides };
    assert.equal(tiktokCampaignCountsForEvent({ ...base, eventCode: "NX26-AZYR", eventId: "azyr" }), false);
    assert.equal(tiktokCampaignCountsForEvent({ ...base, eventCode: "NX26-LOCKLEAD", eventId: "lock" }), true);
    assert.equal(tiktokCampaignCountsForEvent({ campaignId: "c2", name: "AZYR - SIGNUP", eventCode: "NX26-AZYR", eventId: "azyr", overrides }), false);
    assert.equal(tiktokCampaignCountsForEvent({ campaignId: "c2", name: "AZYR - SIGNUP", eventCode: "NX26-AZYR", eventId: "azyr", overrides: new Map([["c2", "azyr"]]) }), true);
    assert.equal(tiktokCampaignCountsForEvent({ campaignId: "c3", name: "[NX26-Locklead] SIGNUP", eventCode: "NX26-LOCKLEAD", eventId: "lock" }), true);
  });

  it("clears a day the event held spend on that no campaign matches any more (#1225's £8.01)", () => {
    const rows = [{ date: "2026-10-30", tiktok_spend: 3.99, tiktok_impressions: 1, tiktok_reach: 1, tiktok_clicks: 0, tiktok_video_views: 0, tiktok_results: 0 }];
    const out = withClearedTikTokDays(rows as never, ["2026-10-29", "2026-10-30"]);
    assert.deepEqual(out.map((r) => [r.date, r.tiktok_spend]), [["2026-10-29", 0], ["2026-10-30", 3.99]]);
    assert.deepEqual(withClearedTikTokDays([], []), []);
  });
});
