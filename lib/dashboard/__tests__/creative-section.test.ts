/**
 * HE5 creative section. IRW0001 figures are the 15 Nov 2026 read.
 * The S14 and £500 cases are constructed inputs, not a show's report.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ironworksCreative } from "../creative-section-fixture.ts";
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
    assert.equal(formatOf("JJ - Motion 9 — Streaming", ["UGC edit"]), "UGC edit");
  });
});

describe("IRW0001", () => {
  const model = ironworksCreative("internal");

  it("ranks the real signup and purchase creatives and leaves the format table empty", () => {
    assert.equal(model.signups[0]?.name, "JJ - Motion 9 — Streaming");
    assert.equal(model.signups[0]?.result, "234");
    assert.equal(model.signups[0]?.cost, "£1.27");
    assert.equal(model.signups[0]?.ctr, "2.67 %");
    assert.equal(model.sales[0]?.name, "JJ Feed Post - Gen Sale");
    assert.equal(model.sales[0]?.result, "30");
    assert.equal(model.sales[0]?.spend, "£984.24");
    assert.equal(model.formatEmpty, FORMAT_EMPTY);
    assert.equal(model.least[0]?.name, "TICKET UPDATE");
    assert.match(model.least[0]?.detail ?? "", /£149\.06/);
    assert.equal(model.tiktok[0]?.name, "80% - JJ New 1_vaES07ge.mp4");
    assert.equal(model.tiktok[0]?.completion, "4.94 %");
    assert.equal(model.tiktok[0]?.spend, "£167.67");
  });

  it("matches every selected tag", () => {
    const filtered = filterCreativeSection(model, [
      { dimension: "hook_tactic", label: "FOMO" },
      { dimension: "asset_type", label: "Illustration" },
    ]);
    assert.equal(filtered.filterEmpty, FILTER_EMPTY);
    const headliner = filterCreativeSection(model, [{ dimension: "messaging_angle", label: "Artist Headliner" }]);
    assert.ok(headliner.signups.some((row) => row.name === "JJ - Lineup Artwork"));
    assert.ok(headliner.signups.every((row) => row.tags.includes("Artist Headliner") || row.name === "JJ - Lineup Artwork"));
  });

  it("shows the same creatives on the share link, with no cross-client line", () => {
    const share = ironworksCreative("share");
    assert.equal(share.surface, "share");
    assert.equal(share.signups[0]?.result, model.signups[0]?.result);
    assert.equal(JSON.stringify(share).includes("cross-client"), false);
    assert.equal(JSON.stringify(share).includes("other client"), false);
  });
});

describe("rules", () => {
  const eventId = "e1";
  const base = (over: Partial<CreativeSectionInput> = {}): CreativeSectionInput => ({
    surface: "internal",
    label: "Test",
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

  it("replaces least impact with the refresh's pause lines", () => {
    const model = buildCreativeSection(base({ refreshOn: true, pauses: [{ eventId, lineId: "line-1", name: "Weak edit" }] }));
    assert.equal(model.leastNote, LEAST_REFRESH_NOTE);
    assert.deepEqual(model.least.map((row) => row.name), ["Weak edit"]);
    assert.equal(model.least[0]?.href, "/events/e1#refresh-line-line-1");
  });
});
