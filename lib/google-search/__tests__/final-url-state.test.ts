import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  collectPlanFinalUrlState,
  finalUrlBlockReason,
  isPushableRsa,
  isValidLandingUrl,
} from "../final-url-state.ts";
import type {
  GoogleSearchPlanTree,
  GoogleSearchRsa,
} from "../types.ts";

function rsa(overrides: Partial<GoogleSearchRsa> = {}): GoogleSearchRsa {
  return {
    id: "rsa-1",
    ad_group_id: "ag-1",
    headlines: [],
    descriptions: [],
    final_url: null,
    path1: null,
    path2: null,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
    ...overrides,
  };
}

function tree(rsas: GoogleSearchRsa[]): GoogleSearchPlanTree {
  return {
    plan: {
      id: "plan-1",
      user_id: "user-1",
      event_id: null,
      google_ads_account_id: null,
      name: "Plan",
      status: "draft",
      total_budget: null,
      bidding_strategy: "maximize_clicks",
      geo_targets: [],
      geo_target_type: "PRESENCE",
      date_range: null,
      pushed_at: null,
      created_at: "2026-05-21T00:00:00Z",
      updated_at: "2026-05-21T00:00:00Z",
    },
    campaigns: [
      {
        id: "c-1",
        plan_id: "plan-1",
        name: "C1",
        priority: null,
        monthly_budget: null,
        daily_budget: 1,
        bid_adjustments: {},
        notes: null,
        sort_order: 0,
        pushed_resource_name: null,
        created_at: "2026-05-21T00:00:00Z",
        negatives: [],
        ad_groups: [
          {
            id: "ag-1",
            campaign_id: "c-1",
            name: "AG1",
            default_cpc: null,
            sort_order: 0,
            pushed_resource_name: null,
            created_at: "2026-05-21T00:00:00Z",
            keywords: [],
            rsas,
          },
        ],
      },
    ],
    plan_negatives: [],
  };
}

describe("isValidLandingUrl", () => {
  it("accepts http / https", () => {
    assert.equal(isValidLandingUrl("https://offpixel.com"), true);
    assert.equal(isValidLandingUrl("http://example.org/path?q=1"), true);
  });
  it("rejects empty / non-URL / mailto / javascript", () => {
    assert.equal(isValidLandingUrl(""), false);
    assert.equal(isValidLandingUrl("offpixel.com"), false);
    assert.equal(isValidLandingUrl("mailto:foo@bar.com"), false);
    assert.equal(isValidLandingUrl("javascript:alert(1)"), false);
  });
});

describe("collectPlanFinalUrlState", () => {
  it("returns shared URL when every RSA matches", () => {
    const url = "https://offpixel.com/event";
    const state = collectPlanFinalUrlState(
      tree([rsa({ final_url: url }), rsa({ id: "rsa-2", final_url: url })]),
    );
    assert.equal(state.shared, url);
    assert.equal(state.mixed, false);
    assert.equal(state.missingCount, 0);
  });

  it("flags mixed RSAs (different URLs) by setting shared=null + mixed=true", () => {
    const state = collectPlanFinalUrlState(
      tree([
        rsa({ final_url: "https://a.com" }),
        rsa({ id: "rsa-2", final_url: "https://b.com" }),
      ]),
    );
    assert.equal(state.shared, null);
    assert.equal(state.mixed, true);
  });

  it("counts missing / invalid / http RSAs separately", () => {
    const state = collectPlanFinalUrlState(
      tree([
        rsa({ id: "rsa-missing", final_url: null }),
        rsa({ id: "rsa-invalid", final_url: "not-a-url" }),
        rsa({ id: "rsa-http", final_url: "http://insecure.com" }),
        rsa({ id: "rsa-good", final_url: "https://offpixel.com" }),
      ]),
    );
    assert.equal(state.missingCount, 1);
    assert.equal(state.invalidCount, 1);
    assert.equal(state.httpCount, 1);
    assert.equal(state.totalRsas, 4);
  });
});

describe("isPushableRsa + finalUrlBlockReason", () => {
  it("isPushableRsa true for https; false for null/invalid", () => {
    assert.equal(isPushableRsa(rsa({ final_url: "https://offpixel.com" })), true);
    assert.equal(isPushableRsa(rsa({ final_url: null })), false);
    assert.equal(isPushableRsa(rsa({ final_url: "not-a-url" })), false);
  });

  it("finalUrlBlockReason returns null for valid URLs", () => {
    assert.equal(finalUrlBlockReason(rsa({ final_url: "https://offpixel.com" })), null);
  });

  it("finalUrlBlockReason explains null URLs", () => {
    const reason = finalUrlBlockReason(rsa({ final_url: null }));
    assert.ok(reason && reason.toLowerCase().includes("no final url"));
  });

  it("finalUrlBlockReason explains invalid URLs and includes the bad value", () => {
    const reason = finalUrlBlockReason(rsa({ final_url: "ftp://x" }));
    assert.ok(reason && reason.includes("ftp://x"));
  });
});
