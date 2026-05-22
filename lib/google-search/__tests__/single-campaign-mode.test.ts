/**
 * Tests for single-campaign structure mode.
 *
 * Covers:
 *  1. Parser: single_campaign mode produces 1 campaign with N ad groups
 *  2. Parser: campaign_per_theme mode is unchanged (regression guard)
 *  3. restructureAsSingleCampaign: ad group naming, C-code prefix extraction
 *  4. Negatives: campaign-scoped negatives promoted to plan-scoped in single-campaign mode
 *  5. Push adapter: single-campaign tree → 1 campaigns:mutate + N adGroups:mutate
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import * as XLSX from "xlsx";

import {
  parseGoogleSearchPlanXlsx,
  restructureAsSingleCampaign,
} from "../xlsx-import.ts";
import { pushGoogleSearchPlan } from "../../google-ads/campaign-writer.ts";
import type {
  GoogleSearchNegativeDraft,
  GoogleSearchCampaignDraftNode,
  GoogleSearchImportWarning,
  GoogleSearchPlanTree,
} from "../types.ts";
import type { GoogleAdsCustomerCredentials } from "../../google-ads/client.ts";

// ─── Shared fixture ───────────────────────────────────────────────────

/**
 * Mini J2-style workbook with 3 campaigns:
 *   C1 Brand Defence  → 1 ad group "Brand"
 *   C2 Adam Beyer     → 2 ad groups "Adam Beyer Tickets", "Drumcode London"
 *   C3 Miss Monique   → 1 ad group "Miss Monique"
 */
function buildMultiCampaignWorkbook(): Uint8Array {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Campaign", "Ad Group", "Keyword", "Match Type"],
      ["C1 Brand Defence", "Brand", "junction 2 melodic", "Exact"],
      ["C1 Brand Defence", "Brand", "junction 2 tickets", "Phrase"],
      ["C2 Adam Beyer", "Adam Beyer Tickets", "adam beyer london", "Phrase"],
      ["C2 Adam Beyer", "Adam Beyer Tickets", "adam beyer tickets", "Broad"],
      ["C2 Adam Beyer", "Drumcode London", "drumcode london", "Phrase"],
      ["C3 Miss Monique", "Miss Monique", "miss monique tickets", "Exact"],
    ]),
    "Keywords",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Campaign", "Type", "Content"],
      ["C1 Brand Defence", "H1", "Junction 2 Melodic"],
      ["C1 Brand Defence", "H2", "Tickets On Sale"],
      ["C1 Brand Defence", "H3", "Official Page"],
      ["C1 Brand Defence", "D1", "Get tickets now."],
      ["C1 Brand Defence", "D2", "Don't miss out."],
      ["C2 Adam Beyer", "H1", "Adam Beyer Live"],
      ["C2 Adam Beyer", "H2", "London Tickets"],
      ["C2 Adam Beyer", "H3", "Buy Now"],
      ["C2 Adam Beyer", "D1", "Catch Adam Beyer live."],
      ["C2 Adam Beyer", "D2", "Selling fast."],
      ["C3 Miss Monique", "H1", "Miss Monique Live"],
      ["C3 Miss Monique", "H2", "London Show"],
      ["C3 Miss Monique", "H3", "Buy Tickets"],
      ["C3 Miss Monique", "D1", "Miss Monique comes to London."],
      ["C3 Miss Monique", "D2", "Don't miss it."],
    ]),
    "Ad Copy",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Scope", "Negative Keyword", "Match Type", "Reason"],
      ["All", "free", "Exact", "Filter freeloaders"],
      ["C2 Adam Beyer", "stream", "Broad", "Filter streaming"],
      ["C1 Brand Defence", "event", "Exact", "Filter generic"],
    ]),
    "Negative Keywords",
  );

  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

// ─── 1. Parser: single_campaign mode ─────────────────────────────────

