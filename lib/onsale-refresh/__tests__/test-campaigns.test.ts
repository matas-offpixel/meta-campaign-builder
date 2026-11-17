/**
 * TT8 (2026-11-17-creative-testing-5): the show's test campaigns are never main. The
 * refresh gives "{code} · Tests", "{code} · AB copy test" and "{code} · Artist cards test"
 * no proposal (no pause, drop or move) and never takes one as the Purchase plan's main
 * campaign, while their spend still counts in the event's spend to date.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildEventInputs, type Aux, type EventRow, type InsightRow, type RawInsights } from "../load.ts";
import { ONSALE_PHASE } from "../phase-config.ts";
import { buildProposal } from "../rules.ts";

const EVENT = { id: "e1", name: "Puzzle 4th Birthday", event_code: "P26-BDAY", event_date: "2026-12-27", general_sale_at: "2026-10-30T12:00:00Z", presale_at: null, status: "on_sale", client_id: "c1", budget_marketing: 4500, drive_folder_id: null, signup_url: null, ticket_url: null, venue_country: "GB" } as unknown as EventRow;
const DAYS = ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"];

function rows(campaign: string, prefix: string, spend: number, ic: number): InsightRow[] {
  return DAYS.flatMap((date) =>
    [1, 2].map((n) => ({
      meta_ad_id: `${prefix}-ad-${n}`,
      meta_adset_id: `${prefix}-as`,
      meta_campaign_id: `${prefix}-c`,
      ad_account_id: "act_1",
      date,
      ad_name: `${prefix} ad ${n}`,
      adset_name: `${prefix} ad set`,
      campaign_name: campaign,
      spend: n === 1 ? spend : spend / 4,
      landing_page_views: 10,
      purchases: 0,
      actions: [{ action_type: "omni_initiated_checkout", value: String(n === 1 ? ic : 0) }],
      promoted_event: "INITIATED_CHECKOUT",
      optimization_goal: "OFFSITE_CONVERSIONS",
      video_plays_3s: 0,
    })),
  ) as unknown as InsightRow[];
}

function raw(): RawInsights {
  // The test campaigns spend the most, so a refresh that read them as main would pick them.
  const all = [
    ...rows("[P26-BDAY] Puzzle - On Sale", "main", 20, 3),
    ...rows("P26-BDAY · Tests", "tests", 40, 6),
    ...rows("P26-BDAY · AB copy test", "ab", 35, 5),
    ...rows("P26-BDAY · Artist cards test", "cards", 30, 4),
  ];
  const link = { clientId: "c1", eventId: "e1" };
  return { rows: all, context: { launchedAds: new Map(), launchedAdSets: new Map(["main-as", "tests-as", "ab-as", "cards-as"].map((id) => [id, link])), codedEvents: [] } } as unknown as RawInsights;
}

const AUX = { scores: [], clusters: [], launchedAdSets: [], warnings: [], ticketing: [], driveFolders: [], renderDriveIds: new Set<string>() } as unknown as Aux;

describe("TT8: the refresh never treats a test campaign as main", () => {
  it("builds no campaign input for the Tests campaign or the round's two, so they get no pause, drop or move", async () => {
    const inputs = await buildEventInputs({ event: EVENT, day: "2026-11-18", shadow: true, config: ONSALE_PHASE, raw: raw(), aux: AUX, drive: null });
    assert.deepEqual(inputs.campaigns.map((c) => c.campaignKey), ["[P26-BDAY] Puzzle - On Sale"]);
    for (const campaign of inputs.campaigns) {
      const proposal = buildProposal(campaign, ONSALE_PHASE);
      const touched = proposal.lines.flatMap((line) => JSON.stringify(line).match(/tests-|ab-|cards-/g) ?? []);
      assert.deepEqual(touched, [], "no line names a test ad set or ad");
    }
  });

  it("the Purchase plan's main campaign is the show's own, and the test campaigns' spend still counts to date", async () => {
    const inputs = await buildEventInputs({ event: EVENT, day: "2026-11-18", shadow: true, config: ONSALE_PHASE, raw: raw(), aux: AUX, drive: null });
    const main = inputs.campaigns[0]!;
    assert.equal(main.purchaseCampaign?.isMain, true);
    assert.equal(main.purchaseCampaign?.budget.main?.campaignKey, "[P26-BDAY] Puzzle - On Sale");
    // Every row up to the window's end (17 Nov): 14 days × (20 + 5 + 40 + 10 + 35 + 8.75 + 30 + 7.5).
    assert.equal(Math.round(main.spendToDateGbp * 100) / 100, Math.round(14 * (25 + 50 + 43.75 + 37.5) * 100) / 100);
  });

  it("without an event code nothing is filtered (no code, no test campaign name to match)", async () => {
    const inputs = await buildEventInputs({ event: { ...EVENT, event_code: null } as EventRow, day: "2026-11-18", shadow: true, config: ONSALE_PHASE, raw: raw(), aux: AUX, drive: null });
    assert.equal(inputs.campaigns.length, 4);
  });
});
