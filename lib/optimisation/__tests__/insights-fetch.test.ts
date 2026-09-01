/**
 * Tests for lib/optimisation/insights-fetch.ts — task #120 PR A.
 *
 * Run: node --test lib/optimisation/__tests__/insights-fetch.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchCampaignAdSetInsights,
  fetchCampaignBudgetInsights,
  isCboAdSetRoster,
  type OptimisationGraphFetcher,
  type OptimisationNodeFetcher,
} from "../insights-fetch.ts";

describe("fetchCampaignAdSetInsights", () => {
  it("parses budget, status, and metrics from a single field-expansion response", async () => {
    const calls: { path: string; params: Record<string, string> }[] = [];
    const fetcher: OptimisationGraphFetcher = async (path, params) => {
      calls.push({ path, params });
      return {
        data: [
          {
            id: "adset_1",
            name: "Newcastle 25-45",
            daily_budget: "5000",
            effective_status: "ACTIVE",
            insights: {
              data: [
                {
                  impressions: "12000",
                  cpc: "0.32",
                  cpm: "4.5",
                  ctr: "1.8",
                  actions: [{ action_type: "landing_page_view", value: "40" }],
                  cost_per_action_type: [
                    { action_type: "offsite_conversion.fb_pixel_complete_registration", value: "1.25" },
                  ],
                },
              ],
            },
          },
        ],
      } as never;
    };

    const rows = await fetchCampaignAdSetInsights(fetcher, "camp_1", "tok", "24h");

    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      adsetId: "adset_1",
      adsetName: "Newcastle 25-45",
      dailyBudgetPence: 5000,
      lifetimeBudgetPence: null,
      effectiveStatus: "ACTIVE",
      impressions: 12000,
      cpc: 0.32,
      cpm: 4.5,
      ctr: 1.8,
      costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 1.25 },
    });

    assert.equal(calls[0].path, "/camp_1/adsets");
    assert.match(calls[0].params.fields, /insights\.date_preset\(yesterday\)/);
  });

  it("maps every RuleTimeWindow to the right date_preset", async () => {
    const seenPresets: string[] = [];
    const fetcher: OptimisationGraphFetcher = async (_path, params) => {
      const match = /date_preset\((\w+)\)/.exec(params.fields);
      seenPresets.push(match?.[1] ?? "none");
      return { data: [] } as never;
    };
    await fetchCampaignAdSetInsights(fetcher, "camp_1", "tok", "24h");
    await fetchCampaignAdSetInsights(fetcher, "camp_1", "tok", "3d");
    await fetchCampaignAdSetInsights(fetcher, "camp_1", "tok", "7d");
    assert.deepEqual(seenPresets, ["yesterday", "last_3d", "last_7d"]);
  });

  it("handles an ad set with no daily_budget (CBO) as null, not 0", async () => {
    const fetcher: OptimisationGraphFetcher = async () =>
      ({
        data: [{ id: "adset_2", effective_status: "ACTIVE" }],
      }) as never;
    const rows = await fetchCampaignAdSetInsights(fetcher, "camp_1", "tok", "24h");
    assert.equal(rows[0].dailyBudgetPence, null);
    assert.equal(rows[0].impressions, 0);
  });

  it("follows pagination cursors across multiple pages", async () => {
    let call = 0;
    const fetcher: OptimisationGraphFetcher = async (_path, params) => {
      call += 1;
      if (call === 1) {
        assert.equal(params.after, undefined);
        return { data: [{ id: "adset_a" }], paging: { cursors: { after: "cursor_2" } } } as never;
      }
      assert.equal(params.after, "cursor_2");
      return { data: [{ id: "adset_b" }] } as never;
    };
    const rows = await fetchCampaignAdSetInsights(fetcher, "camp_1", "tok", "24h");
    assert.deepEqual(rows.map((r) => r.adsetId), ["adset_a", "adset_b"]);
    assert.equal(call, 2);
  });
});

describe("fetchCampaignBudgetInsights", () => {
  it("reads campaign daily_budget and Meta-reported campaign insights (not a sum)", async () => {
    const fetcher: OptimisationNodeFetcher = async (path, params, token) => {
      assert.equal(path, "/camp_dod");
      assert.equal(token, "tok");
      assert.match(params.fields, /daily_budget/);
      assert.match(params.fields, /lifetime_budget/);
      assert.match(params.fields, /insights\.date_preset\(yesterday\)/);
      return {
        id: "camp_dod",
        daily_budget: "15000",
        insights: {
          data: [
            {
              impressions: "12000",
              cost_per_action_type: [{ action_type: "landing_page_view", value: "0.18" }],
            },
          ],
        },
      } as never;
    };
    const row = await fetchCampaignBudgetInsights(fetcher, "camp_dod", "tok", "24h");
    assert.equal(row.dailyBudgetPence, 15000);
    assert.equal(row.lifetimeBudgetPence, null);
    assert.equal(row.impressions, 12000);
    assert.equal(row.costPerActionType.landing_page_view, 0.18);
  });
});

describe("isCboAdSetRoster", () => {
  it("is true only when every ad set lacks daily_budget", () => {
    assert.equal(
      isCboAdSetRoster([
        {
          adsetId: "a",
          adsetName: "A",
          dailyBudgetPence: null,
          lifetimeBudgetPence: null,
          effectiveStatus: "ACTIVE",
          impressions: 0,
          cpc: null,
          cpm: null,
          ctr: null,
          costPerActionType: {},
        },
      ]),
      true,
    );
    assert.equal(
      isCboAdSetRoster([
        {
          adsetId: "a",
          adsetName: "A",
          dailyBudgetPence: 1000,
          lifetimeBudgetPence: null,
          effectiveStatus: "ACTIVE",
          impressions: 0,
          cpc: null,
          cpm: null,
          ctr: null,
          costPerActionType: {},
        },
      ]),
      false,
    );
  });
});