describe("parseGoogleSearchPlanXlsx — single_campaign mode (default)", () => {
  const buf = buildMultiCampaignWorkbook();

  it("default mode is single_campaign", () => {
    const tree = parseGoogleSearchPlanXlsx(buf);
    assert.equal(tree.plan.structure_mode, "single_campaign");
  });

  it("produces exactly ONE campaign", () => {
    const tree = parseGoogleSearchPlanXlsx(buf);
    assert.equal(tree.campaigns.length, 1, "should produce exactly 1 campaign");
  });

  it("preserves all ad groups as children of the single campaign, with C-code prefix", () => {
    const tree = parseGoogleSearchPlanXlsx(buf);
    const adGroupNames = tree.campaigns[0].ad_groups.map((ag) => ag.name);
    // C1 → 1 ad group, C2 → 2 ad groups, C3 → 1 ad group = 4 total
    assert.equal(adGroupNames.length, 4);
    assert.ok(adGroupNames.includes("C1 – Brand"), `expected 'C1 – Brand', got ${adGroupNames.join(", ")}`);
    assert.ok(adGroupNames.includes("C2 – Adam Beyer Tickets"));
    assert.ok(adGroupNames.includes("C2 – Drumcode London"));
    assert.ok(adGroupNames.includes("C3 – Miss Monique"));
  });

  it("keywords stay attached to the correct (prefixed) ad group", () => {
    const tree = parseGoogleSearchPlanXlsx(buf);
    const brandAg = tree.campaigns[0].ad_groups.find((ag) => ag.name === "C1 – Brand");
    assert.ok(brandAg, "C1 – Brand ad group should exist");
    assert.equal(brandAg!.keywords.length, 2, "Brand ad group should have 2 keywords");

    const drm = tree.campaigns[0].ad_groups.find((ag) => ag.name === "C2 – Drumcode London");
    assert.ok(drm, "C2 – Drumcode London ad group should exist");
    assert.equal(drm!.keywords.length, 1, "Drumcode London should have 1 keyword");
  });

  it("RSAs stay attached to the correct ad group", () => {
    const tree = parseGoogleSearchPlanXlsx(buf);
    const beyerAg = tree.campaigns[0].ad_groups.find((ag) => ag.name === "C2 – Adam Beyer Tickets");
    assert.ok(beyerAg);
    assert.equal(beyerAg!.rsas.length, 1);
    assert.ok(beyerAg!.rsas[0].headlines.some((h) => h.text === "Adam Beyer Live"));
  });

  it("campaign name defaults to the plan name", () => {
    const tree = parseGoogleSearchPlanXlsx(buf, {
      fallbackPlanName: "Test Plan",
      structureMode: "single_campaign",
    });
    assert.equal(tree.campaigns[0].name, "Test Plan");
  });
});

// ─── 2. Parser: campaign_per_theme mode — regression guard ────────────

describe("parseGoogleSearchPlanXlsx — campaign_per_theme mode (regression guard)", () => {
  const buf = buildMultiCampaignWorkbook();
  const tree = parseGoogleSearchPlanXlsx(buf, { structureMode: "campaign_per_theme" });

  it("produces 3 separate campaigns (one per C-code)", () => {
    assert.equal(tree.campaigns.length, 3);
    const names = tree.campaigns.map((c) => c.name).sort();
    assert.deepEqual(names, ["C1 Brand Defence", "C2 Adam Beyer", "C3 Miss Monique"]);
  });

  it("plan.structure_mode is campaign_per_theme", () => {
    assert.equal(tree.plan.structure_mode, "campaign_per_theme");
  });

  it("C2 retains its two original ad groups unchanged", () => {
    const c2 = tree.campaigns.find((c) => c.name === "C2 Adam Beyer")!;
    const agNames = c2.ad_groups.map((ag) => ag.name).sort();
    assert.deepEqual(agNames, ["Adam Beyer Tickets", "Drumcode London"]);
  });
});

// ─── 3. restructureAsSingleCampaign — unit tests ─────────────────────

function makeCampaignDraft(name: string, adGroupNames: string[]): GoogleSearchCampaignDraftNode {
  return {
    name,
    priority: null,
    monthly_budget: null,
    daily_budget: null,
    bid_adjustments: {},
    notes: null,
    sort_order: 0,
    ad_groups: adGroupNames.map((n, i) => ({
      name: n,
      default_cpc: null,
      sort_order: i,
      keywords: [{ keyword: "test kw", match_type: "EXACT" as const, est_cpc_low: null, est_cpc_high: null, intent: null, notes: null }],
      rsas: [],
    })),
  };
}

