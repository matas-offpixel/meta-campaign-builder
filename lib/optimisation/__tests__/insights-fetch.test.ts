/**
 * Tests for lib/optimisation/insights-fetch.ts — task #120 PR A.
 *
 * Run: node --test lib/optimisation/__tests__/insights-fetch.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchCampaignAdSetInsights, type OptimisationGraphFetcher } from "../insights-fetch.ts";

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
      effectiveStatus: "ACTIVE",
      impressions: 12000,
      cpc: 0.32,
      cpm: 4.5,
      ctr: 1.8,
      costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 1.25 },
    });

    assert.equal(calls[0].path, "/camp_1/adsets");
    assert.match(calls[0].params.fields, /insights\.date_preset\(last_1d\)/);
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
    assert.deepEqual(seenPresets, ["last_1d", "last_3d", "last_7d"]);
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
