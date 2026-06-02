import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  fetchTikTokEventCampaignInsights,
  type FetchTikTokEventCampaignInsightsInput,
} from "../insights.ts";

type MockRequest = NonNullable<FetchTikTokEventCampaignInsightsInput["request"]>;

function baseInput(request: MockRequest): FetchTikTokEventCampaignInsightsInput {
  return {
    advertiserId: "advertiser-1",
    token: "token-1",
    eventCode: "BB26-RIANBRAZIL",
    window: { since: "2026-04-01", until: "2026-04-28" },
    request,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a mock integrated-report row
// ---------------------------------------------------------------------------
function reportRow(
  campaignId: string,
  metrics: Record<string, string>,
): object {
  return {
    dimensions: { campaign_id: campaignId, stat_time_day: "2026-04-10" },
    metrics,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a mock /campaign/get/ response
// ---------------------------------------------------------------------------
function campaignRow(id: string, name: string, goal: string): object {
  return { campaign_id: id, campaign_name: name, optimization_goal: goal };
}

// ---------------------------------------------------------------------------

describe("fetchTikTokEventCampaignInsights", () => {
  it("maps COMPLETE_REGISTRATION goal: Results = complete_registration, CPR = spend / results", async () => {
    const request: MockRequest = async <T>(
      path: string,
    ): Promise<T> => {
      if (path === "/report/integrated/get/") {
        return {
          list: [
            reportRow("campaign-1", {
              spend: "496.95",
              impressions: "264058",
              clicks: "0",
              complete_registration: "103",
              complete_payment: "0",
              view_content: "0",
              conversion: "103",
            }),
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      if (path === "/campaign/get/") {
        return {
          list: [
            campaignRow(
              "campaign-1",
              "[BB26-RIANBRAZIL] VENUE SIGNUP",
              "COMPLETE_REGISTRATION",
            ),
          ],
        } as T;
      }
      throw new Error(`Unexpected path ${path}`);
    };

    const rows = await fetchTikTokEventCampaignInsights(baseInput(request));

    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.results, 103);
    assert.equal(row.optimization_goal_label, "Registration");
    // CPR = 496.95 / 103 ≈ 4.824...
    assert.ok(row.cpr !== null, "CPR should not be null");
    assert.ok(
      Math.abs((row.cpr as number) - 496.95 / 103) < 0.001,
      `CPR ${row.cpr} should ≈ ${496.95 / 103}`,
    );
  });

  it("maps COMPLETE_PAYMENT goal: Results = complete_payment, CPR = spend / results", async () => {
    const request: MockRequest = async <T>(
      path: string,
    ): Promise<T> => {
      if (path === "/report/integrated/get/") {
        return {
          list: [
            reportRow("campaign-2", {
              spend: "2000",
              impressions: "50000",
              clicks: "400",
              complete_registration: "0",
              complete_payment: "12",
              view_content: "0",
              conversion: "12",
            }),
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      if (path === "/campaign/get/") {
        return {
          list: [
            campaignRow(
              "campaign-2",
              "[BB26-RIANBRAZIL] TICKET PURCHASE",
              "COMPLETE_PAYMENT",
            ),
          ],
        } as T;
      }
      throw new Error(`Unexpected path ${path}`);
    };

    const rows = await fetchTikTokEventCampaignInsights(baseInput(request));

    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.results, 12);
    assert.equal(row.optimization_goal_label, "Purchase");
    // CPR = 2000 / 12 ≈ 166.666...
    assert.ok(row.cpr !== null);
    assert.ok(
      Math.abs((row.cpr as number) - 2000 / 12) < 0.001,
      `CPR ${row.cpr} should ≈ ${2000 / 12}`,
    );
  });

  it("falls back to view_content for a REACH campaign → results = 0, CPR = null", async () => {
    const request: MockRequest = async <T>(
      path: string,
    ): Promise<T> => {
      if (path === "/report/integrated/get/") {
        return {
          list: [
            reportRow("campaign-3", {
              spend: "137.37",
              impressions: "2452",
              clicks: "0",
              complete_registration: "0",
              complete_payment: "0",
              view_content: "0",
              conversion: "0",
            }),
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      if (path === "/campaign/get/") {
        return {
          list: [
            campaignRow(
              "campaign-3",
              "[BB26-RIANBRAZIL] VENUE ENGAGEMENT",
              "REACH",
            ),
          ],
        } as T;
      }
      throw new Error(`Unexpected path ${path}`);
    };

    const rows = await fetchTikTokEventCampaignInsights(baseInput(request));

    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.results, 0);
    assert.equal(row.cpr, null, "CPR should be null when results = 0");
    assert.equal(row.optimization_goal_label, "Reach");
  });

  it("falls back to view_content when no optimization_goal is returned", async () => {
    const request: MockRequest = async <T>(
      path: string,
    ): Promise<T> => {
      if (path === "/report/integrated/get/") {
        return {
          list: [
            reportRow("campaign-4", {
              spend: "50",
              impressions: "5000",
              clicks: "20",
              view_content: "0",
              conversion: "0",
            }),
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      if (path === "/campaign/get/") {
        // No optimization_goal in the response
        return {
          list: [
            {
              campaign_id: "campaign-4",
              campaign_name: "[BB26-RIANBRAZIL] UNKNOWN GOAL",
            },
          ],
        } as T;
      }
      throw new Error(`Unexpected path ${path}`);
    };

    const rows = await fetchTikTokEventCampaignInsights(baseInput(request));

    assert.equal(rows.length, 1);
    const row = rows[0]!;
    // Fallback: view_content = 0, CPR = null (renders as —)
    assert.equal(row.results, 0);
    assert.equal(row.cpr, null);
    // Label should be the fallback
    assert.equal(row.optimization_goal_label, "View Content");
  });

  it("fetches optimization_goal via /campaign/get/ fields array", async () => {
    const calls: Array<{ path: string; params: Record<string, unknown> }> = [];
    const request: MockRequest = async <T>(
      path: string,
      params: Record<string, unknown>,
    ): Promise<T> => {
      calls.push({ path, params });
      if (path === "/report/integrated/get/") {
        return {
          list: [
            reportRow("campaign-5", {
              spend: "10",
              impressions: "100",
              clicks: "5",
              complete_registration: "3",
              view_content: "0",
              conversion: "3",
            }),
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      if (path === "/campaign/get/") {
        return {
          list: [
            campaignRow(
              "campaign-5",
              "[BB26-RIANBRAZIL] Registration",
              "COMPLETE_REGISTRATION",
            ),
          ],
        } as T;
      }
      throw new Error(`Unexpected path ${path}`);
    };

    await fetchTikTokEventCampaignInsights(baseInput(request));

    const campaignGetCall = calls.find((c) => c.path === "/campaign/get/");
    assert.ok(campaignGetCall, "/campaign/get/ should be called");
    const fields = campaignGetCall!.params.fields as string[];
    assert.ok(fields.includes("optimization_goal"), "fields should include optimization_goal");
    assert.ok(fields.includes("campaign_id"), "fields should include campaign_id");
    assert.ok(fields.includes("campaign_name"), "fields should include campaign_name");
  });

  it("filters against enriched campaign names with case-insensitive event_code matching", async () => {
    const request: MockRequest = async <T>(path: string): Promise<T> => {
      if (path === "/report/integrated/get/") {
        return {
          list: [
            reportRow("campaign-match", {
              spend: "10",
              impressions: "100",
              clicks: "10",
              complete_registration: "5",
              view_content: "0",
              conversion: "5",
            }),
            reportRow("campaign-other", {
              spend: "20",
              impressions: "200",
              clicks: "20",
              complete_payment: "2",
              view_content: "0",
              conversion: "2",
            }),
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      return {
        list: [
          {
            campaign_id: "campaign-match",
            campaign_name: "[bb26-rianbrazil] Lowercase code",
            optimization_goal: "COMPLETE_REGISTRATION",
          },
          {
            campaign_id: "campaign-other",
            campaign_name: "[OTHER-EVENT] Retargeting",
            optimization_goal: "COMPLETE_PAYMENT",
          },
        ],
      } as T;
    };

    const rows = await fetchTikTokEventCampaignInsights(baseInput(request));

    assert.deepEqual(
      rows.map((row) => row.id),
      ["campaign-match"],
    );
    assert.equal(rows[0]?.name, "[bb26-rianbrazil] Lowercase code");
  });

  it("keeps aggregated rows as '(unnamed)' when enrichment returns no campaigns", async () => {
    const request: MockRequest = async <T>(path: string): Promise<T> => {
      if (path === "/report/integrated/get/") {
        return {
          list: [
            reportRow("campaign-1", {
              spend: "10",
              impressions: "100",
              clicks: "10",
              view_content: "0",
              conversion: "0",
            }),
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      return { list: [] } as T;
    };

    const rows = await fetchTikTokEventCampaignInsights(baseInput(request));

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "campaign-1");
    assert.equal(rows[0]?.name, "(unnamed)");
  });
});
