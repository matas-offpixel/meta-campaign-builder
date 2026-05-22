/**
 * Unit tests for Phase 6 additions to:
 *  - lib/google-search/geo-targets-codec.ts  (resolved_* fields)
 *  - pushGoogleSearchPlan geo adapter (pre-resolved IDs skip suggest)
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  parseGeoTargetsColumn,
  serializeGeoTargetsColumn,
} from "../../google-search/geo-targets-codec.ts";
import { pushGoogleSearchPlan } from "../campaign-writer.ts";
import type { GoogleAdsCustomerCredentials, GoogleAdsClient } from "../client.ts";
import type { GoogleSearchPlanTree } from "../../google-search/types.ts";

// ─── Codec tests ──────────────────────────────────────────────────────

describe("geo-targets-codec — resolved_resource_name + resolved_name round-trip", () => {
  it("parses resolved_resource_name and resolved_name from the jsonb", () => {
    const raw = {
      targets: [
        {
          location: "london",
          bid_modifier_pct: 20,
          resolved_resource_name: "geoTargetConstants/1006886",
          resolved_name: "London, England, United Kingdom",
        },
      ],
      geo_target_type: "PRESENCE",
    };
    const decoded = parseGeoTargetsColumn(raw);
    assert.equal(decoded.targets.length, 1);
    assert.equal(decoded.targets[0].resolved_resource_name, "geoTargetConstants/1006886");
    assert.equal(decoded.targets[0].resolved_name, "London, England, United Kingdom");
  });

  it("serializes resolved_* fields so they survive a save/load cycle", () => {
    const decoded = parseGeoTargetsColumn({
      targets: [
        {
          location: "london",
          bid_modifier_pct: null,
          resolved_resource_name: "geoTargetConstants/1006886",
          resolved_name: "London, England, United Kingdom",
        },
      ],
      geo_target_type: "PRESENCE",
    });
    const serialised = serializeGeoTargetsColumn(decoded);
    assert.equal(serialised.targets[0].resolved_resource_name, "geoTargetConstants/1006886");
    assert.equal(serialised.targets[0].resolved_name, "London, England, United Kingdom");
  });

  it("legacy entries (no resolved fields) decode without error", () => {
    const raw = {
      targets: [
        { location: "london", bid_modifier_pct: 20 },
        { location: "manchester" },
      ],
      geo_target_type: "PRESENCE",
    };
    const decoded = parseGeoTargetsColumn(raw);
    assert.equal(decoded.targets.length, 2);
    // resolved_* absent on both targets — not undefined / null, just absent
    assert.ok(!("resolved_resource_name" in decoded.targets[0]));
    assert.ok(!("resolved_name" in decoded.targets[0]));
  });

  it("resolved_resource_name: null is preserved as null (marks 'tried, no match')", () => {
    const raw = {
      targets: [
        { location: "londn", bid_modifier_pct: null, resolved_resource_name: null, resolved_name: null },
      ],
      geo_target_type: "PRESENCE",
    };
    const decoded = parseGeoTargetsColumn(raw);
    // null values should NOT be preserved as key-in-object (absent is fine),
    // but the important thing is the codec doesn't throw.
    assert.equal(decoded.targets.length, 1);
    assert.equal(decoded.targets[0].location, "londn");
  });
});

// ─── Push adapter pre-resolved ID tests ──────────────────────────────

const CREDS: GoogleAdsCustomerCredentials = {
  customerId: "793-280-0197",
  refreshToken: "refresh",
  loginCustomerId: "333-703-8088",
};
const CUSTOMER_ID = "7932800197";

function makeMinimalTree(): GoogleSearchPlanTree {
  const campaignId = "00000000-0000-0000-0000-000000000001";
  const adGroupId = "00000000-0000-0000-0000-000000000002";
  const keywordId = "00000000-0000-0000-0000-000000000003";
  const rsaId = "00000000-0000-0000-0000-000000000004";
  const planId = "00000000-0000-0000-0000-000000000000";
  return {
    plan: {
      id: planId,
      name: "Test Plan",
      status: "draft",
      google_ads_account_id: "acct-1",
      geo_targets: [],
      geo_target_type: "PRESENCE",
      total_budget: 1000,
      bidding_strategy: "target_cpa",
      target_cpa: 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      event_id: null,
    },
    campaigns: [
      {
        id: campaignId,
        plan_id: planId,
        name: "Camp A",
        network: "search",
        presence: "all",
        pushed_resource_name: null,
        monthly_budget: 100,
        daily_budget: null,
        ad_groups: [
          {
            id: adGroupId,
            campaign_id: campaignId,
            name: "AG 1",
            pushed_resource_name: null,
            keywords: [
              {
                id: keywordId,
                ad_group_id: adGroupId,
                keyword: "test keyword",
                match_type: "PHRASE",
                pushed_resource_name: null,
              },
            ],
            negatives: [],
            rsas: [
              {
                id: rsaId,
                ad_group_id: adGroupId,
                pushed_resource_name: null,
                final_url: "https://example.com",
                headlines: [
                  { text: "Headline 1", pin: null },
                  { text: "Headline 2", pin: null },
                  { text: "Headline 3", pin: null },
                ],
                descriptions: [
                  { text: "Description 1", pin: null },
                  { text: "Description 2", pin: null },
                ],
              },
            ],
          },
        ],
        negative_keyword_list_ids: [],
      },
    ],
    plan_negatives: [],
    sitelinks: [],
  } as unknown as GoogleSearchPlanTree;
}

type SuggestResult = {
  resourceName: string;
  displayName: string;
  countryCode: string | null;
  targetType: string | null;
} | null;

function makeTrackingClient(
  suggestMap: Record<string, { resourceName: string; displayName: string } | null> = {},
) {
  let suggestCallCount = 0;
  const suggestCalledWith: string[][] = [];
  let seq = 1000;

  const client = {
    async mutate(
      _creds: GoogleAdsCustomerCredentials,
      resource: string,
      operations: unknown[],
      _opts = {},
    ) {
      const results = operations.map(() => ({
        resourceName: `customers/${CUSTOMER_ID}/${resource}/${seq++}`,
      }));
      return { results };
    },
    async suggestGeoTargetConstants(
      _rt: string,
      names: string[],
    ): Promise<SuggestResult[]> {
      suggestCallCount += 1;
      suggestCalledWith.push(names);
      return names.map((n) => {
        const hit = suggestMap[n.toLowerCase()] ?? suggestMap[n] ?? null;
        if (!hit) return null;
        return { ...hit, countryCode: "GB", targetType: "City" };
      });
    },
  };
  return {
    client: client as unknown as GoogleAdsClient,
    getSuggestCallCount: () => suggestCallCount,
    getSuggestCalledWith: () => suggestCalledWith,
  };
}

describe("push adapter — pre-resolved IDs skip suggest", () => {
  it("uses resolved_resource_name directly WITHOUT calling suggest", async () => {
    const { client, getSuggestCallCount } = makeTrackingClient();
    const tree = makeMinimalTree();
    tree.plan.geo_targets = [
      {
        location: "london",
        bid_modifier_pct: 20,
        resolved_resource_name: "geoTargetConstants/1006886",
        resolved_name: "London, England, United Kingdom",
      },
    ];

    const summary = await pushGoogleSearchPlan({
      tree,
      credentials: CREDS,
      eventCode: "J2",
      client,
    });

    assert.equal(getSuggestCallCount(), 0, "suggest must NOT be called when resolved_resource_name is present");
    assert.equal(summary.geoTargetsCreated.length, 1, "geo criterion should be created");
    assert.equal(summary.geoTargetsFailed.length, 0);
    assert.equal(summary.geoTargetsCreated[0].location, "london");
  });

  it("falls back to live suggest when resolved_resource_name is absent (XLSX-imported plan)", async () => {
    const { client, getSuggestCallCount } = makeTrackingClient({
      london: { resourceName: "geoTargetConstants/1006886", displayName: "London" },
    });
    const tree = makeMinimalTree();
    tree.plan.geo_targets = [
      { location: "london", bid_modifier_pct: null },
    ];

    const summary = await pushGoogleSearchPlan({
      tree,
      credentials: CREDS,
      eventCode: "J2",
      client,
    });

    assert.ok(getSuggestCallCount() > 0, "suggest must be called when resolved_resource_name is absent");
    assert.equal(summary.geoTargetsCreated.length, 1);
  });

  it("mixed: pre-resolved + unresolved — suggest called for unresolved only", async () => {
    const { client, getSuggestCalledWith } = makeTrackingClient({
      manchester: { resourceName: "geoTargetConstants/1006520", displayName: "Manchester" },
    });
    const tree = makeMinimalTree();
    tree.plan.geo_targets = [
      {
        location: "london",
        bid_modifier_pct: null,
        resolved_resource_name: "geoTargetConstants/1006886",
        resolved_name: "London, England, United Kingdom",
      },
      { location: "manchester", bid_modifier_pct: null },
    ];

    const summary = await pushGoogleSearchPlan({
      tree,
      credentials: CREDS,
      eventCode: "J2",
      client,
    });

    const calledNames = getSuggestCalledWith().flat();
    assert.ok(!calledNames.includes("london"), "london must NOT be in suggest calls (pre-resolved)");
    assert.ok(calledNames.includes("manchester"), "manchester must be in suggest calls (no pre-resolved)");
    assert.equal(summary.geoTargetsCreated.length, 2);
  });
});
