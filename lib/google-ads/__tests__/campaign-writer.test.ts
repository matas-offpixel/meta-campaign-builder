/**
 * Unit tests for the Phase 3 Google Search push adapter.
 *
 * All tests pass a hand-rolled fake `GoogleAdsClient` instance — NO
 * real HTTP, NO real auth. The fake records every `mutate(resource,
 * operations, options)` call in order so we can assert on the chain
 * order, payload shapes, and partial-failure semantics.
 *
 * Cases covered (see PR session log + Phase 3 prompt):
 *
 *  1. Full successful push — sequential chain, EU political ads field
 *     present, all PAUSED, `[event_code]` prefix applied.
 *  2. Triad failure (campaign mutate fails) — budget rolled back.
 *  3. Triad failure (all ad groups fail) — campaign + budget rolled
 *     back, campaign demoted to `campaignsFailed`.
 *  4. Fan-out partial failure — one bad keyword recorded in
 *     `keywordsFailed`, others land in `keywordsCreated`.
 *  5. Idempotency — re-push of already-pushed plan issues zero
 *     mutate calls and returns reused=true results.
 *  6. `[event_code]` prefixing applied (and warning when missing).
 *  7. Auth-like failure aborts the rest of the plan.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  GoogleAdsApiError,
  type GoogleAdsCustomerCredentials,
  type GoogleAdsMutateOperation,
  type GoogleAdsMutateResponse,
} from "../client.ts";
import {
  buildBudgetOp,
  googleAdsCampaignDeepLink,
  prefixCampaignName,
  pushGoogleSearchPlan,
  type GoogleSearchPushPersister,
} from "../campaign-writer.ts";
import type {
  GoogleSearchAdGroupNode,
  GoogleSearchCampaignNode,
  GoogleSearchKeyword,
  GoogleSearchNegative,
  GoogleSearchPlanTree,
  GoogleSearchRsa,
} from "../../google-search/types.ts";

// ─── Fixtures ────────────────────────────────────────────────────────

const CUSTOMER_ID = "7932800197";

const CREDS: GoogleAdsCustomerCredentials = {
  customerId: "793-280-0197",
  refreshToken: "refresh-token",
  loginCustomerId: "333-703-8088",
};

function keyword(overrides: Partial<GoogleSearchKeyword>): GoogleSearchKeyword {
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
    ...overrides,
  };
}

function negative(overrides: Partial<GoogleSearchNegative>): GoogleSearchNegative {
  return {
    id: "neg-1",
    plan_id: "plan-1",
    campaign_id: null,
    keyword: "free tickets",
    match_type: "PHRASE",
    reason: null,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
    ...overrides,
  };
}

function rsa(overrides: Partial<GoogleSearchRsa>): GoogleSearchRsa {
  return {
    id: "rsa-1",
    ad_group_id: "ag-1",
    headlines: [
      { text: "Junction 2 Festival" },
      { text: "Melodic Stage Tickets" },
      { text: "Buy Tickets Now" },
    ],
    descriptions: [
      { text: "Limited tickets remaining for Junction 2 Melodic Stage." },
      { text: "Headline acts, world-class production — book now." },
    ],
    final_url: "https://offpixel.com/j2",
    path1: null,
    path2: null,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
    ...overrides,
  };
}

function adGroup(overrides: Partial<GoogleSearchAdGroupNode>): GoogleSearchAdGroupNode {
  return {
    id: "ag-1",
    campaign_id: "c-1",
    name: "Brand",
    default_cpc: null,
    sort_order: 0,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
    keywords: [keyword({})],
    rsas: [rsa({})],
    ...overrides,
  };
}

function campaign(overrides: Partial<GoogleSearchCampaignNode>): GoogleSearchCampaignNode {
  return {
    id: "c-1",
    plan_id: "plan-1",
    name: "C1 Brand",
    priority: null,
    monthly_budget: 150,
    daily_budget: null,
    bid_adjustments: {},
    notes: null,
    sort_order: 0,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
    ad_groups: [adGroup({})],
    negatives: [],
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
    plan_negatives: [negative({})],
    ...overrides,
  };
}

// ─── Fake GoogleAdsClient ────────────────────────────────────────────

interface MutateCall {
  resource: string;
  operations: GoogleAdsMutateOperation[];
  options: { partialFailure?: boolean; validateOnly?: boolean };
}

interface FakeClientOptions {
  handler?: (call: MutateCall) => GoogleAdsMutateResponse | Promise<GoogleAdsMutateResponse>;
  /**
   * Map of location name (lowercase) → suggest result. If omitted, suggest
   * always returns null (forcing the fallback map) so existing tests stay
   * unaffected with `geo_targets: []`.
   */
  geoSuggestMap?: Record<string, { resourceName: string; displayName: string } | null>;
}

