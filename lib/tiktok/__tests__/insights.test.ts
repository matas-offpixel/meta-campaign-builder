import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  fetchTikTokEventCampaignInsights,
  type FetchTikTokEventCampaignInsightsInput,
} from "../insights.ts";
import { BASE_METRICS } from "../insights.ts";

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

  it("VIEW_CONTENT: Results = conversion count, not view_content total", async () => {
    const request: MockRequest = async <T>(path: string): Promise<T> => {
      if (path === "/report/integrated/get/") {
        return {
          list: [
            reportRow("campaign-vc", {
              spend: "496.95",
              impressions: "264058",
              clicks: "0",
              complete_registration: "108",
              view_content: "278105",
              conversion: "108",
            }),
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      if (path === "/campaign/get/") {
        return {
          list: [
            campaignRow(
              "campaign-vc",
              "[BB26-RIANBRAZIL] VENUE SIGNUP",
              "VIEW_CONTENT",
            ),
          ],
        } as T;
      }
      throw new Error(`Unexpected path ${path}`);
    };

    const rows = await fetchTikTokEventCampaignInsights(baseInput(request));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.results, 108);
    assert.equal(rows[0]!.optimization_goal_label, "View Content");
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

  // ── Per-goal metric routing ────────────────────────────────────────────────

  it("passes goal-specific metrics to /report/integrated/get/ for COMPLETE_REGISTRATION campaigns", async () => {
    const reportCalls: Array<{ metrics: string[] }> = [];
    const request: MockRequest = async <T>(
      path: string,
      params: Record<string, unknown>,
    ): Promise<T> => {
      if (path === "/campaign/get/") {
        // Return campaign goal before the report call (new architecture)
        return {
          list: [
            campaignRow("camp-r", "[BB26-RIANBRAZIL] Signup", "COMPLETE_REGISTRATION"),
          ],
        } as T;
      }
      if (path === "/report/integrated/get/") {
        reportCalls.push({ metrics: params.metrics as string[] });
        return {
          list: [
            reportRow("camp-r", {
              spend: "100",
              impressions: "5000",
              clicks: "50",
              complete_registration: "10",
              conversion: "10",
            }),
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      throw new Error(`Unexpected path ${path}`);
    };

    await fetchTikTokEventCampaignInsights(baseInput(request));

    assert.equal(reportCalls.length, 1, "should make exactly one report call");
    const metrics = reportCalls[0]!.metrics;
    // Must include the goal-specific extras
    assert.ok(metrics.includes("complete_registration"), "should include complete_registration");
    assert.ok(metrics.includes("cost_per_complete_registration"), "should include cost_per_complete_registration");
    // Must include all base metrics
    for (const base of BASE_METRICS) {
      assert.ok(metrics.includes(base), `should include base metric '${base}'`);
    }
    // Must NOT include wrong-goal metrics
    assert.ok(!metrics.includes("video_play"), "must NOT include deprecated video_play");
    assert.ok(!metrics.includes("add_to_cart"), "must NOT include add_to_cart for non-CART goal");
  });

  it("does NOT include pixel-event metrics in the report call for LEAD campaigns (Ironworks scenario)", async () => {
    const reportCalls: Array<{ metrics: string[] }> = [];
    const request: MockRequest = async <T>(
      path: string,
      params: Record<string, unknown>,
    ): Promise<T> => {
      if (path === "/campaign/get/") {
        return {
          list: [
            campaignRow("camp-lead-1", "[BB26-RIANBRAZIL] Awareness", "LEAD"),
            campaignRow("camp-lead-2", "[BB26-RIANBRAZIL] Retargeting", "LEAD"),
          ],
        } as T;
      }
      if (path === "/report/integrated/get/") {
        reportCalls.push({ metrics: params.metrics as string[] });
        return {
          list: [
            reportRow("camp-lead-1", { spend: "500", impressions: "10000", clicks: "200", conversion: "20" }),
            reportRow("camp-lead-2", { spend: "300", impressions: "6000", clicks: "90", conversion: "8" }),
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      throw new Error(`Unexpected path ${path}`);
    };

    const rows = await fetchTikTokEventCampaignInsights(baseInput(request));

    assert.equal(reportCalls.length, 1, "should make exactly one report call (both LEAD campaigns in same group)");
    const metrics = reportCalls[0]!.metrics;
    // LEAD uses 'conversion' from BASE_METRICS — no pixel extras needed
    assert.ok(!metrics.includes("video_play"), "must NOT include deprecated video_play");
    assert.ok(!metrics.includes("add_to_cart"), "must NOT include add_to_cart");
    assert.ok(!metrics.includes("complete_registration"), "must NOT include complete_registration");
    assert.ok(!metrics.includes("cost_per_complete_registration"), "must NOT include cost_per_complete_registration");
    assert.ok(metrics.includes("video_play_actions"), "must include correct video_play_actions");
    assert.ok(metrics.includes("conversion"), "must include generic conversion");

    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.results + rows[1]!.results, 28); // 20 + 8
  });

  it("makes separate report calls for campaigns with different optimization goals", async () => {
    const reportCalls: Array<{ metrics: string[] }> = [];
    const request: MockRequest = async <T>(
      path: string,
      params: Record<string, unknown>,
    ): Promise<T> => {
      if (path === "/campaign/get/") {
        return {
          list: [
            campaignRow("camp-reg", "[BB26-RIANBRAZIL] Signup", "COMPLETE_REGISTRATION"),
            campaignRow("camp-pay", "[BB26-RIANBRAZIL] Purchase", "COMPLETE_PAYMENT"),
          ],
        } as T;
      }
      if (path === "/report/integrated/get/") {
        reportCalls.push({ metrics: params.metrics as string[] });
        // Return the campaign that matches the goal group being fetched
        const metrics = params.metrics as string[];
        const isRegCall = metrics.includes("complete_registration");
        const isPayCall = metrics.includes("complete_payment");
        const list = [];
        if (isRegCall) {
          list.push(reportRow("camp-reg", { spend: "100", impressions: "5000", clicks: "20", complete_registration: "7", conversion: "7" }));
        }
        if (isPayCall) {
          list.push(reportRow("camp-pay", { spend: "800", impressions: "40000", clicks: "300", complete_payment: "3", conversion: "3" }));
        }
        return { list, page_info: { page: 1, total_page: 1 } } as T;
      }
      throw new Error(`Unexpected path ${path}`);
    };

    const rows = await fetchTikTokEventCampaignInsights(baseInput(request));

    assert.equal(reportCalls.length, 2, "should make 2 report calls — one per goal group");
    // Each call should include only its own goal's metrics
    const regCall = reportCalls.find((c) => c.metrics.includes("complete_registration"));
    const payCall = reportCalls.find((c) => c.metrics.includes("complete_payment"));
    assert.ok(regCall, "should have a COMPLETE_REGISTRATION call");
    assert.ok(payCall, "should have a COMPLETE_PAYMENT call");
    assert.ok(!regCall!.metrics.includes("complete_payment"), "registration call must not include payment metric");
    assert.ok(!payCall!.metrics.includes("complete_registration"), "payment call must not include registration metric");
    assert.ok(!regCall!.metrics.includes("video_play"), "registration call must not include deprecated video_play");
    assert.ok(!payCall!.metrics.includes("video_play"), "payment call must not include deprecated video_play");

    assert.equal(rows.length, 2);
    const regRow = rows.find((r) => r.id === "camp-reg");
    const payRow = rows.find((r) => r.id === "camp-pay");
    assert.equal(regRow?.results, 7);
    assert.equal(payRow?.results, 3);
  });
});
