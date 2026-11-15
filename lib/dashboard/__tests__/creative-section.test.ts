/**
 * HE5 creative section. IRW0006 figures are the 15 Nov 2026 read.
 * The S14 link case is a constructed input. TikTok completion uses the
 * IRW0001 window read from the same day.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cdwCreative, cdwWithLinks } from "../creative-section-fixture.ts";
import { creativeObjective } from "../creative-section-objective.ts";
import {
  FILTER_EMPTY,
  FORMAT_EMPTY,
  LEAST_REFRESH_NOTE,
  buildCreativeSection,
  filterCreativeSection,
  formatOf,
  type CreativeSectionInput,
} from "../creative-section.ts";

describe("objective", () => {
  it("counts registration and leads as signup, and a purchase event as purchase", () => {
    assert.equal(creativeObjective({ campaignObjective: "OUTCOME_LEADS", optimizationGoal: "OFFSITE_CONVERSIONS", promotedEvent: "COMPLETE_REGISTRATION" }), "signup");
    assert.equal(creativeObjective({ campaignObjective: "OUTCOME_SALES", optimizationGoal: "OFFSITE_CONVERSIONS", promotedEvent: "PURCHASE" }), "purchase");
    assert.equal(creativeObjective({ campaignObjective: "OUTCOME_SALES", optimizationGoal: "LANDING_PAGE_VIEWS", promotedEvent: null }), null);
  });
});

describe("format", () => {
  it("reads the S14 angle and ignores a caption style that is not one of the five", () => {
    assert.equal(formatOf("P26-BDAY_enzo-siragusa-1_ugc-edit1-on-sale_r1_9x16.mp4", []), "UGC edit");
    assert.equal(formatOf("P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16.mp4", []), null);
    assert.equal(formatOf("UGC 2 - CDW – Copy", []), "UGC edit");
    assert.equal(formatOf("Presale Reminder", []), "Presale reminder");
    assert.equal(formatOf("Presale live", []), null);
    assert.equal(formatOf("JJ - Motion 9 — Streaming", []), null);
    assert.equal(formatOf("JJ - Motion 9 — Streaming", ["UGC edit"]), "UGC edit");
  });
});

describe("IRW0006", () => {
  const model = cdwCreative("internal");

  it("draws the format scorecard from the ad names and applies the £500 gate", () => {
    assert.equal(model.source, "IRONWORKS · Charlotte de Witte · Meta and TikTok · to 6 Aug");
    assert.equal(model.source.includes("creative_scores"), false);
    assert.equal(model.formatEmpty, null);
    const ugc = model.formats.find((row) => row.format === "UGC edit");
    const artwork = model.formats.find((row) => row.format === "Static artwork");
    const presale = model.formats.find((row) => row.format === "Presale reminder");
    assert.equal(ugc?.costPerSignup, "£0.76");
    assert.equal(ugc?.signups, "5,867");
    assert.equal(artwork?.costPerSignup, "£1.13");
    assert.equal(artwork?.signups, "826");
    assert.equal(presale?.spend, "£38.85");
    assert.equal(presale?.signups, "—");
    assert.equal(presale?.costPerSignup, "—");
    assert.equal(presale?.costPerPurchase, "—");
    assert.equal(model.signups[0]?.name, "UGC 2 - CDW – Copy");
    assert.equal(model.signups[0]?.result, "2,912");
    assert.equal(model.sales[0]?.name, "Final Tickets");
    assert.equal(model.sales[0]?.result, "33");
  });

  it("matches every selected tag", () => {
    const filtered = filterCreativeSection(model, [
      { dimension: "hook_tactic", label: "FOMO" },
      { dimension: "asset_type", label: "High Production" },
    ]);
    assert.equal(filtered.filterEmpty, null);
    assert.deepEqual(filtered.signups.map((row) => row.name), ["UGC 2 - CDW – Copy"]);
    const missed = filterCreativeSection(model, [
      { dimension: "hook_tactic", label: "FOMO" },
      { dimension: "asset_type", label: "Illustration" },
    ]);
    assert.equal(missed.filterEmpty, FILTER_EMPTY);
  });

  it("drops Lab, refresh and Ads Manager links on the share link", () => {
    const share = cdwWithLinks("share");
    const internal = cdwWithLinks("internal");
    assert.equal(share.surface, "share");
    assert.equal(share.signups[0]?.result, model.signups[0]?.result);
    assert.equal(share.signups[0]?.viewAd, null);
    assert.equal(share.signups[0]?.lab, null);
    assert.equal(share.signups[0]?.drive, null);
    assert.equal(share.least[0]?.href, null);
    assert.match(internal.signups[0]?.viewAd ?? "", /adsmanager\.facebook\.com/);
    assert.match(internal.signups[0]?.lab ?? "", /#render-render-1/);
    assert.equal(internal.least[0]?.href, "/events/f8603e89-0b0e-4b43-9984-0f3f3a0e906d#refresh-line-line-1");
    assert.equal(JSON.stringify(share).includes("cross-client"), false);
    assert.equal(JSON.stringify(share).includes("creative_scores"), false);
    assert.equal(JSON.stringify(share).includes("adsmanager"), false);
    assert.equal(JSON.stringify(share).includes("refresh-line"), false);
  });
});

describe("rules", () => {
  const eventId = "e1";
  const base = (over: Partial<CreativeSectionInput> = {}): CreativeSectionInput => ({
    surface: "internal",
    client: "Test",
    show: "Show",
    through: "6 Aug",
    scored: [{ eventId, name: "P26-BDAY_enzo-1_ugc-edit1-on-sale_r1_9x16.mp4" }, { eventId, name: "P26-BDAY_enzo-1_ticket-warning1-signup_r1_9x16.mp4" }],
    days: [
      { eventId, name: "P26-BDAY_enzo-1_ugc-edit1-on-sale_r1_9x16.mp4", objective: "signup", spend: 600, impressions: 1000, clicks: 20, signups: 30, purchases: 0, adId: "a", adAccountId: "act_123456" },
      { eventId, name: "P26-BDAY_enzo-1_ugc-edit1-on-sale_r1_9x16.mp4", objective: "purchase", spend: 100, impressions: 100, clicks: 2, signups: 0, purchases: 4, adId: "a", adAccountId: "act_123456" },
      { eventId, name: "P26-BDAY_enzo-1_ticket-warning1-signup_r1_9x16.mp4", objective: "signup", spend: 200, impressions: 500, clicks: 5, signups: 2, purchases: 0, adId: "b", adAccountId: "act_123456" },
      { eventId, name: "P26-BDAY_enzo-1_ticket-warning1-signup_r1_9x16.mp4", objective: "purchase", spend: 800, impressions: 900, clicks: 9, signups: 0, purchases: 10, adId: "b", adAccountId: "act_123456" },
    ],
    tags: [],
    renders: [{ eventId, name: "P26-BDAY_enzo-1_ugc-edit1-on-sale_r1_9x16.mp4", driveFileId: "drive-1", renderId: "render-1" }],
    tiktok: [],
    refreshOn: false,
    pauses: [],
    ...over,
  });

  it("shows a cost only where £500 or more ran, and links the render", () => {
    const model = buildCreativeSection(base());
    const ugc = model.formats.find((row) => row.format === "UGC edit");
    const warning = model.formats.find((row) => row.format === "Ticket warning");
    assert.equal(ugc?.costPerSignup, "£20.00");
    assert.equal(ugc?.costPerPurchase, "—");
    assert.equal(ugc?.purchases, "4");
    assert.equal(warning?.costPerSignup, "—");
    assert.equal(warning?.signups, "2");
    assert.equal(warning?.costPerPurchase, "£80.00");
    assert.equal(model.signups[0]?.lab, "/events/e1#render-render-1");
    assert.match(model.signups[0]?.drive ?? "", /drive-1/);
    assert.match(model.signups[0]?.viewAd ?? "", /selected_ad_ids=a/);
  });

  it("says when no creative is named with a format", () => {
    const model = buildCreativeSection(base({ scored: [{ eventId, name: "Final Tickets" }], days: [], renders: [], pauses: [] }));
    assert.equal(model.formatEmpty, FORMAT_EMPTY);
  });

  it("keeps TikTok completion as full views divided by 2-second views", () => {
    const model = buildCreativeSection(
      base({
        tiktok: [{ name: "80% - JJ New 1_vaES07ge.mp4", spend: 167.67, impressions: 13071, clicks: 370, views2s: 911, viewsFull: 45 }],
      }),
    );
    assert.equal(model.tiktok[0]?.completion, "4.94 %");
    assert.equal(model.tiktok[0]?.spend, "£167.67");
  });

  it("replaces least impact with the refresh's pause lines", () => {
    const model = buildCreativeSection(base({ refreshOn: true, pauses: [{ eventId, lineId: "line-1", name: "Weak edit" }] }));
    assert.equal(model.leastNote, LEAST_REFRESH_NOTE);
    assert.deepEqual(model.least.map((row) => row.name), ["Weak edit"]);
    assert.equal(model.least[0]?.href, "/events/e1#refresh-line-line-1");
  });
});
