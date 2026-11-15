/**
 * PR #1035 round 2:
 *   B2 — blockers ignore what the writer will not re-send (pushed rows)
 *   S1 — cap cells with comma decimals, £, "Phase N:" labels, > £20
 *   S2 — exact negative vs phrase/broad keyword is a warning
 *   S3 — the merged single campaign takes its budget from the plan at push
 *   S4 — merged single-campaign cap spread warning
 *   notes — orphaned ad-group negatives drop; preflight daily is Σ campaigns
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import * as XLSX from "xlsx";

import { pushGoogleSearchPlan } from "../../google-ads/campaign-writer.ts";
import type { GoogleAdsCustomerCredentials } from "../../google-ads/client.ts";
import { toGoogleSearchPlanDraftTree } from "../../plan/derive/google.ts";
import { plannedDailySpend, resolveCampaignDailyBudgets } from "../budget.ts";
import { campaignPushPreview } from "../push-preview.ts";
import { REVIEW_WARNING_CODES, hasHardErrors, validateGoogleSearchPlan } from "../validation.ts";
import { parseCpcCapCell, parseGoogleSearchPlanXlsx } from "../xlsx-import.ts";
import type {
  GoogleSearchAdGroupNode,
  GoogleSearchCampaignNode,
  GoogleSearchMatchType,
  GoogleSearchNegative,
  GoogleSearchPlanTree,
} from "../types.ts";
import { APPETITE, CAMELPHAT, hydrate, parseFixture } from "./_hydrate-draft.ts";

const NOW = "2026-10-08T00:00:00Z";
const CUSTOMER_ID = "7932800197";
const CREDS: GoogleAdsCustomerCredentials = {
  customerId: "793-280-0197",
  refreshToken: "refresh",
  loginCustomerId: "333-703-8088",
};

function adGroup(
  id: string,
  keywords: Array<{ text: string; match?: GoogleSearchMatchType; pushed?: boolean }>,
  pushed: boolean,
): GoogleSearchAdGroupNode {
  return {
    id,
    campaign_id: "c-1",
    name: `AG ${id}`,
    default_cpc: null,
    sort_order: 0,
    pushed_resource_name: pushed ? `customers/${CUSTOMER_ID}/adGroups/${id}` : null,
    created_at: NOW,
    keywords: keywords.map((k, i) => ({
      id: `${id}-kw-${i}`,
      ad_group_id: id,
      keyword: k.text,
      match_type: k.match ?? "PHRASE",
      est_cpc_low: null,
      est_cpc_high: null,
      intent: null,
      notes: null,
      pushed_resource_name: k.pushed ? `customers/${CUSTOMER_ID}/adGroupCriteria/${id}~${i}` : null,
      created_at: NOW,
    })),
    rsas: [
      {
        id: `${id}-rsa`,
        ad_group_id: id,
        headlines: [{ text: "CamelPhat Ironworks" }, { text: "Tickets On Sale" }, { text: "24 Oct London" }],
        descriptions: [{ text: "CamelPhat live at Ironworks." }, { text: "Book before it sells out." }],
        final_url: "https://example.com/camelphat",
        path1: null,
        path2: null,
        pushed_resource_name: pushed ? `customers/${CUSTOMER_ID}/adGroupAds/${id}` : null,
        created_at: NOW,
      },
    ],
  };
}

function negative(keyword: string, overrides: Partial<GoogleSearchNegative> = {}): GoogleSearchNegative {
  return {
    id: `neg-${keyword}`,
    plan_id: "plan-1",
    campaign_id: null,
    ad_group_id: null,
    keyword,
    match_type: "PHRASE",
    reason: null,
    pushed_resource_name: null,
    created_at: NOW,
    ...overrides,
  };
}

/** CamelPhat-shaped pushed plan: no total, one pushed campaign with no daily budget. */
function pushedPlan(): GoogleSearchPlanTree {
  const campaign: GoogleSearchCampaignNode = {
    id: "c-1",
    plan_id: "plan-1",
    name: "[IRW0004] CP | Search | C1 Brand-Event-Venue",
    priority: null,
    monthly_budget: null,
    daily_budget: null,
    bid_adjustments: { max_cpc_cap: 0.8 },
    notes: null,
    sort_order: 0,
    pushed_resource_name: `customers/${CUSTOMER_ID}/campaigns/1`,
    created_at: NOW,
    negatives: [],
    ad_groups: [adGroup("ag-live", [{ text: "camelphat ironworks", pushed: true }], true)],
  };
  return {
    plan: {
      id: "plan-1",
      user_id: "user-1",
      event_id: null,
      google_ads_account_id: "acct-1",
      name: "CamelPhat",
      status: "pushed",
      total_budget: null,
      daily_budget: null,
      pacing: "even",
      bidding_strategy: "maximize_clicks",
      structure_mode: "campaign_per_theme",
      geo_targets: [
        { location: "London", bid_modifier_pct: null, resolved_resource_name: "geoTargetConstants/1006886" },
      ],
      geo_target_type: "PRESENCE",
      date_range: { since: "2099-10-07", until: "2099-10-24" },
      pushed_at: NOW,
      created_at: NOW,
      updated_at: NOW,
    },
    campaigns: [campaign],
    plan_negatives: [negative("free", { pushed_resource_name: `customers/${CUSTOMER_ID}/adGroupCriteria/ag-live~free` })],
    sitelinks: [],
  };
}

