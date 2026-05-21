import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  hasHardErrors,
  validateGoogleSearchPlan,
  validateGoogleSearchStep,
} from "../validation.ts";
import type {
  GoogleSearchAdGroupNode,
  GoogleSearchCampaignNode,
  GoogleSearchNegative,
  GoogleSearchPlanTree,
  GoogleSearchRsa,
} from "../types.ts";

// ─── Fixture helpers ──────────────────────────────────────────────────

function makeRsa(headlineLengths: number[], descLengths: number[]): GoogleSearchRsa {
  return {
    id: "rsa-1",
    ad_group_id: "ag-1",
    headlines: headlineLengths.map((n) => ({ text: "x".repeat(n), pin_position: null })),
    descriptions: descLengths.map((n) => ({ text: "y".repeat(n), pin_position: null })),
    final_url: "https://example.com",
    path1: null,
    path2: null,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
  };
}

function makeAdGroup(
  id: string,
  keywords: Array<{ keyword: string; id?: string }>,
  rsas: GoogleSearchRsa[] = [makeRsa([15, 15, 15], [40, 40])],
): GoogleSearchAdGroupNode {
  return {
    id,
    campaign_id: "c-1",
    name: `Ad group ${id}`,
    default_cpc: null,
    sort_order: 0,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
    keywords: keywords.map((k, i) => ({
      id: k.id ?? `kw-${i}`,
      ad_group_id: id,
      keyword: k.keyword,
      match_type: "PHRASE",
      est_cpc_low: null,
      est_cpc_high: null,
      intent: null,
      notes: null,
      pushed_resource_name: null,
      created_at: "2026-05-21T00:00:00Z",
    })),
    rsas,
  };
}

function makeCampaign(
  id: string,
  name: string,
  adGroups: GoogleSearchAdGroupNode[],
  options: { monthly_budget?: number; negatives?: GoogleSearchNegative[] } = {},
): GoogleSearchCampaignNode {
  return {
    id,
    plan_id: "p-1",
    name,
    priority: null,
    monthly_budget: options.monthly_budget ?? null,
    daily_budget: null,
    bid_adjustments: {},
    notes: null,
    sort_order: 0,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
    ad_groups: adGroups,
    negatives: options.negatives ?? [],
  };
}

function makeTree(overrides: Partial<GoogleSearchPlanTree["plan"]> = {}): GoogleSearchPlanTree {
  return {
    plan: {
      id: "p-1",
      user_id: "u-1",
      event_id: null,
      google_ads_account_id: "acct-1",
      name: "Test plan",
      status: "draft",
      total_budget: 1000,
      bidding_strategy: "maximize_clicks",
      geo_targets: [],
      date_range: null,
      pushed_at: null,
      created_at: "2026-05-21T00:00:00Z",
      updated_at: "2026-05-21T00:00:00Z",
      ...overrides,
    },
    campaigns: [],
    plan_negatives: [],
  };
}

function makePlanNegative(
  keyword: string,
  id = `neg-${keyword}`,
): GoogleSearchNegative {
  return {
    id,
    plan_id: "p-1",
    campaign_id: null,
    keyword,
    match_type: "PHRASE",
    reason: null,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
  };
}

// ─── Char-limit validation ────────────────────────────────────────────

