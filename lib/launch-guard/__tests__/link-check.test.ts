import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkCampaignLinks, duplicateCampaignClaims, splitCampaignIds, type LinkCheckEvent } from "../link-check.ts";
import { ELECTRIC_CLIENT_ID } from "../venue-defaults.ts";

const NX: LinkCheckEvent = {
  id: "nx",
  code: "NX27-GLITTERBOX",
  clientId: ELECTRIC_CLIENT_ID,
  venueKey: "nx newcastle",
  venueName: "NX Newcastle",
  metaAdAccountId: "606252931141334",
  metaCampaignId: "120252675731800755",
};
const EBR: LinkCheckEvent = {
  id: "ebr",
  code: "EBR27-GLITTERBOX",
  clientId: ELECTRIC_CLIENT_ID,
  venueKey: "electric bristol",
  venueName: "Electric Bristol",
  metaAdAccountId: "2011069725849568",
  metaCampaignId: "120250589910060716,120250589776730716",
};

describe("checkCampaignLinks (R5)", () => {
  it("last week's Glitterbox mis-file: EBR name, NX account, ad sets on the EBR event", () => {
    const [row] = checkCampaignLinks({
      campaigns: [
        { campaignId: "c1", campaignName: "[EBR27-GLITTERBOX] SIGNUP", adAccountId: "act_606252931141334", spend: 765, adSetIds: ["a1"] },
      ],
      events: [NX, EBR],
      adSetEvent: new Map([["a1", "ebr"]]),
    });
    assert.deepEqual(row!.problems, ["account_not_event_venue"]);
    assert.equal(row!.accountVenue, "NX Newcastle");
    assert.equal(row!.eventVenue, "Electric Bristol");
    assert.equal(row!.rightAccount, "2011069725849568");
  });

  it("a copy left under the source's name: the name code isn't the linked event's", () => {
    const [row] = checkCampaignLinks({
      campaigns: [
        { campaignId: "c2", campaignName: "[EBR27-GLITTERBOX] SIGNUP", adAccountId: "act_606252931141334", spend: 10, adSetIds: ["a2"] },
      ],
      events: [NX, EBR],
      adSetEvent: new Map([["a2", "nx"]]),
    });
    assert.deepEqual(row!.problems, ["name_code_vs_linked_event"]);
  });

  it("a campaign that agrees has no problem, linked through the event's campaign id when no ad set is", () => {
    const [row] = checkCampaignLinks({
      campaigns: [
        { campaignId: "120252675731800755", campaignName: "[NX27-GLITTERBOX] SIGNUP", adAccountId: "act_606252931141334", spend: 5, adSetIds: ["zz"] },
      ],
      events: [NX, EBR],
      adSetEvent: new Map(),
    });
    assert.deepEqual(row!.problems, []);
    assert.equal(row!.linkedVia, "meta_campaign_id");
  });

  it("ad sets on two events", () => {
    const [row] = checkCampaignLinks({
      campaigns: [{ campaignId: "c3", campaignName: "Glitterbox", adAccountId: null, spend: 1, adSetIds: ["a", "b"] }],
      events: [NX, EBR],
      adSetEvent: new Map([["a", "nx"], ["b", "ebr"]]),
    });
    assert.ok(row!.problems.includes("linked_to_two_events"));
  });
});

describe("duplicateCampaignClaims", () => {
  it("splits comma lists", () => {
    assert.deepEqual(splitCampaignIds("1, 2,3 x"), ["1", "2", "3"]);
  });

  it("flags an id two shows claim; one show's fixture rows sharing a code are counted apart", () => {
    const events: LinkCheckEvent[] = [
      { ...NX, metaCampaignId: "9,1" },
      { ...EBR, metaCampaignId: "9" },
      { ...NX, id: "wc1", code: "WC26-LEEDS", metaCampaignId: "7" },
      { ...NX, id: "wc2", code: "WC26-LEEDS", metaCampaignId: "7" },
    ];
    const result = duplicateCampaignClaims(events);
    assert.deepEqual(result.claims, [{ campaignId: "9", eventCodes: ["EBR27-GLITTERBOX", "NX27-GLITTERBOX"], events: 2 }]);
    assert.equal(result.sameCode, 1);
  });
});