function fakeClient() {
  let seq = 1;
  const calls: Array<{ resource: string; operations: unknown[] }> = [];
  const client = {
    async mutate(_creds: GoogleAdsCustomerCredentials, resource: string, operations: unknown[]) {
      calls.push({ resource, operations });
      return { results: operations.map(() => ({ resourceName: `customers/${CUSTOMER_ID}/${resource}/${seq++}` })) };
    },
    async suggestGeoTargetConstants(_rt: string, names: string[]) {
      return names.map(() => null);
    },
  };
  return { client: client as never, calls };
}

// ─── B2: pushed rows do not block a re-push ───────────────────────────

describe("re-push of an already-pushed plan", () => {
  it("a pushed campaign with no daily budget and no plan total re-pushes cleanly with a new ad group", async () => {
    const tree = pushedPlan();
    tree.campaigns[0].ad_groups.push(adGroup("ag-new", [{ text: "camelphat tickets" }], false));

    const issues = validateGoogleSearchPlan(tree);
    assert.equal(issues.some((i) => i.code === "budget_fallback_daily"), false);
    assert.equal(hasHardErrors(issues), false, JSON.stringify(issues.filter((i) => i.severity === "error")));

    const { client, calls } = fakeClient();
    const summary = await pushGoogleSearchPlan({ tree, credentials: CREDS, eventCode: "IRW0004", client });
    assert.equal(summary.ok, true, JSON.stringify(summary.campaignsFailed.concat(summary.adGroupsFailed)));
    const resources = calls.map((c) => c.resource);
    assert.equal(resources.includes("campaignBudgets"), false, "no budget is re-sent");
    assert.equal(resources.includes("campaigns"), false, "no campaign is re-sent");
    assert.equal(calls.filter((c) => c.resource === "adGroups").length, 1, "only the new ad group");
  });

  it("an unpushed campaign with no budget still hits the £5 blocker", () => {
    const tree = pushedPlan();
    tree.campaigns[0].pushed_resource_name = null;
    assert.ok(validateGoogleSearchPlan(tree).some((i) => i.code === "budget_fallback_daily" && i.severity === "error"));
  });

  it("a conflict already live on Google (pushed negative, pushed keyword) is not a blocker", () => {
    const tree = pushedPlan();
    tree.plan_negatives = [negative("camelphat", { pushed_resource_name: "customers/1/adGroupCriteria/x" })];
    assert.equal(validateGoogleSearchPlan(tree).some((i) => i.code === "negative_blocks_keyword"), false);
  });

  it("a new negative that would block a live keyword is still a blocker", () => {
    const tree = pushedPlan();
    tree.plan_negatives = [negative("camelphat")];
    assert.ok(validateGoogleSearchPlan(tree).some((i) => i.code === "negative_blocks_keyword" && i.severity === "error"));
  });

  it("a new keyword under a live negative in a live ad group is still a blocker", () => {
    const tree = pushedPlan();
    tree.plan_negatives = [negative("tickets", { pushed_resource_name: "customers/1/adGroupCriteria/y" })];
    tree.campaigns[0].ad_groups[0].keywords.push({
      ...tree.campaigns[0].ad_groups[0].keywords[0],
      id: "kw-new",
      keyword: "camelphat tickets",
      pushed_resource_name: null,
    });
    assert.ok(validateGoogleSearchPlan(tree).some((i) => i.code === "negative_blocks_keyword"));
  });

  it("a live negative does not reach a new ad group, so its keywords are not blocked", () => {
    const tree = pushedPlan();
    tree.plan_negatives = [negative("tickets", { pushed_resource_name: "customers/1/adGroupCriteria/y" })];
    tree.campaigns[0].ad_groups.push(adGroup("ag-new", [{ text: "camelphat tickets" }], false));
    assert.equal(validateGoogleSearchPlan(tree).some((i) => i.code === "negative_blocks_keyword"), false);
  });

  it("overspend on budgets already live is a warning, not a blocker", () => {
    const tree = pushedPlan();
    tree.plan.total_budget = 50;
    tree.campaigns[0].daily_budget = 10; // £10 × 18 days = £180 vs £50
    const issue = validateGoogleSearchPlan(tree).find((i) => i.code === "budget_exceeds_plan");
    assert.equal(issue?.severity, "warning");
    assert.ok(REVIEW_WARNING_CODES.has("budget_exceeds_plan"));
  });
});

