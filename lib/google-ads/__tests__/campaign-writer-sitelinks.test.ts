/**
 * lib/google-ads/__tests__/campaign-writer-sitelinks.test.ts
 *
 * Push-adapter tests for the sitelink path (PR #YYY).
 *
 * Asserts the v23 mutate chain:
 *   1. `assets:mutate` is called ONCE per push, with a sitelinkAsset
 *      payload + finalUrls (per-sitelink override → plan fallback).
 *   2. `campaignAssets:mutate` is called ONCE per FRESH campaign, with
 *      `{ asset, campaign, fieldType: "SITELINK" }` per sitelink.
 *   3. Sitelinks already carrying `pushed_resource_name` skip the
 *      assets:mutate but still get linked to fresh campaigns.
 *   4. A sitelink with no override AND no plan landing URL is recorded
 *      as `sitelinkAssetsFailed` (not pushed).
 *   5. Re-pushing a fully-pushed plan issues ZERO mutate calls (full
 *      idempotency, mirrors the geo behaviour).
 *
 * All tests use the same hand-rolled fake client as
 * `campaign-writer.test.ts` — no real HTTP, no real auth.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  type GoogleAdsCustomerCredentials,
  type GoogleAdsMutateOperation,
  type GoogleAdsMutateResponse,
} from "../client.ts";
import {
  buildSitelinkAssetOp,
  pushGoogleSearchPlan,
} from "../campaign-writer.ts";
import type {
  GoogleSearchAdGroupNode,
  GoogleSearchCampaignNode,
  GoogleSearchKeyword,
  GoogleSearchPlanTree,
  GoogleSearchRsa,
  GoogleSearchSitelink,
} from "../../google-search/types.ts";

// ─── Fixtures ────────────────────────────────────────────────────────

const CUSTOMER_ID = "7932800197";
const CREDS: GoogleAdsCustomerCredentials = {
  customerId: "793-280-0197",
  refreshToken: "refresh-token",
  loginCustomerId: "333-703-8088",
};

function keyword(): GoogleSearchKeyword {
  return {
    id: "kw-1",
    ad_group_id: "ag-1",
    keyword: "junction 2 tickets",
    match_type: "EXACT",
    est_cpc_low: null,
    est_cpc_high: null,
    intent: null,
    notes: null,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
  };
}

function rsa(): GoogleSearchRsa {
  return {
    id: "rsa-1",
    ad_group_id: "ag-1",
    headlines: [
      { text: "Junction 2 Festival" },
      { text: "Melodic Stage Tickets" },
      { text: "Buy Tickets Now" },
    ],
    descriptions: [
      { text: "Limited tickets remaining." },
      { text: "Headline acts, book now." },
    ],
    final_url: "https://offpixel.com/j2",
    path1: null,
    path2: null,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
  };
}

function adGroup(): GoogleSearchAdGroupNode {
  return {
    id: "ag-1",
    campaign_id: "c-1",
    name: "Brand",
    default_cpc: null,
    sort_order: 0,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
    keywords: [keyword()],
    rsas: [rsa()],
  };
}

function campaign(overrides: Partial<GoogleSearchCampaignNode> = {}): GoogleSearchCampaignNode {
  return {
    id: "c-1",
    plan_id: "plan-1",
    name: "C1 Brand",
    priority: null,
    monthly_budget: 100,
    daily_budget: null,
    bid_adjustments: {},
    notes: null,
    sort_order: 0,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
    ad_groups: [adGroup()],
    negatives: [],
    ...overrides,
  };
}

function sitelink(overrides: Partial<GoogleSearchSitelink> = {}): GoogleSearchSitelink {
  return {
    id: "sl-1",
    plan_id: "plan-1",
    link_text: "Tickets",
    description1: "Secure your place",
    description2: "Limited availability",
    final_url: null,
    sort_order: 0,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
    ...overrides,
  };
}

function tree(overrides: Partial<GoogleSearchPlanTree> = {}): GoogleSearchPlanTree {
  return {
    plan: {
      id: "plan-1",
      user_id: "user-1",
      event_id: "evt-1",
      google_ads_account_id: "acct-1",
      name: "Junction 2 Melodic",
      status: "draft",
      total_budget: 500,
      bidding_strategy: "maximize_clicks",
      structure_mode: "single_campaign",
      geo_targets: [],
      geo_target_type: "PRESENCE",
      date_range: null,
      pushed_at: null,
      created_at: "2026-05-21T00:00:00Z",
      updated_at: "2026-05-21T00:00:00Z",
    },
    campaigns: [campaign({})],
    plan_negatives: [],
    sitelinks: [sitelink({})],
    ...overrides,
  };
}

// ─── Fake client (copied shape from campaign-writer.test.ts) ─────────

interface MutateCall {
  resource: string;
  operations: GoogleAdsMutateOperation[];
  options: { partialFailure?: boolean; validateOnly?: boolean };
}

function makeFakeClient(handler?: (call: MutateCall) => GoogleAdsMutateResponse) {
  const calls: MutateCall[] = [];
  let seq = 5000;
  const defaultHandler = (call: MutateCall): GoogleAdsMutateResponse => ({
    results: call.operations.map(() => ({
      resourceName: `customers/${CUSTOMER_ID}/${call.resource}/${seq++}`,
    })),
  });

  const client = {
    async mutate(
      _creds: GoogleAdsCustomerCredentials,
      resource: string,
      operations: GoogleAdsMutateOperation[],
      opts: { partialFailure?: boolean; validateOnly?: boolean } = {},
    ): Promise<GoogleAdsMutateResponse> {
      const call: MutateCall = { resource, operations, options: opts };
      calls.push(call);
      return (handler ?? defaultHandler)(call);
    },
    async suggestGeoTargetConstants(): Promise<unknown[]> {
      return [];
    },
  };

  return {
    client: client as unknown as Parameters<typeof pushGoogleSearchPlan>[0]["client"],
    calls,
  };
}

// ─── Pure helper test ───────────────────────────────────────────────

describe("buildSitelinkAssetOp", () => {
  it("emits the v23 sitelinkAsset shape with finalUrls + linkText + descriptions", () => {
    const op = buildSitelinkAssetOp(sitelink({}), "https://lwe.events/j2");
    assert.deepEqual(op.create, {
      finalUrls: ["https://lwe.events/j2"],
      sitelinkAsset: {
        linkText: "Tickets",
        description1: "Secure your place",
        description2: "Limited availability",
      },
    });
  });

  it("omits empty description fields (Google rejects empty strings)", () => {
    const op = buildSitelinkAssetOp(
      sitelink({ description1: "", description2: null }),
      "https://x.com",
    );
    const sitelinkAsset = (op.create.sitelinkAsset as Record<string, unknown>);
    assert.equal("description1" in sitelinkAsset, false);
    assert.equal("description2" in sitelinkAsset, false);
    assert.equal(sitelinkAsset.linkText, "Tickets");
  });
});

// ─── Full push integration tests ──────────────────────────────────────

describe("pushGoogleSearchPlan — sitelink asset + campaign link", () => {
  it("creates the asset via assets:mutate then links via campaignAssets:mutate with SITELINK fieldType", async () => {
    const { client, calls } = makeFakeClient();
    const summary = await pushGoogleSearchPlan({
      tree: tree({
        sitelinks: [
          sitelink({ id: "sl-tickets", link_text: "Tickets" }),
          sitelink({ id: "sl-faq", link_text: "FAQ", description1: null, description2: null }),
        ],
      }),
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client,
    });

    assert.equal(summary.ok, true);

    // assets:mutate happened ONCE with 2 ops.
    const assetCalls = calls.filter((c) => c.resource === "assets");
    assert.equal(assetCalls.length, 1);
    assert.equal(assetCalls[0].operations.length, 2);
    assert.equal(assetCalls[0].options.partialFailure, true);

    // campaignAssets:mutate happened ONCE (one campaign) with 2 ops,
    // each carrying { asset, campaign, fieldType: "SITELINK" }.
    const linkCalls = calls.filter((c) => c.resource === "campaignAssets");
    assert.equal(linkCalls.length, 1);
    assert.equal(linkCalls[0].operations.length, 2);
    assert.equal(linkCalls[0].options.partialFailure, true);
    for (const op of linkCalls[0].operations) {
      assert.ok("create" in op);
      const create = (op as { create: Record<string, unknown> }).create;
      assert.equal(create.fieldType, "SITELINK");
      assert.ok((create.asset as string).startsWith(`customers/${CUSTOMER_ID}/assets/`));
      assert.ok((create.campaign as string).startsWith(`customers/${CUSTOMER_ID}/campaigns/`));
    }

    // Summary reflects both writes.
    assert.equal(summary.sitelinkAssetsCreated.length, 2);
    assert.equal(summary.sitelinksLinkedToCampaigns.length, 2);
    assert.equal(summary.sitelinkAssetsFailed.length, 0);
    assert.equal(summary.sitelinksFailedToLink.length, 0);
  });

  it("uses per-sitelink final_url override when set; falls back to the plan landing URL otherwise", async () => {
    const { client, calls } = makeFakeClient();
    await pushGoogleSearchPlan({
      tree: tree({
        sitelinks: [
          sitelink({ id: "sl-1", final_url: "https://override.example.com/page" }),
          sitelink({ id: "sl-2", final_url: null }), // → plan fallback
        ],
      }),
      credentials: CREDS,
      eventCode: "J2",
      client,
    });

    const assetCall = calls.find((c) => c.resource === "assets");
    assert.ok(assetCall);
    const finalUrls = assetCall!.operations.map(
      (op) => (op as { create: { finalUrls: string[] } }).create.finalUrls,
    );
    assert.deepEqual(finalUrls[0], ["https://override.example.com/page"]);
    // Plan fallback comes from the RSA fixture: https://offpixel.com/j2.
    assert.deepEqual(finalUrls[1], ["https://offpixel.com/j2"]);
  });

  it("records sitelinks with no override AND no plan landing URL as sitelinkAssetsFailed (not pushed)", async () => {
    const { client, calls } = makeFakeClient();
    const treeWithNoLanding = tree({
      // RSA without a final_url → plan fallback resolves to null.
      campaigns: [
        campaign({
          ad_groups: [
            { ...adGroup(), rsas: [{ ...rsa(), final_url: null }] },
          ],
        }),
      ],
      sitelinks: [sitelink({ final_url: null })],
    });

    const summary = await pushGoogleSearchPlan({
      tree: treeWithNoLanding,
      credentials: CREDS,
      eventCode: "J2",
      client,
    });

    // No assets:mutate happens when there's nothing to push.
    assert.equal(calls.filter((c) => c.resource === "assets").length, 0);
    assert.equal(summary.sitelinkAssetsCreated.length, 0);
    assert.equal(summary.sitelinkAssetsFailed.length, 1);
    assert.match(
      summary.sitelinkAssetsFailed[0].error,
      /no final_url override and no plan-level landing URL/,
    );
  });

  it("skips assets:mutate for a sitelink that already has pushed_resource_name (reuses asset for the new campaign link)", async () => {
    const { client, calls } = makeFakeClient();
    const summary = await pushGoogleSearchPlan({
      tree: tree({
        sitelinks: [
          sitelink({
            id: "sl-reused",
            pushed_resource_name: `customers/${CUSTOMER_ID}/assets/9999`,
          }),
        ],
      }),
      credentials: CREDS,
      eventCode: "J2",
      client,
    });

    assert.equal(calls.filter((c) => c.resource === "assets").length, 0);

    // It STILL links to the (fresh) campaign — campaignAssets:mutate is per-campaign.
    const linkCall = calls.find((c) => c.resource === "campaignAssets");
    assert.ok(linkCall);
    const op = (linkCall!.operations[0] as { create: { asset: string } }).create;
    assert.equal(op.asset, `customers/${CUSTOMER_ID}/assets/9999`);

    assert.equal(summary.sitelinkAssetsCreated.length, 1);
    assert.equal(summary.sitelinkAssetsCreated[0].reused, true);
  });

  it("emits the manual-removal warning so the operator knows account-level sitelinks may still show", async () => {
    const { client } = makeFakeClient();
    const summary = await pushGoogleSearchPlan({
      tree: tree({}),
      credentials: CREDS,
      eventCode: "J2",
      client,
    });
    assert.ok(
      summary.warnings.some((w) =>
        /account-level sitelinks/i.test(w),
      ),
      `expected account-level warning, got: ${JSON.stringify(summary.warnings)}`,
    );
  });

  it("a fully-pushed plan (campaign + sitelink both reused) issues ZERO mutate calls (full idempotency)", async () => {
    const { client, calls } = makeFakeClient();
    const summary = await pushGoogleSearchPlan({
      tree: tree({
        campaigns: [
          campaign({
            pushed_resource_name: `customers/${CUSTOMER_ID}/campaigns/9000`,
            ad_groups: [
              {
                ...adGroup(),
                pushed_resource_name: `customers/${CUSTOMER_ID}/adGroups/8000`,
                keywords: [
                  {
                    ...keyword(),
                    pushed_resource_name: `customers/${CUSTOMER_ID}/adGroupCriteria/7000`,
                  },
                ],
                rsas: [
                  {
                    ...rsa(),
                    pushed_resource_name: `customers/${CUSTOMER_ID}/adGroupAds/6000`,
                  },
                ],
              },
            ],
          }),
        ],
        sitelinks: [
          sitelink({
            pushed_resource_name: `customers/${CUSTOMER_ID}/assets/5000`,
          }),
        ],
      }),
      credentials: CREDS,
      eventCode: "J2",
      client,
    });
    assert.equal(calls.length, 0, "fully-pushed plan should issue zero mutate calls");
    assert.equal(summary.ok, true);
    assert.equal(summary.sitelinkAssetsCreated[0].reused, true);
  });

  it("a plan with zero sitelinks skips both assets:mutate and campaignAssets:mutate", async () => {
    const { client, calls } = makeFakeClient();
    const summary = await pushGoogleSearchPlan({
      tree: tree({ sitelinks: [] }),
      credentials: CREDS,
      eventCode: "J2",
      client,
    });
    assert.equal(summary.ok, true);
    assert.equal(calls.filter((c) => c.resource === "assets").length, 0);
    assert.equal(calls.filter((c) => c.resource === "campaignAssets").length, 0);
    // And no account-level warning when there are no sitelinks to begin with.
    assert.equal(
      summary.warnings.some((w) => /account-level sitelinks/i.test(w)),
      false,
    );
  });

  it("persister.setSitelinkResource is called for each freshly-created sitelink asset", async () => {
    const { client } = makeFakeClient();
    const stamped: Array<{ id: string; resourceName: string }> = [];
    await pushGoogleSearchPlan({
      tree: tree({
        sitelinks: [sitelink({ id: "sl-1" }), sitelink({ id: "sl-2", link_text: "Lineup" })],
      }),
      credentials: CREDS,
      eventCode: "J2",
      client,
      persister: {
        setCampaignResource: async () => {},
        setAdGroupResource: async () => {},
        setKeywordResource: async () => {},
        setNegativeResource: async () => {},
        setRsaResource: async () => {},
        setSitelinkResource: async (id, resourceName) => {
          stamped.push({ id, resourceName });
        },
        setPlanStatus: async () => {},
      },
    });
    assert.equal(stamped.length, 2);
    assert.deepEqual(
      stamped.map((s) => s.id).sort(),
      ["sl-1", "sl-2"],
    );
    for (const row of stamped) {
      assert.ok(row.resourceName.startsWith(`customers/${CUSTOMER_ID}/assets/`));
    }
  });
});