describe("restructureAsSingleCampaign", () => {
  const campaigns: GoogleSearchCampaignDraftNode[] = [
    makeCampaignDraft("C1 Brand", ["Brand"]),
    makeCampaignDraft("C2 Adam Beyer", ["Adam Beyer Tickets", "Drumcode London"]),
    makeCampaignDraft("C3 Miss Monique", ["Miss Monique"]),
    makeCampaignDraft("No Prefix Campaign", ["General"]),
  ];

  const negatives: GoogleSearchNegativeDraft[] = [
    { keyword: "free", match_type: "EXACT", reason: null, scope: { kind: "plan" } },
    { keyword: "stream", match_type: "BROAD", reason: null, scope: { kind: "campaign", campaign_name: "C2 Adam Beyer" } },
    { keyword: "event", match_type: "EXACT", reason: null, scope: { kind: "campaign", campaign_name: "C1 Brand" } },
  ];
  const warnings: GoogleSearchImportWarning[] = [];

  const { campaign, negatives: _mergedNegatives } = restructureAsSingleCampaign(
    campaigns,
    negatives,
    "Test Plan",
    warnings,
  );

  it("produces ad groups with C-code prefix", () => {
    const names = campaign.ad_groups.map((ag) => ag.name);
    assert.ok(names.includes("C1 – Brand"));
    assert.ok(names.includes("C2 – Adam Beyer Tickets"));
    assert.ok(names.includes("C2 – Drumcode London"));
    assert.ok(names.includes("C3 – Miss Monique"));
  });

  it("falls back to campaign name prefix when no C-code is present", () => {
    const names = campaign.ad_groups.map((ag) => ag.name);
    assert.ok(names.includes("No Prefix Campaign – General"));
  });

  it("has 4 ad groups in total (1 + 2 + 1 + 1)", () => {
    assert.equal(campaign.ad_groups.length, 5); // 4 campaigns, 5 ad groups total
  });

  it("campaign name is the planName", () => {
    assert.equal(campaign.name, "Test Plan");
  });

  it("keywords are preserved on the correct ad group", () => {
    const brandAg = campaign.ad_groups.find((ag) => ag.name === "C1 – Brand");
    assert.ok(brandAg);
    assert.equal(brandAg!.keywords.length, 1);
    assert.equal(brandAg!.keywords[0].keyword, "test kw");
  });

  it("ad groups have sequential sort_order", () => {
    for (let i = 0; i < campaign.ad_groups.length; i++) {
      assert.equal(campaign.ad_groups[i].sort_order, i);
    }
  });
});

// ─── 4. Negatives: campaign-scoped negatives promoted in single-campaign mode ─

describe("single-campaign mode — negatives promotion", () => {
  const buf = buildMultiCampaignWorkbook();
  const tree = parseGoogleSearchPlanXlsx(buf, { structureMode: "single_campaign" });

  it("all negatives are plan-scoped (no campaign-scoped remain)", () => {
    const campaignScoped = tree.negatives.filter((n) => n.scope.kind === "campaign");
    assert.equal(
      campaignScoped.length,
      0,
      "no campaign-scoped negatives should survive in single-campaign mode",
    );
  });

  it("promoted negatives are still present (keyword content preserved)", () => {
    const keywords = tree.negatives.map((n) => n.keyword);
    // 'stream' and 'event' were originally campaign-scoped — they should be promoted to plan
    assert.ok(keywords.includes("stream"), "promoted 'stream' negative should be present");
    assert.ok(keywords.includes("event"), "promoted 'event' negative should be present");
    assert.ok(keywords.includes("free"), "original plan-scoped 'free' should be present");
  });

  it("emits campaign_negative_promoted_to_plan warnings for each promotion", () => {
    const promoted = tree.warnings.filter((w) => w.code === "campaign_negative_promoted_to_plan");
    assert.equal(promoted.length, 2, "should emit 2 promotion warnings (stream + event)");
  });
});

// ─── 5. Push adapter: single-campaign tree ────────────────────────────

const CREDS: GoogleAdsCustomerCredentials = {
  customerId: "793-280-0197",
  refreshToken: "refresh",
  loginCustomerId: "333-703-8088",
};
const CUSTOMER_ID = "7932800197";