// ─── S1: cap cells ────────────────────────────────────────────────────

describe("CPC cap cell parsing", () => {
  it("comma decimals", () => {
    assert.deepEqual(parseCpcCapCell("0,80"), [0.8]);
    assert.deepEqual(parseCpcCapCell("£0,80 → £1,10"), [0.8, 1.1]);
  });
  it("Phase labels are not numbers", () => {
    assert.deepEqual(parseCpcCapCell("Phase 1: 0.80 → Phase 2: 1.10"), [0.8, 1.1]);
  });

  function workbookWithCap(cap: string): Uint8Array {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Campaign", "Ad Group", "Keyword", "Match Type"],
        ["C1 Brand", "Brand", "camelphat ironworks", "Exact"],
      ]),
      "Keywords",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Campaign", "Status", "Bid strategy", "Cap (£) A → B"],
        ["C1 Brand", "Enabled", "Maximise Clicks", cap],
      ]),
      "3 Campaigns",
    );
    return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  }

  it("imports a comma-decimal cap as pounds", () => {
    const tree = parseGoogleSearchPlanXlsx(workbookWithCap("£0,80 → £1,10"), { structureMode: "campaign_per_theme" });
    assert.equal(tree.campaigns[0].bid_adjustments.max_cpc_cap, 0.8);
    assert.deepEqual(tree.campaigns[0].bid_adjustments.max_cpc_cap_phases, [0.8, 1.1]);
  });

  it("rejects a cap over £20 with a warning and stores nothing", () => {
    const tree = parseGoogleSearchPlanXlsx(workbookWithCap("80"), { structureMode: "campaign_per_theme" });
    assert.equal(tree.campaigns[0].bid_adjustments.max_cpc_cap, undefined);
    assert.equal(tree.campaigns[0].ad_groups[0].default_cpc, null);
    assert.ok(tree.warnings.some((w) => /max CPC cap "80" is over £20\.00 — not stored/.test(w.message)));
  });
});

// ─── S2: exact negative vs phrase/broad keyword ───────────────────────