function makeFakeClient(options: FakeClientOptions = {}) {
  const calls: MutateCall[] = [];
  const suggestCalls: string[][] = [];
  let seq = 1000;

  const defaultHandler = (call: MutateCall): GoogleAdsMutateResponse => {
    const results = call.operations.map(() => ({
      resourceName: `customers/${CUSTOMER_ID}/${call.resource}/${seq++}`,
    }));
    return { results };
  };

  const client = {
    async mutate(
      _creds: GoogleAdsCustomerCredentials,
      resource: string,
      operations: GoogleAdsMutateOperation[],
      opts: { partialFailure?: boolean; validateOnly?: boolean } = {},
    ): Promise<GoogleAdsMutateResponse> {
      const call: MutateCall = { resource, operations, options: opts };
      calls.push(call);
      return (options.handler ?? defaultHandler)(call);
    },
    async suggestGeoTargetConstants(
      _refreshToken: string,
      names: string[],
    ): Promise<Array<{ resourceName: string; displayName: string; countryCode: string | null; targetType: string | null } | null>> {
      suggestCalls.push(names);
      const map = options.geoSuggestMap ?? {};
      return names.map((n) => {
        const hit = map[n.toLowerCase()] ?? map[n] ?? null;
        if (!hit) return null;
        return { resourceName: hit.resourceName, displayName: hit.displayName, countryCode: null, targetType: null };
      });
    },
  };

  // The writer's input type is `GoogleAdsClient` — cast at the call site.
  return {
    client: client as unknown as Parameters<typeof pushGoogleSearchPlan>[0]["client"],
    calls,
    suggestCalls,
  };
}

// ─── 1. Full successful push ─────────────────────────────────────────