describe("validateGoogleSearchPlan — char limits", () => {
  it("flags headlines over 30 chars as errors", () => {
    const tree = makeTree();
    tree.campaigns = [
      makeCampaign("c-1", "C1", [
        makeAdGroup("ag-1", [{ keyword: "kw" }], [
          makeRsa([15, 31, 28], [40, 40]),
        ]),
      ]),
    ];

    const issues = validateGoogleSearchPlan(tree);
    const overflow = issues.find((i) => i.code === "headline_too_long");
    assert.ok(overflow, "expected headline_too_long error");
    assert.equal(overflow.severity, "error");
  });

  it("flags descriptions over 90 chars as errors", () => {
    const tree = makeTree();
    tree.campaigns = [
      makeCampaign("c-1", "C1", [
        makeAdGroup("ag-1", [{ keyword: "kw" }], [
          makeRsa([15, 15, 15], [40, 91]),
        ]),
      ]),
    ];

    const issues = validateGoogleSearchPlan(tree);
    assert.ok(issues.some((i) => i.code === "description_too_long"));
  });

  it("flags RSAs with fewer than 3 headlines as errors", () => {
    const tree = makeTree();
    tree.campaigns = [
      makeCampaign("c-1", "C1", [
        makeAdGroup("ag-1", [{ keyword: "kw" }], [makeRsa([15, 15], [40, 40])]),
      ]),
    ];

    const issues = validateGoogleSearchPlan(tree);
    assert.ok(issues.some((i) => i.code === "rsa_too_few_headlines"));
  });

  it("flags RSAs with fewer than 2 descriptions as errors", () => {
    const tree = makeTree();
    tree.campaigns = [
      makeCampaign("c-1", "C1", [
        makeAdGroup("ag-1", [{ keyword: "kw" }], [makeRsa([15, 15, 15], [40])]),
      ]),
    ];

    const issues = validateGoogleSearchPlan(tree);
    assert.ok(issues.some((i) => i.code === "rsa_too_few_descriptions"));
  });

  it("passes a well-formed RSA", () => {
    const tree = makeTree();
    tree.campaigns = [
      makeCampaign("c-1", "C1", [
        makeAdGroup("ag-1", [{ keyword: "tickets" }], [makeRsa([15, 15, 15], [40, 40])]),
      ]),
    ];

    const issues = validateGoogleSearchPlan(tree).filter((i) => i.severity === "error");
    assert.equal(issues.length, 0, JSON.stringify(issues, null, 2));
  });
});

// ─── Conflict detection: keyword cannibalised by negative ─────────────

describe("validateGoogleSearchPlan — conflict detection", () => {
  it("warns when a keyword exactly matches a plan-scoped negative", () => {
    const tree = makeTree();
    tree.plan_negatives = [makePlanNegative("free tickets")];
    tree.campaigns = [
      makeCampaign("c-1", "C1", [
        makeAdGroup("ag-1", [{ keyword: "free tickets" }, { keyword: "real tickets" }]),
      ]),
    ];

    const issues = validateGoogleSearchPlan(tree);
    const conflict = issues.find((i) => i.code === "keyword_cannibalised_by_negative");
    assert.ok(conflict, "expected cannibalisation warning");
    assert.equal(conflict.severity, "warning");
    assert.match(conflict.message, /free tickets/);
  });

  it("warns when a keyword matches a campaign-scoped negative", () => {
    const tree = makeTree();
    const negative: GoogleSearchNegative = {
      id: "neg-1",
      plan_id: "p-1",
      campaign_id: "c-1",
      keyword: "promo",
      match_type: "PHRASE",
      reason: null,
      pushed_resource_name: null,
      created_at: "2026-05-21T00:00:00Z",
    };
    tree.campaigns = [
      makeCampaign(
        "c-1",
        "C1",
        [makeAdGroup("ag-1", [{ keyword: "Promo" /* case-insensitive match */ }])],
        { negatives: [negative] },
      ),
    ];

    const issues = validateGoogleSearchPlan(tree);
    assert.ok(issues.some((i) => i.code === "keyword_cannibalised_by_negative"));
  });

  it("warns when a campaign has no negatives at all", () => {
    const tree = makeTree();
    tree.campaigns = [
      makeCampaign("c-1", "C1", [makeAdGroup("ag-1", [{ keyword: "tickets" }])]),
    ];
    const issues = validateGoogleSearchPlan(tree);
    assert.ok(issues.some((i) => i.code === "campaign_no_negatives" && i.severity === "warning"));
  });
});

// ─── Plan-wide rules ──────────────────────────────────────────────────

