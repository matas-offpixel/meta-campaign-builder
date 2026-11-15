/**
 * HE1 + HE3 panels per dashboard view: which shows a view covers, and the
 * campaigns' own counts for PI1's comparison.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { campaignCountsFor, type MetaStoredRow, type Owned } from "../../audience-breakdowns/read.ts";
import { buildAudiencePanels, rateHref, scopesForViews, type PanelShow } from "../audience-panels.ts";

const SHOWS: PanelShow[] = [
  { id: "e1", code: "NX26-LOCKLEAD", name: "Locklead", venue_key: "nx newcastle" },
  { id: "e2", code: "NX26-AZYR", name: "AZYR", venue_key: "nx newcastle" },
  { id: "e3", code: "EBR26-KREAM", name: "Kream", venue_key: "electric brixton" },
  { id: "e4", code: null, name: "No code", venue_key: null },
];
const VENUES = [
  { key: "nx newcastle", name: "NX Newcastle", viewId: "venue:nx newcastle" },
  { key: "electric brixton", name: "Electric Brixton", viewId: "venue:electric brixton" },
];

function metaRow(over: Partial<Owned<MetaStoredRow>>): Owned<MetaStoredRow> {
  return {
    meta_campaign_id: "c1",
    date: "2026-11-01",
    breakdown: "age_gender",
    age: "18-24",
    gender: "female",
    region: "",
    event_id: "e1",
    owner_event_id: "e1",
    campaign_name: null,
    spend: 10,
    impressions: 1000,
    clicks: 10,
    link_clicks: 5,
    registrations: 3,
    purchases: 1,
    purchase_value: 20,
    ...over,
  };
}

describe("audience panels · views", () => {
  it("maps all, venue and show views to their shows", () => {
    const scopes = scopesForViews(["all", "venue:nx newcastle", "venue:unset", "nx26-locklead", "ebr26-kream", "missing"], VENUES, SHOWS, "Electric Group");
    assert.deepEqual(scopes.get("all")!.eventIds, ["e1", "e2", "e3", "e4"]);
    assert.equal(scopes.get("all")!.d2c.kind, "client");
    assert.deepEqual(scopes.get("venue:nx newcastle")!.eventIds, ["e1", "e2"]);
    assert.deepEqual(scopes.get("venue:unset")!.eventIds, ["e4"]);
    assert.deepEqual(scopes.get("nx26-locklead")!.eventIds, ["e1"]);
    assert.equal(scopes.get("nx26-locklead")!.d2c.label, "Locklead");
    assert.equal(scopes.has("missing"), false);
  });

  it("builds both panels for each view, from one read", () => {
    const meta = [
      metaRow({}),
      metaRow({ meta_campaign_id: "c2", owner_event_id: "e3", event_id: "e3", spend: 5, registrations: 1 }),
    ];
    const panels = buildAudiencePanels(
      {
        clientId: "c1",
        clientName: "Electric Group",
        shows: SHOWS,
        breakdowns: { meta, tiktok: [] },
        campaignDays: [
          { id: "d1", meta_campaign_id: "c1", date: "2026-11-01", spend: 10, registrations: 2, purchases: 1 },
          { id: "d2", meta_campaign_id: "c2", date: "2026-11-01", spend: 5, registrations: 1, purchases: 0 },
        ],
        d2c: { rows: [], rate: { rate: null, currency: "GBP" }, shows: [], unattributed: 0 },
      },
      { viewIds: ["all", "nx26-locklead", "ebr26-kream"], venues: VENUES },
      "internal",
    );
    assert.equal(panels["nx26-locklead"]!.reach.metaSays.totalsNote, "Meta models its split by age, so these add to 3 signups; the campaigns count 2.");
    assert.equal(panels["ebr26-kream"]!.reach.metaSays.totalsNote, "Meta models its split by age, so these add to 1 purchase; the campaigns count 0.");
    assert.equal(panels.all!.reach.metaSays.total.signupsText, "4");
    assert.equal(panels.all!.d2c.empty, "No direct-to-fan sends yet");
    assert.equal(rateHref("c1"), "/clients/c1?tab=d2c");
  });
});

describe("campaignCountsFor (PI1's comparison)", () => {
  it("sums the campaigns' own counts for the same campaigns over the days the rows span", () => {
    const meta = [metaRow({ date: "2026-11-01" }), metaRow({ date: "2026-11-03" }), metaRow({ breakdown: "region", meta_campaign_id: "region-only", date: "2026-11-09" })];
    const counts = campaignCountsFor(meta, [
      { id: "a", meta_campaign_id: "c1", date: "2026-10-31", spend: 100, registrations: 9, purchases: 9 },
      { id: "b", meta_campaign_id: "c1", date: "2026-11-01", spend: "10.01", registrations: "2", purchases: "1" },
      { id: "c", meta_campaign_id: "c1", date: "2026-11-03", spend: 4, registrations: 1, purchases: 0 },
      { id: "d", meta_campaign_id: "other", date: "2026-11-02", spend: 50, registrations: 5, purchases: 5 },
      { id: "e", meta_campaign_id: "region-only", date: "2026-11-09", spend: 7, registrations: 7, purchases: 7 },
    ]);
    assert.deepEqual(counts, { spend: 14.01, signups: 3, purchases: 1 });
    assert.equal(campaignCountsFor([], []), null);
  });
});
