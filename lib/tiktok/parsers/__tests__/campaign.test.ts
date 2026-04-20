import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseCampaignSheet } from "../campaign.ts";

describe("parseCampaignSheet", () => {
  it("happy path — single campaign row", () => {
    const rows = [
      [
        "Campaign name",
        "Primary status",
        "Cost",
        "Impressions",
        "CPM",
        "Reach",
        "Cost per 1,000 people reached",
        "Frequency",
        "Clicks (all)",
        "CTR (all)",
        "Clicks (destination)",
        "CPC (destination)",
        "CTR (destination)",
      ],
      [
        "[BB26-RIANBRAZIL]",
        "Active",
        "£1,234.56",
        "100,000",
        "£12.35",
        "75,000",
        "£16.46",
        "1.33",
        "5,000",
        "5.00%",
        "1,200",
        "£1.03",
        "1.20%",
      ],
    ];
    const out = parseCampaignSheet(rows);
    assert.ok(out, "expected a result");
    assert.equal(out!.campaign_name, "[BB26-RIANBRAZIL]");
    assert.equal(out!.primary_status, "Active");
    assert.equal(out!.cost, 1234.56);
    assert.equal(out!.impressions, 100000);
    assert.equal(out!.impressions_raw, null);
    assert.equal(out!.cpm, 12.35);
    assert.equal(out!.reach, 75000);
    assert.equal(out!.cost_per_1000_reached, 16.46);
    assert.equal(out!.frequency, 1.33);
    assert.equal(out!.clicks_all, 5000);
    assert.equal(out!.ctr_all, 5);
    assert.equal(out!.clicks_destination, 1200);
    assert.equal(out!.cpc_destination, 1.03);
    assert.equal(out!.ctr_destination, 1.2);
    assert.equal(out!.currency, "GBP");
    assert.equal(out!.objective, null);
    assert.equal(out!.budget_mode, null);
  });

  it("masked impressions — preserves '<5' and skips total row", () => {
    const rows = [
      ["Campaign name", "Primary status", "Cost", "Impressions"],
      ["Total of 1 result", "", "£0", "0"],
      ["[XYZ]", "Paused", "£0.50", "<5"],
    ];
    const out = parseCampaignSheet(rows);
    assert.ok(out);
    assert.equal(out!.campaign_name, "[XYZ]");
    assert.equal(out!.impressions, null);
    assert.equal(out!.impressions_raw, "<5");
  });

  it("returns null when sheet is empty / has no data rows", () => {
    assert.equal(parseCampaignSheet([]), null);
    assert.equal(
      parseCampaignSheet([["Campaign name", "Cost"]]),
      null,
    );
  });
});