describe("exact negative severity", () => {
  function treeWith(keywordMatch: GoogleSearchMatchType): GoogleSearchPlanTree {
    const tree = pushedPlan();
    tree.campaigns[0].pushed_resource_name = null;
    tree.campaigns[0].daily_budget = 5;
    tree.campaigns[0].ad_groups = [adGroup("ag-1", [{ text: "camelphat tickets", match: keywordMatch }], false)];
    tree.plan_negatives = [negative("camelphat tickets", { match_type: "EXACT" })];
    return tree;
  }

  it("against a phrase keyword it is a warning — longer queries still serve", () => {
    const issues = validateGoogleSearchPlan(treeWith("PHRASE"));
    assert.equal(issues.some((i) => i.code === "negative_blocks_keyword"), false);
    const warning = issues.find((i) => i.code === "negative_blocks_exact_query");
    assert.equal(warning?.severity, "warning");
    assert.match(warning!.message, /blocks the exact query "camelphat tickets" — keyword still serves longer queries/);
  });

  it("against a broad keyword it is a warning", () => {
    const issues = validateGoogleSearchPlan(treeWith("BROAD"));
    assert.equal(issues.find((i) => i.code === "negative_blocks_exact_query")?.severity, "warning");
  });

  it("against an exact keyword it is a blocker — the keyword never serves", () => {
    const issues = validateGoogleSearchPlan(treeWith("EXACT"));
    assert.equal(issues.find((i) => i.code === "negative_blocks_keyword")?.severity, "error");
  });
});

// ─── S3: merged single campaign budget follows the plan ───────────────

describe("single-campaign budget follows the plan", () => {
  it("the merged campaign has no daily budget of its own; editing the plan total changes push", () => {
    const tree = hydrate(parseFixture(CAMELPHAT, "single_campaign"));
    assert.equal(tree.campaigns[0].daily_budget, null);
    assert.equal(resolveCampaignDailyBudgets(tree)[0].micros, 27_780_000); // £500 / 18 days
    tree.plan.total_budget = 900;
    assert.equal(resolveCampaignDailyBudgets(tree)[0].micros, 50_000_000);
    assert.equal(campaignPushPreview(tree)[0].daily, "£50.00");
  });
});

// ─── S4: merged cap spread ────────────────────────────────────────────

describe("single-campaign cap spread", () => {
  it("names the themes whose own cap is far below the merged ceiling", () => {
    const tree = hydrate(parseFixture(APPETITE, "single_campaign"));
    const issue = validateGoogleSearchPlan(tree).find((i) => i.code === "merged_cap_spread");
    assert.equal(issue?.severity, "warning");
    // Ceiling £1.30 (C5); C1 £0.70 and C3 £0.80 are > 50% below it; C2 £1.10 and C4 £0.90 are not.
    assert.match(
      issue!.message,
      /C1 Brand-Event-Venue, C3 Halloween-Longtail-Theme ad groups will bid up to £1\.30 — use one campaign per theme to keep £0\.70 \/ £0\.80\./,
    );
    assert.equal(hasHardErrors([issue!]), false);
  });

  it("no warning when the caps are within 50%", () => {
    const tree = hydrate(parseFixture(APPETITE, "single_campaign"));
    tree.campaigns[0].bid_adjustments = {
      ...tree.campaigns[0].bid_adjustments,
      max_cpc_cap_by_campaign: { a: 1.0, b: 1.4 },
    };
    assert.equal(validateGoogleSearchPlan(tree).some((i) => i.code === "merged_cap_spread"), false);
  });
});

// ─── Notes: orphaned ad-group negatives, preflight daily ──────────────

describe("orphaned ad-group negatives", () => {
  it("derive drops them with a warning instead of widening to the campaign", () => {
    const tree = pushedPlan();
    tree.campaigns[0].negatives = [
      negative("fisher", { campaign_id: "c-1", ad_group_id: "ag-gone" }),
      negative("jobs", { campaign_id: "c-1" }),
    ];
    const draft = toGoogleSearchPlanDraftTree(tree);
    const keywords = draft.negatives.map((n) => `${n.keyword}:${n.scope.kind}`);
    assert.deepEqual(keywords, ["free:plan", "jobs:campaign"]);
    assert.ok(draft.warnings.some((w) => /"fisher" belonged to an ad group no longer in the plan/.test(w.message)));
  });
});

describe("preflight daily budget", () => {
  it("is Σ serving campaigns, not the first campaign", () => {
    const tree = hydrate(parseFixture(APPETITE, "campaign_per_theme"));
    for (const c of tree.campaigns) c.daily_budget = 10;
    assert.equal(plannedDailySpend(tree), 40); // C5 is Paused in the sheet
  });
});