describe("validateGoogleSearchPlan — plan-wide rules", () => {
  it("requires an ads account before push", () => {
    const tree = makeTree({ google_ads_account_id: null });
    tree.campaigns = [
      makeCampaign("c-1", "C1", [
        makeAdGroup("ag-1", [{ keyword: "kw" }], [makeRsa([15, 15, 15], [40, 40])]),
      ]),
    ];
    const issues = validateGoogleSearchPlan(tree);
    assert.ok(issues.some((i) => i.code === "google_ads_account_missing"));
  });

  it("errors when budgets sum above plan total", () => {
    const tree = makeTree({ total_budget: 100 });
    tree.campaigns = [
      makeCampaign(
        "c-1",
        "C1",
        [makeAdGroup("ag-1", [{ keyword: "kw" }], [makeRsa([15, 15, 15], [40, 40])])],
        { monthly_budget: 80 },
      ),
      makeCampaign(
        "c-2",
        "C2",
        [makeAdGroup("ag-2", [{ keyword: "kw" }], [makeRsa([15, 15, 15], [40, 40])])],
        { monthly_budget: 80 },
      ),
    ];
    const issues = validateGoogleSearchPlan(tree);
    assert.ok(issues.some((i) => i.code === "budget_over_allocated" && i.severity === "error"));
  });

  it("warns when budgets sum under 50% of plan total", () => {
    const tree = makeTree({ total_budget: 1000 });
    tree.campaigns = [
      makeCampaign(
        "c-1",
        "C1",
        [makeAdGroup("ag-1", [{ keyword: "kw" }], [makeRsa([15, 15, 15], [40, 40])])],
        { monthly_budget: 100 },
      ),
    ];
    const issues = validateGoogleSearchPlan(tree);
    assert.ok(issues.some((i) => i.code === "budget_under_allocated" && i.severity === "warning"));
  });

  it("errors when a campaign has zero keywords", () => {
    const tree = makeTree();
    tree.campaigns = [makeCampaign("c-1", "C1", [makeAdGroup("ag-1", [])])];
    const issues = validateGoogleSearchPlan(tree);
    assert.ok(issues.some((i) => i.code === "campaign_no_keywords" && i.severity === "error"));
  });
});

// ─── Step gating ──────────────────────────────────────────────────────

describe("validateGoogleSearchStep — per-step gating", () => {
  it("step 0 requires plan name + ads account", () => {
    const tree = makeTree({ google_ads_account_id: null, name: "" });
    const issues = validateGoogleSearchStep(0, tree);
    const codes = issues.map((i) => i.code).sort();
    assert.deepEqual(codes, ["google_ads_account_missing", "plan_name_missing"]);
  });

  it("step 1 requires at least one campaign", () => {
    const tree = makeTree();
    const issues = validateGoogleSearchStep(1, tree);
    assert.ok(issues.some((i) => i.code === "no_campaigns"));
  });

  it("step 2 requires every campaign to have keywords", () => {
    const tree = makeTree();
    tree.campaigns = [makeCampaign("c-1", "C1", [makeAdGroup("ag-1", [])])];
    const issues = validateGoogleSearchStep(2, tree);
    assert.ok(issues.some((i) => i.code === "campaign_no_keywords"));
  });

  it("step 6 (Review) returns hard errors only", () => {
    const tree = makeTree();
    tree.campaigns = [
      makeCampaign("c-1", "C1", [
        makeAdGroup("ag-1", [{ keyword: "tickets" }], [makeRsa([15, 15, 15], [40, 40])]),
      ]),
    ];
    const issues = validateGoogleSearchStep(6, tree);
    assert.ok(issues.every((i) => i.severity === "error"), JSON.stringify(issues));
  });
});

// ─── hasHardErrors ───────────────────────────────────────────────────

describe("hasHardErrors", () => {
  it("returns true when any error exists", () => {
    assert.equal(hasHardErrors([{ severity: "error", code: "x", message: "bad" }]), true);
  });
  it("returns false when only warnings exist", () => {
    assert.equal(hasHardErrors([{ severity: "warning", code: "x", message: "soft" }]), false);
  });
  it("returns false on empty list", () => {
    assert.equal(hasHardErrors([]), false);
  });
});