describe("pushGoogleSearchPlan — full success", () => {
  it("issues the verified mutate chain in order with EU political ads field on every campaign", async () => {
    const { client, calls } = makeFakeClient();
    const summary = await pushGoogleSearchPlan({
      tree: tree(),
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client,
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.aborted, false);
    assert.equal(summary.partialFailure, false);
    assert.equal(summary.planStatusUpdate, "pushed");

    // Chain order: campaignBudgets → campaigns → adGroups → adGroupCriteria → adGroupAds.
    assert.deepEqual(
      calls.map((c) => c.resource),
      ["campaignBudgets", "campaigns", "adGroups", "adGroupCriteria", "adGroupAds"],
    );

    // Campaign mutate payload — assert verified v23 fields.
    const campaignOp = calls[1].operations[0];
    assert.ok("create" in campaignOp);
    const campaignCreate = (campaignOp as { create: Record<string, unknown> }).create;
    assert.equal(campaignCreate.advertisingChannelType, "SEARCH");
    assert.equal(campaignCreate.status, "PAUSED");
    assert.equal(
      campaignCreate.containsEuPoliticalAdvertising,
      "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    );
    assert.deepEqual(campaignCreate.networkSettings, {
      targetGoogleSearch: true,
      targetSearchNetwork: true,
      targetContentNetwork: false,
      targetPartnerSearchNetwork: false,
    });
    // Maximise Clicks via target_spend.cpc_bid_ceiling_micros.
    assert.ok((campaignCreate.targetSpend as { cpcBidCeilingMicros?: string })?.cpcBidCeilingMicros);
    assert.equal(campaignCreate.manualCpc, undefined);

    // Ad group PAUSED + SEARCH_STANDARD.
    const adGroupOp = calls[2].operations[0];
    assert.ok("create" in adGroupOp);
    const adGroupCreate = (adGroupOp as { create: Record<string, unknown> }).create;
    assert.equal(adGroupCreate.status, "PAUSED");
    assert.equal(adGroupCreate.type, "SEARCH_STANDARD");

    // adGroupCriteria has partialFailure ON, with 1 keyword + 1 negative bundled.
    // Writer's pushAdGroupCriteria emits keywords first, then negatives,
    // matching the spike's `[...keywordOps, ...negativeOps]` order.
    assert.equal(calls[3].options.partialFailure, true);
    assert.equal(calls[3].operations.length, 2);
    const criteriaOps = calls[3].operations.map((op) => {
      const create = (op as { create: Record<string, unknown> }).create;
      return create.negative === true ? "negative" : "keyword";
    });
    assert.deepEqual(criteriaOps, ["keyword", "negative"]);

    // RSA: PAUSED, has finalUrls + headlines + descriptions.
    assert.equal(calls[4].options.partialFailure, true);
    const rsaCreate = (calls[4].operations[0] as { create: Record<string, unknown> }).create;
    assert.equal(rsaCreate.status, "PAUSED");
    const adRsa = rsaCreate.ad as { responsiveSearchAd: { headlines: unknown[]; descriptions: unknown[] }; finalUrls?: string[] };
    assert.equal(adRsa.finalUrls?.[0], "https://offpixel.com/j2");
    assert.equal(adRsa.responsiveSearchAd.headlines.length, 3);
    assert.equal(adRsa.responsiveSearchAd.descriptions.length, 2);

    // Summary tallies.
    assert.equal(summary.campaignsCreated.length, 1);
    assert.equal(summary.adGroupsCreated.length, 1);
    assert.equal(summary.keywordsCreated.length, 1);
    assert.equal(summary.negativesCreated.length, 1);
    assert.equal(summary.rsasCreated.length, 1);
    assert.equal(summary.budgetsCreated.length, 1);
    assert.equal(summary.budgetsRolledBack.length, 0);
    assert.equal(summary.campaignsRolledBack.length, 0);
  });

  it("calls the persister with the platform resource names for every created row", async () => {
    const { client } = makeFakeClient();
    const persistedCampaigns: Array<[string, string]> = [];
    const persistedAdGroups: Array<[string, string]> = [];
    const persistedKeywords: Array<[string, string]> = [];
    const persistedNegatives: Array<[string, string]> = [];
    const persistedRsas: Array<[string, string]> = [];
    let planStatus: [string, "pushed" | "partially_pushed"] | null = null;

    const persister: GoogleSearchPushPersister = {
      async setCampaignResource(id, rn) {
        persistedCampaigns.push([id, rn]);
      },
      async setAdGroupResource(id, rn) {
        persistedAdGroups.push([id, rn]);
      },
      async setKeywordResource(id, rn) {
        persistedKeywords.push([id, rn]);
      },
      async setNegativeResource(id, rn) {
        persistedNegatives.push([id, rn]);
      },
      async setRsaResource(id, rn) {
        persistedRsas.push([id, rn]);
      },
      async setPlanStatus(id, status) {
        planStatus = [id, status];
      },
    };

    await pushGoogleSearchPlan({
      tree: tree(),
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client,
      persister,
    });

    assert.equal(persistedCampaigns.length, 1);
    assert.equal(persistedCampaigns[0][0], "c-1");
    assert.equal(persistedAdGroups[0][0], "ag-1");
    assert.equal(persistedKeywords[0][0], "kw-1");
    assert.equal(persistedNegatives[0][0], "neg-1");
    assert.equal(persistedRsas[0][0], "rsa-1");
    assert.deepEqual(planStatus, ["plan-1", "pushed"]);
  });
});

// ─── 2. Triad failure: campaign mutate fails → budget rolled back ────

describe("pushGoogleSearchPlan — triad failure", () => {
  it("rolls back the budget when campaigns:mutate fails", async () => {
    let seq = 9000;
    let removeCount = 0;
    const { client, calls } = makeFakeClient({
      handler: (call) => {
        if (call.resource === "campaigns" && "create" in call.operations[0]) {
          throw new GoogleAdsApiError("Bidding strategy incompatible.", {
            status: "INVALID_ARGUMENT",
            httpStatus: 400,
          });
        }
        if (call.resource === "campaignBudgets" && "remove" in call.operations[0]) {
          removeCount += 1;
          return { results: [{ resourceName: (call.operations[0] as { remove: string }).remove }] };
        }
        const results = call.operations.map(() => ({
          resourceName: `customers/${CUSTOMER_ID}/${call.resource}/${seq++}`,
        }));
        return { results };
      },
    });

    const summary = await pushGoogleSearchPlan({
      tree: tree(),
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.aborted, false);
    assert.equal(summary.partialFailure, true);
    assert.equal(summary.planStatusUpdate, "draft");

    assert.equal(summary.campaignsCreated.length, 0);
    assert.equal(summary.campaignsFailed.length, 1);
    assert.match(summary.campaignsFailed[0].error, /campaign_create_failed.*Bidding strategy/);

    // Budget was created then removed.
    assert.equal(summary.budgetsCreated.length, 1);
    assert.equal(summary.budgetsRolledBack.length, 1);
    assert.equal(removeCount, 1);

    // Chain: budgets → campaigns (fails) → budgets remove. No ad groups/criteria/RSAs.
    assert.deepEqual(
      calls.map((c) => c.resource),
      ["campaignBudgets", "campaigns", "campaignBudgets"],
    );
    assert.ok("remove" in calls[2].operations[0]);
  });

  it("rolls back the campaign + budget when every ad group fails", async () => {
    let seq = 5000;
    const { client, calls } = makeFakeClient({
      handler: (call) => {
        if (call.resource === "adGroups" && "create" in call.operations[0]) {
          throw new GoogleAdsApiError("Ad group quota exceeded.", {
            status: "RESOURCE_EXHAUSTED",
            httpStatus: 429,
          });
        }
        const results = call.operations.map((op) => ({
          resourceName:
            "remove" in op
              ? op.remove
              : `customers/${CUSTOMER_ID}/${call.resource}/${seq++}`,
        }));
        return { results };
      },
    });

    const summary = await pushGoogleSearchPlan({
      tree: tree(),
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.campaignsCreated.length, 0);
    assert.equal(summary.campaignsFailed.length, 1);
    assert.match(summary.campaignsFailed[0].error, /all_ad_groups_failed/);
    assert.equal(summary.adGroupsFailed.length, 1);
    assert.equal(summary.budgetsRolledBack.length, 1);
    assert.equal(summary.campaignsRolledBack.length, 1);

    // Chain: budgets → campaigns → adGroups (fails) → campaigns remove → budgets remove.
    assert.deepEqual(
      calls.map((c) => c.resource),
      ["campaignBudgets", "campaigns", "adGroups", "campaigns", "campaignBudgets"],
    );
    assert.ok("remove" in calls[3].operations[0]);
    assert.ok("remove" in calls[4].operations[0]);
  });
});

// ─── 3. Fan-out partial failure ──────────────────────────────────────

describe("pushGoogleSearchPlan — fan-out partial failure", () => {
  it("records the bad keyword in keywordsFailed while the others land in keywordsCreated", async () => {
    let seq = 4000;
    const { client } = makeFakeClient({
      handler: (call) => {
        if (call.resource === "adGroupCriteria") {
          // 3 ops in operation order: [kw-1, kw-2, plan-negative]
          // (writer emits keywords first, then negatives). Fail kw-2
          // by returning a null result at index 1 + a partial-failure
          // error that points at operations[1].
          const results = call.operations.map((_op, i) =>
            i === 1
              ? null
              : { resourceName: `customers/${CUSTOMER_ID}/adGroupCriteria/${seq++}` },
          );
          return {
            results: results as { resourceName: string }[],
            partialFailureError: {
              code: 3,
              message: "Multiple errors",
              details: [
                {
                  errors: [
                    {
                      message: "Keyword text contains invalid characters.",
                      errorCode: { criterionError: "INVALID_KEYWORD_TEXT" },
                      location: {
                        fieldPathElements: [{ fieldName: "operations", index: 1 }],
                      },
                    },
                  ],
                },
              ],
            },
          };
        }
        const results = call.operations.map(() => ({
          resourceName: `customers/${CUSTOMER_ID}/${call.resource}/${seq++}`,
        }));
        return { results };
      },
    });

    const planTree = tree({
      campaigns: [
        campaign({
          ad_groups: [
            adGroup({
              keywords: [
                keyword({ id: "kw-1", keyword: "junction 2 tickets", match_type: "EXACT" }),
                keyword({ id: "kw-2", keyword: "!!!bad", match_type: "EXACT" }),
              ],
              rsas: [],
            }),
          ],
        }),
      ],
    });

    const summary = await pushGoogleSearchPlan({
      tree: planTree,
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client,
    });

    assert.equal(summary.ok, true, "campaign should still be considered created");
    assert.equal(summary.partialFailure, true);
    assert.equal(summary.planStatusUpdate, "partially_pushed");

    assert.equal(summary.keywordsCreated.length, 1);
    assert.equal(summary.keywordsCreated[0].localId, "kw-1");
    assert.equal(summary.keywordsFailed.length, 1);
    assert.equal(summary.keywordsFailed[0].localId, "kw-2");
    assert.match(summary.keywordsFailed[0].error, /invalid characters/);

    assert.equal(summary.negativesCreated.length, 1);
    assert.equal(summary.negativesFailed.length, 0);
  });
});

// ─── 4. Idempotency ──────────────────────────────────────────────────

describe("pushGoogleSearchPlan — idempotency via pushed_resource_name", () => {
  it("issues zero mutate calls when every row is already pushed and reports reused=true", async () => {
    const { client, calls } = makeFakeClient();
    const alreadyPushedTree = tree({
      campaigns: [
        campaign({
          pushed_resource_name: `customers/${CUSTOMER_ID}/campaigns/111`,
          ad_groups: [
            adGroup({
              pushed_resource_name: `customers/${CUSTOMER_ID}/adGroups/222`,
              keywords: [
                keyword({
                  pushed_resource_name: `customers/${CUSTOMER_ID}/adGroupCriteria/333`,
                }),
              ],
              rsas: [
                rsa({
                  pushed_resource_name: `customers/${CUSTOMER_ID}/adGroupAds/444`,
                }),
              ],
            }),
          ],
        }),
      ],
      plan_negatives: [
        negative({
          pushed_resource_name: `customers/${CUSTOMER_ID}/adGroupCriteria/555`,
        }),
      ],
    });

    const summary = await pushGoogleSearchPlan({
      tree: alreadyPushedTree,
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client,
    });

    assert.equal(calls.length, 0, "no Google Ads mutate should happen on a fully-pushed plan");
    assert.equal(summary.ok, true);
    assert.equal(summary.partialFailure, false);
    assert.equal(summary.planStatusUpdate, "pushed");

    assert.equal(summary.campaignsCreated.length, 1);
    assert.equal(summary.campaignsCreated[0].reused, true);
    assert.equal(summary.adGroupsCreated[0].reused, true);
    assert.equal(summary.keywordsCreated[0].reused, true);
    assert.equal(summary.negativesCreated[0].reused, true);
    assert.equal(summary.rsasCreated[0].reused, true);
  });

  it("creates only the missing rows when half of a plan is already pushed", async () => {
    let seq = 8000;
    const { client, calls } = makeFakeClient({
      handler: (call) => ({
        results: call.operations.map(() => ({
          resourceName: `customers/${CUSTOMER_ID}/${call.resource}/${seq++}`,
        })),
      }),
    });

    const halfTree = tree({
      campaigns: [
        campaign({
          pushed_resource_name: `customers/${CUSTOMER_ID}/campaigns/111`,
          ad_groups: [
            adGroup({
              pushed_resource_name: `customers/${CUSTOMER_ID}/adGroups/222`,
              // One already-pushed keyword + one fresh one.
              keywords: [
                keyword({
                  id: "kw-1",
                  pushed_resource_name: `customers/${CUSTOMER_ID}/adGroupCriteria/333`,
                }),
                keyword({ id: "kw-2", keyword: "junction 2 melodic stage" }),
              ],
              rsas: [],
            }),
          ],
        }),
      ],
      plan_negatives: [],
    });

    const summary = await pushGoogleSearchPlan({
      tree: halfTree,
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client,
    });

    // Only the fresh keyword should trigger a single adGroupCriteria
    // mutate (1 op). Budget / campaign / ad group all skipped.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].resource, "adGroupCriteria");
    assert.equal(calls[0].operations.length, 1);
    assert.equal(summary.keywordsCreated.length, 2);
    assert.equal(summary.keywordsCreated.filter((k) => k.reused).length, 1);
    assert.equal(summary.keywordsCreated.filter((k) => !k.reused).length, 1);
  });
});

// ─── 5. [event_code] prefix ──────────────────────────────────────────

describe("pushGoogleSearchPlan — [event_code] prefix", () => {
  it("prefixes the campaign name with [eventCode] when provided", async () => {
    const { client, calls } = makeFakeClient();
    await pushGoogleSearchPlan({
      tree: tree(),
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client,
    });

    const campaignCreate = (calls[1].operations[0] as { create: Record<string, unknown> }).create;
    assert.equal(campaignCreate.name, "[J2-MELODIC] C1 Brand");
  });

  it("pushes campaign name as-is and warns when eventCode is null", async () => {
    const { client, calls } = makeFakeClient();
    const summary = await pushGoogleSearchPlan({
      tree: tree(),
      credentials: CREDS,
      eventCode: null,
      client,
    });

    const campaignCreate = (calls[1].operations[0] as { create: Record<string, unknown> }).create;
    assert.equal(campaignCreate.name, "C1 Brand");
    assert.ok(summary.warnings.some((w) => w.includes("[event_code] prefix")));
  });

  it("does not double-prefix if the campaign name already starts with the tag", async () => {
    const { client, calls } = makeFakeClient();
    await pushGoogleSearchPlan({
      tree: tree({
        campaigns: [campaign({ name: "[J2-MELODIC] Brand pre-prefixed" })],
      }),
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client,
    });

    const campaignCreate = (calls[1].operations[0] as { create: Record<string, unknown> }).create;
    assert.equal(campaignCreate.name, "[J2-MELODIC] Brand pre-prefixed");
  });
});

// ─── 6. Auth failure aborts the plan ─────────────────────────────────

describe("pushGoogleSearchPlan — auth abort", () => {
  it("aborts the whole plan when the first mutate returns 401 UNAUTHENTICATED", async () => {
    const { client } = makeFakeClient({
      handler: () => {
        throw new GoogleAdsApiError("Bad refresh token.", {
          status: "UNAUTHENTICATED",
          httpStatus: 401,
        });
      },
    });

    const summary = await pushGoogleSearchPlan({
      tree: tree({
        campaigns: [
          campaign({ id: "c-1", name: "C1 Brand" }),
          campaign({ id: "c-2", name: "C2 PR" }),
        ],
      }),
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client,
    });

    assert.equal(summary.aborted, true);
    assert.equal(summary.ok, false);
    assert.match(summary.abortReason ?? "", /auth_failed/);
    // The second campaign should not have been attempted.
    assert.equal(summary.campaignsFailed.length, 1);
    assert.equal(summary.campaignsFailed[0].localId, "c-1");
  });
});

// ─── 7. Pure helpers ─────────────────────────────────────────────────

describe("prefixCampaignName + deep link helpers", () => {
  it("prefixCampaignName trims to 255 chars after prefix", () => {
    const longName = "x".repeat(300);
    const prefixed = prefixCampaignName(longName, "J2");
    assert.equal(prefixed.length, 255);
    assert.ok(prefixed.startsWith("[J2] "));
  });

  it("googleAdsCampaignDeepLink builds the canonical Google Ads URL", () => {
    const link = googleAdsCampaignDeepLink(
      `customers/${CUSTOMER_ID}/campaigns/23874109408`,
      "793-280-0197",
    );
    assert.equal(
      link,
      "https://ads.google.com/aw/campaigns?campaignId=23874109408&__e=7932800197",
    );
  });

  it("googleAdsCampaignDeepLink returns null for non-campaign resource names", () => {
    assert.equal(
      googleAdsCampaignDeepLink(`customers/${CUSTOMER_ID}/adGroups/1`, CUSTOMER_ID),
      null,
    );
  });
});

// ─── Budget: DAILY field drives amountMicros (Phase 5 fix) ────────────

describe("buildBudgetOp — daily_budget is the source of truth", () => {
  // Bug context (PR #448): the wizard previously wrote monthly_budget,
  // so a £1 entry pushed as £0.03/day (1/30). The wizard now writes
  // daily_budget; these tests pin the push contract so a future regression
  // would be caught immediately.

  it("uses daily_budget * 1_000_000 for amountMicros, NOT monthly_budget", () => {
    const c = campaign({ daily_budget: 5, monthly_budget: 99999 });
    const op = buildBudgetOp(c, CUSTOMER_ID);
    assert.equal(
      op.create.amountMicros,
      String(5_000_000),
      "daily_budget=5 must produce amountMicros=5_000_000 regardless of monthly_budget",
    );
  });

  it("£1/day smoke-test value produces exactly 1_000_000 micros", () => {
    const c = campaign({ daily_budget: 1, monthly_budget: 350 });
    const op = buildBudgetOp(c, CUSTOMER_ID);
    assert.equal(op.create.amountMicros, String(1_000_000));
  });

  it("falls back to monthly/30 only when daily_budget is null", () => {
    const c = campaign({ daily_budget: null, monthly_budget: 150 });
    const op = buildBudgetOp(c, CUSTOMER_ID);
    // 150 / 30 = 5 → 5_000_000 micros
    assert.equal(op.create.amountMicros, String(5_000_000));
  });

  it("uses the £1/day floor when both daily and monthly are zero/null", () => {
    const c = campaign({ daily_budget: null, monthly_budget: null });
    const op = buildBudgetOp(c, CUSTOMER_ID);
    // DEFAULT_DAILY_BUDGET_POUNDS = 5 → 5_000_000 micros
    assert.equal(op.create.amountMicros, String(5_000_000));
  });
});

// ─── geoTargetTypeSetting (Phase 5b) ──────────────────────────────────

describe("pushGoogleSearchPlan — geoTargetTypeSetting", () => {
  it("defaults to PRESENCE on campaign create", async () => {
    const { client, calls } = makeFakeClient();
    await pushGoogleSearchPlan({
      tree: tree(),
      credentials: CREDS,
      eventCode: "J2",
      client,
    });
    const campaignCreate = (calls[1].operations[0] as { create: Record<string, unknown> }).create;
    assert.deepEqual(campaignCreate.geoTargetTypeSetting, {
      positiveGeoTargetType: "PRESENCE",
      negativeGeoTargetType: "PRESENCE",
    });
  });

  it("sends PRESENCE_OR_INTEREST when the operator overrides the default", async () => {
    const { client, calls } = makeFakeClient();
    const t = tree();
    t.plan.geo_target_type = "PRESENCE_OR_INTEREST";
    await pushGoogleSearchPlan({
      tree: t,
      credentials: CREDS,
      eventCode: "J2",
      client,
    });
    const campaignCreate = (calls[1].operations[0] as { create: Record<string, unknown> }).create;
    assert.deepEqual(campaignCreate.geoTargetTypeSetting, {
      positiveGeoTargetType: "PRESENCE_OR_INTEREST",
      negativeGeoTargetType: "PRESENCE",
    });
  });
});

// ─── RSA final URL guard (Phase 5b) ───────────────────────────────────

describe("pushGoogleSearchPlan — RSA final URL guard", () => {
  it("pushes finalUrls when the RSA has a valid URL", async () => {
    const { client, calls } = makeFakeClient();
    await pushGoogleSearchPlan({
      tree: tree(),
      credentials: CREDS,
      eventCode: "J2",
      client,
    });
    const rsaCreate = (calls[4].operations[0] as { create: Record<string, unknown> }).create;
    const ad = rsaCreate.ad as { finalUrls?: string[] };
    assert.deepEqual(ad.finalUrls, ["https://offpixel.com/j2"]);
  });

  it("skips the mutate call entirely and partial-fails RSAs whose final_url is null", async () => {
    const { client, calls } = makeFakeClient();
    const t = tree();
    // Strip the URL from the lone RSA in the fixture.
    t.campaigns[0].ad_groups[0].rsas[0].final_url = null;

    const summary = await pushGoogleSearchPlan({
      tree: t,
      credentials: CREDS,
      eventCode: "J2",
      client,
    });

    // The fan-out adGroupAds:mutate call should never be made — no
    // pushable RSAs remain after the URL-block guard pre-filter.
    assert.equal(
      calls.some((c) => c.resource === "adGroupAds"),
      false,
      "adGroupAds:mutate must NOT be called when every pending RSA is URL-blocked",
    );

    assert.equal(summary.rsasFailed.length, 1);
    assert.equal(summary.rsasFailed[0].localId, "rsa-1");
    assert.match(summary.rsasFailed[0].error, /no final url/i);
    assert.equal(summary.rsasCreated.length, 0);
    assert.equal(summary.partialFailure, true);
  });

  it("partial-fails RSAs whose final_url is not http(s) and still pushes the rest", async () => {
    const { client, calls } = makeFakeClient();
    const t = tree();
    // Add a second RSA with an invalid URL; the first stays valid.
    const goodRsa = t.campaigns[0].ad_groups[0].rsas[0];
    t.campaigns[0].ad_groups[0].rsas = [
      goodRsa,
      { ...goodRsa, id: "rsa-bad", final_url: "ftp://x" },
    ];

    const summary = await pushGoogleSearchPlan({
      tree: t,
      credentials: CREDS,
      eventCode: "J2",
      client,
    });

    // adGroupAds:mutate runs ONCE with only the good RSA.
    const adGroupAdsCalls = calls.filter((c) => c.resource === "adGroupAds");
    assert.equal(adGroupAdsCalls.length, 1);
    assert.equal(adGroupAdsCalls[0].operations.length, 1);

    assert.equal(summary.rsasCreated.length, 1);
    assert.equal(summary.rsasCreated[0].localId, "rsa-1");
    assert.equal(summary.rsasFailed.length, 1);
    assert.equal(summary.rsasFailed[0].localId, "rsa-bad");
    assert.match(summary.rsasFailed[0].error, /not a valid http\(s\) URL/i);
  });
});

// ─── Geo criteria push (Phase geo-criteria) ────────────────────────────

describe("pushGoogleSearchPlan — geo location criteria", () => {
  function treeWithGeo(
    geoTargets: Array<{ location: string; bid_modifier_pct: number | null }>,
  ) {
    const t = tree();
    t.plan.geo_targets = geoTargets;
    return t;
  }

  it("sends campaignCriteria:mutate after campaigns when geo_targets has entries", async () => {
    const { client, calls } = makeFakeClient({
      geoSuggestMap: {
        london: { resourceName: "geoTargetConstants/1006886", displayName: "London" },
      },
    });
    const summary = await pushGoogleSearchPlan({
      tree: treeWithGeo([{ location: "london", bid_modifier_pct: 20 }]),
      credentials: CREDS,
      eventCode: "J2",
      client,
    });

    // campaignCriteria:mutate must appear between campaigns and adGroups.
    const resources = calls.map((c) => c.resource);
    const campIdx = resources.indexOf("campaigns");
    const geoIdx = resources.indexOf("campaignCriteria");
    const agIdx = resources.indexOf("adGroups");
    assert.ok(geoIdx > campIdx, "campaignCriteria must come after campaigns");
    assert.ok(geoIdx < agIdx, "campaignCriteria must come before adGroups");

    // Criterion payload shape.
    assert.equal(calls[geoIdx].options.partialFailure, true);
    assert.equal(calls[geoIdx].operations.length, 1);
    const criterionCreate = (calls[geoIdx].operations[0] as { create: Record<string, unknown> }).create;
    assert.deepEqual(criterionCreate.location, { geoTargetConstant: "geoTargetConstants/1006886" });
    // +20% → bidModifier 1.20
    assert.equal(criterionCreate.bidModifier, 1.2);

    assert.equal(summary.geoTargetsCreated.length, 1);
    assert.equal(summary.geoTargetsCreated[0].location, "london");
    assert.equal(summary.geoTargetsFailed.length, 0);
  });

  it("omits bidModifier when bid_modifier_pct is null", async () => {
    const { client, calls } = makeFakeClient({
      geoSuggestMap: {
        london: { resourceName: "geoTargetConstants/1006886", displayName: "London" },
      },
    });
    await pushGoogleSearchPlan({
      tree: treeWithGeo([{ location: "london", bid_modifier_pct: null }]),
      credentials: CREDS,
      eventCode: "J2",
      client,
    });
    const geoIdx = calls.findIndex((c) => c.resource === "campaignCriteria");
    const criterionCreate = (calls[geoIdx].operations[0] as { create: Record<string, unknown> }).create;
    assert.ok(!("bidModifier" in criterionCreate), "bidModifier must not be present when pct is null");
  });

  it("falls back to the hardcoded map when suggest returns null (london → 1006886)", async () => {
    const { client, calls } = makeFakeClient({
      // Suggest returns nothing — force fallback map.
      geoSuggestMap: { london: null },
    });
    const summary = await pushGoogleSearchPlan({
      tree: treeWithGeo([{ location: "london", bid_modifier_pct: null }]),
      credentials: CREDS,
      eventCode: "J2",
      client,
    });
    const geoIdx = calls.findIndex((c) => c.resource === "campaignCriteria");
    const criterionCreate = (calls[geoIdx].operations[0] as { create: Record<string, unknown> }).create;
    assert.deepEqual(criterionCreate.location, { geoTargetConstant: "geoTargetConstants/1006886" });
    assert.equal(summary.geoTargetsCreated.length, 1);
  });

  it("adds unresolvable location to geoTargetsFailed without crashing the push", async () => {
    const { client, calls } = makeFakeClient({
      geoSuggestMap: { atlantis: null },
    });
    const summary = await pushGoogleSearchPlan({
      tree: treeWithGeo([{ location: "atlantis", bid_modifier_pct: null }]),
      credentials: CREDS,
      eventCode: "J2",
      client,
    });

    // campaignCriteria:mutate must NOT be called — no resolvable targets.
    assert.ok(!calls.some((c) => c.resource === "campaignCriteria"));
    assert.equal(summary.geoTargetsFailed.length, 1);
    assert.equal(summary.geoTargetsFailed[0].location, "atlantis");
    assert.match(summary.geoTargetsFailed[0].error, /could not resolve/i);
    // partialFailure = true because geo failed.
    assert.equal(summary.partialFailure, true);
  });

  it("skips geo criteria when campaign already has pushed_resource_name (idempotency)", async () => {
    const { client, calls } = makeFakeClient({
      geoSuggestMap: {
        london: { resourceName: "geoTargetConstants/1006886", displayName: "London" },
      },
    });
    // Campaign already pushed.
    const t = treeWithGeo([{ location: "london", bid_modifier_pct: 20 }]);
    t.campaigns[0].pushed_resource_name = "customers/7932800197/campaigns/999";

    const summary = await pushGoogleSearchPlan({
      tree: t,
      credentials: CREDS,
      eventCode: "J2",
      client,
    });

    // No campaignCriteria:mutate for a re-pushed campaign.
    assert.ok(!calls.some((c) => c.resource === "campaignCriteria"));
    assert.equal(summary.geoTargetsCreated.length, 0);
    // A warning should be present.
    assert.ok(
      summary.warnings.some((w) => /skipping geo criteria/i.test(w)),
      "Expected a warning about skipped geo criteria",
    );
  });

  it("pushes geo criteria for multiple locations in one campaignCriteria:mutate call", async () => {
    const { client, calls } = makeFakeClient({
      geoSuggestMap: {
        london: { resourceName: "geoTargetConstants/1006886", displayName: "London" },
        "south east": { resourceName: "geoTargetConstants/9049069", displayName: "South East England" },
      },
    });
    const summary = await pushGoogleSearchPlan({
      tree: treeWithGeo([
        { location: "london", bid_modifier_pct: 20 },
        { location: "south east", bid_modifier_pct: 15 },
      ]),
      credentials: CREDS,
      eventCode: "J2",
      client,
    });
    const geoIdx = calls.findIndex((c) => c.resource === "campaignCriteria");
    assert.equal(calls[geoIdx].operations.length, 2);
    assert.equal(summary.geoTargetsCreated.length, 2);
    assert.equal(summary.geoTargetsFailed.length, 0);
  });

  it("no geo targets → no campaignCriteria:mutate (existing test baseline)", async () => {
    const { client, calls } = makeFakeClient();
    await pushGoogleSearchPlan({
      tree: tree(), // geo_targets: []
      credentials: CREDS,
      eventCode: "J2",
      client,
    });
    assert.ok(!calls.some((c) => c.resource === "campaignCriteria"));
  });
});