function makeSingleCampaignTree(): GoogleSearchPlanTree {
  const planId = "00000000-0000-0000-0000-000000000000";
  const campaignId = "00000000-0000-0000-0000-000000000001";

  const makeAg = (id: string, name: string, kwId: string, rsaId: string) => ({
    id,
    campaign_id: campaignId,
    name,
    default_cpc: null,
    sort_order: 0,
    pushed_resource_name: null,
    created_at: new Date().toISOString(),
    keywords: [{
      id: kwId,
      ad_group_id: id,
      keyword: `${name} keyword`,
      match_type: "PHRASE" as const,
      est_cpc_low: null,
      est_cpc_high: null,
      intent: null,
      notes: null,
      pushed_resource_name: null,
      created_at: new Date().toISOString(),
    }],
    rsas: [{
      id: rsaId,
      ad_group_id: id,
      headlines: [{ text: "H1" }, { text: "H2" }, { text: "H3" }],
      descriptions: [{ text: "D1" }, { text: "D2" }],
      final_url: "https://example.com",
      path1: null,
      path2: null,
      pushed_resource_name: null,
      created_at: new Date().toISOString(),
    }],
  });

  return {
    plan: {
      id: planId,
      user_id: "user-1",
      name: "Test Single Campaign Plan",
      status: "draft",
      structure_mode: "single_campaign",
      event_id: null,
      google_ads_account_id: "acct-1",
      total_budget: 1000,
      bidding_strategy: "maximize_clicks",
      geo_targets: [],
      geo_target_type: "PRESENCE",
      date_range: null,
      pushed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    campaigns: [{
      id: campaignId,
      plan_id: planId,
      name: "[UTB0043] Search",
      priority: null,
      monthly_budget: null,
      daily_budget: 1,
      bid_adjustments: {},
      notes: null,
      sort_order: 0,
      pushed_resource_name: null,
      created_at: new Date().toISOString(),
      negatives: [],
      ad_groups: [
        makeAg(
          "00000000-0000-0000-0000-000000000010",
          "C1 – Brand",
          "00000000-0000-0000-0000-000000000011",
          "00000000-0000-0000-0000-000000000012",
        ),
        makeAg(
          "00000000-0000-0000-0000-000000000020",
          "C2 – Adam Beyer Tickets",
          "00000000-0000-0000-0000-000000000021",
          "00000000-0000-0000-0000-000000000022",
        ),
        makeAg(
          "00000000-0000-0000-0000-000000000030",
          "C3 – Miss Monique",
          "00000000-0000-0000-0000-000000000031",
          "00000000-0000-0000-0000-000000000032",
        ),
      ],
    }],
    plan_negatives: [],
  } as unknown as GoogleSearchPlanTree;
}

type SuggestResult = {
  resourceName: string;
  displayName: string;
  countryCode: string | null;
  targetType: string | null;
} | null;

function makePushClient() {
  let seq = 1000;
  const calls: Array<{ resource: string; operations: unknown[] }> = [];
  const client = {
    async mutate(
      _creds: GoogleAdsCustomerCredentials,
      resource: string,
      operations: unknown[],
      _opts = {},
    ) {
      calls.push({ resource, operations });
      return { results: operations.map(() => ({ resourceName: `customers/${CUSTOMER_ID}/${resource}/${seq++}` })) };
    },
    async suggestGeoTargetConstants(_rt: string, names: string[]): Promise<SuggestResult[]> {
      return names.map(() => null);
    },
  };
  return { client: client as never, calls };
}

describe("push adapter — single-campaign mode", () => {
  it("issues exactly ONE campaigns:mutate for a single-campaign plan", async () => {
    const { client, calls } = makePushClient();
    const summary = await pushGoogleSearchPlan({
      tree: makeSingleCampaignTree(),
      credentials: CREDS,
      eventCode: "UTB0043",
      client,
    });

    const campaignMutates = calls.filter((c) => c.resource === "campaigns");
    assert.equal(campaignMutates.length, 1, "should issue exactly 1 campaigns:mutate");
    assert.ok(summary.ok, `push should succeed; errors: ${summary.campaignsFailed.map(f => f.error).join(", ")}`);
  });

  it("issues N adGroups:mutate calls (one per ad group)", async () => {
    const { client, calls } = makePushClient();
    await pushGoogleSearchPlan({
      tree: makeSingleCampaignTree(),
      credentials: CREDS,
      eventCode: "UTB0043",
      client,
    });

    const agMutates = calls.filter((c) => c.resource === "adGroups");
    // 3 ad groups, each pushed in its own mutate call
    assert.equal(agMutates.length, 3, "should push all 3 ad groups");
  });

  it("campaign name in the push is prefixed with event code", async () => {
    const { client, calls } = makePushClient();
    await pushGoogleSearchPlan({
      tree: makeSingleCampaignTree(),
      credentials: CREDS,
      eventCode: "UTB0043",
      client,
    });

    const campaignCreate = (calls[1].operations[0] as { create: Record<string, unknown> }).create;
    assert.ok(
      (campaignCreate.name as string).includes("UTB0043"),
      `campaign name should include event code; got: ${campaignCreate.name}`,
    );
  });

  it("adapter needs zero changes — structure_mode is transparent to the mutate chain", async () => {
    // The push adapter loops campaigns → ad_groups. A single-campaign tree
    // with N ad groups is handled identically to a 1-campaign subset of a
    // multi-campaign tree. This test confirms the adapter is structure-mode-agnostic.
    const { client, calls } = makePushClient();
    const tree = makeSingleCampaignTree();

    // Verify the tree really is single-campaign
    assert.equal(tree.campaigns.length, 1);
    assert.equal(tree.campaigns[0].ad_groups.length, 3);

    await pushGoogleSearchPlan({ tree, credentials: CREDS, eventCode: "UTB0043", client });

    // Expected mutate chain: campaignBudgets → campaigns → adGroups(x3) → adGroupCriteria(x3) → adGroupAds(x3)
    const resources = calls.map((c) => c.resource);
    assert.ok(resources.includes("campaignBudgets"), "budget mutate expected");
    assert.ok(resources.includes("campaigns"), "campaign mutate expected");
    assert.equal(resources.filter((r) => r === "adGroups").length, 3, "3 ad group mutates expected");
  });
});
