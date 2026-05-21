/**
 * End-to-end Phase 3.5 regression test for the real-money bug:
 *
 *   push → autosave (wizard edit) → push again
 *
 * Before Phase 3.5, the second push duplicated every campaign on the
 * live Google Ads account because `saveGoogleSearchPlanTree` was
 * nuke-and-rewrite and dropped `pushed_resource_name`. The Phase 3
 * adapter's per-row idempotency check (skip if `pushed_resource_name`
 * is non-null) was silently defeated.
 *
 * After Phase 3.5: the save preserves `pushed_resource_name`, so the
 * second push issues ZERO mutate calls (every row is marked reused).
 * This test asserts that exact outcome.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { saveGoogleSearchPlanTree } from "../../db/google-search-plans.ts";
import { MemorySupabase } from "../../db/__tests__/_google-search-memory-supabase.ts";
import {
  pushGoogleSearchPlan,
  type GoogleSearchPushPersister,
} from "../campaign-writer.ts";
import type { GoogleAdsCustomerCredentials } from "../client.ts";
import type {
  GoogleSearchCampaignNode,
  GoogleSearchPlanTree,
} from "../../google-search/types.ts";

const CUSTOMER_ID = "7932800197";
const CREDS: GoogleAdsCustomerCredentials = {
  customerId: "793-280-0197",
  refreshToken: "refresh-token",
  loginCustomerId: "333-703-8088",
};

function makeFakeClient() {
  const calls: Array<{ resource: string; operationCount: number }> = [];
  let seq = 1000;
  const client = {
    async mutate(
      _creds: GoogleAdsCustomerCredentials,
      resource: string,
      operations: Array<unknown>,
      _opts: { partialFailure?: boolean; validateOnly?: boolean } = {},
    ) {
      calls.push({ resource, operationCount: operations.length });
      return {
        results: operations.map(() => ({
          resourceName: `customers/${CUSTOMER_ID}/${resource}/${seq++}`,
        })),
      };
    },
  };
  return { client: client as unknown as Parameters<typeof pushGoogleSearchPlan>[0]["client"], calls };
}

function buildFreshTree(): { store: MemorySupabase; tree: GoogleSearchPlanTree } {
  const store = new MemorySupabase({
    google_search_plans: [
      {
        id: "00000000-0000-0000-0000-000000000001",
        user_id: "user-1",
        event_id: "evt-1",
        google_ads_account_id: "acct-1",
        name: "Junction 2 Melodic",
        status: "draft",
        total_budget: 500,
        bidding_strategy: "maximize_clicks",
        geo_targets: [],
        geo_target_type: "PRESENCE",
        date_range: null,
        pushed_at: null,
        created_at: "2026-05-21T00:00:00Z",
        updated_at: "2026-05-21T00:00:00Z",
      },
    ],
    google_search_campaigns: [
      {
        id: "00000000-0000-0000-0000-000000000002",
        plan_id: "00000000-0000-0000-0000-000000000001",
        name: "C1 Brand",
        priority: null,
        monthly_budget: 150,
        daily_budget: null,
        bid_adjustments: {},
        notes: null,
        sort_order: 0,
        pushed_resource_name: null,
        created_at: "2026-05-21T00:00:00Z",
      },
    ],
    google_search_ad_groups: [
      {
        id: "00000000-0000-0000-0000-000000000003",
        campaign_id: "00000000-0000-0000-0000-000000000002",
        name: "Brand",
        default_cpc: null,
        sort_order: 0,
        pushed_resource_name: null,
        created_at: "2026-05-21T00:00:00Z",
      },
    ],
    google_search_keywords: [
      {
        id: "00000000-0000-0000-0000-000000000004",
        ad_group_id: "00000000-0000-0000-0000-000000000003",
        keyword: "junction 2 tickets",
        match_type: "EXACT",
        est_cpc_low: null,
        est_cpc_high: null,
        intent: null,
        notes: null,
        pushed_resource_name: null,
        created_at: "2026-05-21T00:00:00Z",
      },
    ],
    google_search_rsas: [
      {
        id: "00000000-0000-0000-0000-000000000005",
        ad_group_id: "00000000-0000-0000-0000-000000000003",
        headlines: [{ text: "Junction 2" }, { text: "Melodic Tickets" }, { text: "Book Now" }],
        descriptions: [{ text: "Limited tickets remaining." }, { text: "Book today." }],
        final_url: "https://offpixel.com/j2",
        path1: null,
        path2: null,
        pushed_resource_name: null,
        created_at: "2026-05-21T00:00:00Z",
      },
    ],
    google_search_negatives: [
      {
        id: "00000000-0000-0000-0000-000000000006",
        plan_id: "00000000-0000-0000-0000-000000000001",
        campaign_id: null,
        keyword: "free tickets",
        match_type: "PHRASE",
        reason: null,
        pushed_resource_name: null,
        created_at: "2026-05-21T00:00:00Z",
      },
    ],
  });

  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const cloneRow = <T>(table: string, id: string): T =>
    clone(store.row(table, id) as unknown as T);

  const tree: GoogleSearchPlanTree = {
    plan: cloneRow<GoogleSearchPlanTree["plan"]>("google_search_plans", "00000000-0000-0000-0000-000000000001"),
    campaigns: [
      {
        ...cloneRow<GoogleSearchCampaignNode>("google_search_campaigns", "00000000-0000-0000-0000-000000000002"),
        ad_groups: [
          {
            ...cloneRow<GoogleSearchCampaignNode["ad_groups"][number]>(
              "google_search_ad_groups",
              "00000000-0000-0000-0000-000000000003",
            ),
            keywords: [
              cloneRow<GoogleSearchCampaignNode["ad_groups"][number]["keywords"][number]>(
                "google_search_keywords",
                "00000000-0000-0000-0000-000000000004",
              ),
            ],
            rsas: [
              cloneRow<GoogleSearchCampaignNode["ad_groups"][number]["rsas"][number]>(
                "google_search_rsas",
                "00000000-0000-0000-0000-000000000005",
              ),
            ],
          },
        ],
        negatives: [],
      },
    ],
    plan_negatives: [
      cloneRow<GoogleSearchPlanTree["plan_negatives"][number]>(
        "google_search_negatives",
        "00000000-0000-0000-0000-000000000006",
      ),
    ],
  };

  return { store, tree };
}

/**
 * Build the persister the route uses, wired against the in-memory store.
 * Identical surface to the real route's persister — bare per-row updates
 * via Supabase REST.
 */
function buildPersister(store: MemorySupabase): GoogleSearchPushPersister {
  return {
    async setCampaignResource(id, rn) {
      await store.asSupabase().from("google_search_campaigns").update({ pushed_resource_name: rn }).eq("id", id);
    },
    async setAdGroupResource(id, rn) {
      await store.asSupabase().from("google_search_ad_groups").update({ pushed_resource_name: rn }).eq("id", id);
    },
    async setKeywordResource(id, rn) {
      await store.asSupabase().from("google_search_keywords").update({ pushed_resource_name: rn }).eq("id", id);
    },
    async setNegativeResource(id, rn) {
      await store.asSupabase().from("google_search_negatives").update({ pushed_resource_name: rn }).eq("id", id);
    },
    async setRsaResource(id, rn) {
      await store.asSupabase().from("google_search_rsas").update({ pushed_resource_name: rn }).eq("id", id);
    },
    async setPlanStatus(id, status, pushedAt) {
      await store.asSupabase().from("google_search_plans").update({ status, pushed_at: pushedAt }).eq("id", id);
    },
  };
}

/**
 * Sync the tree's push markers (and ids — though they didn't change
 * here) from the in-memory store so subsequent saves carry them.
 * Mirrors what the real wizard does via `loadGoogleSearchPlanTree`
 * after each save round-trip.
 */
function reloadTreeFromStore(store: MemorySupabase, tree: GoogleSearchPlanTree): GoogleSearchPlanTree {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const updated: GoogleSearchPlanTree = {
    plan: clone(store.row("google_search_plans", tree.plan.id) as unknown as GoogleSearchPlanTree["plan"]),
    campaigns: tree.campaigns.map((c) => {
      const stored = store.row("google_search_campaigns", c.id);
      return {
        ...c,
        ...clone(stored as unknown as object),
        ad_groups: c.ad_groups.map((ag) => {
          const storedAg = store.row("google_search_ad_groups", ag.id);
          return {
            ...ag,
            ...clone(storedAg as unknown as object),
            keywords: ag.keywords.map((k) => ({
              ...k,
              ...clone(store.row("google_search_keywords", k.id) as unknown as object),
            })),
            rsas: ag.rsas.map((r) => ({
              ...r,
              ...clone(store.row("google_search_rsas", r.id) as unknown as object),
            })),
          } as GoogleSearchCampaignNode["ad_groups"][number];
        }),
        negatives: c.negatives,
      } as GoogleSearchCampaignNode;
    }),
    plan_negatives: tree.plan_negatives.map((n) => ({
      ...n,
      ...clone(store.row("google_search_negatives", n.id) as unknown as object),
    })),
  };
  return updated;
}

describe("Phase 3.5 — re-push idempotency end-to-end", () => {
  it("push → autosave → push again issues ZERO mutate calls (per-row idempotency intact)", async () => {
    const { store, tree } = buildFreshTree();
    const persister = buildPersister(store);
    const { client: firstClient, calls: firstCalls } = makeFakeClient();

    // ── Round 1: real push ──────────────────────────────────────────
    const firstSummary = await pushGoogleSearchPlan({
      tree,
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client: firstClient,
      persister,
    });
    assert.equal(firstSummary.ok, true);
    assert.equal(firstSummary.campaignsCreated.length, 1);
    assert.equal(firstSummary.campaignsCreated[0].reused, undefined);
    // The standard 5-step chain ran exactly once.
    assert.deepEqual(
      firstCalls.map((c) => c.resource),
      ["campaignBudgets", "campaigns", "adGroups", "adGroupCriteria", "adGroupAds"],
    );

    // The persister stamped pushed_resource_name onto every row.
    assert.ok(store.row("google_search_campaigns", "00000000-0000-0000-0000-000000000002")?.pushed_resource_name);
    assert.ok(store.row("google_search_ad_groups", "00000000-0000-0000-0000-000000000003")?.pushed_resource_name);
    assert.ok(store.row("google_search_keywords", "00000000-0000-0000-0000-000000000004")?.pushed_resource_name);
    assert.ok(store.row("google_search_rsas", "00000000-0000-0000-0000-000000000005")?.pushed_resource_name);
    assert.ok(store.row("google_search_negatives", "00000000-0000-0000-0000-000000000006")?.pushed_resource_name);
    assert.equal(store.row("google_search_plans", "00000000-0000-0000-0000-000000000001")?.status, "pushed");

    // ── Round 2: wizard autosave after the operator tweaks something ─
    const treeAfterPush = reloadTreeFromStore(store, tree);
    // Operator edits the campaign budget — push markers must survive.
    treeAfterPush.campaigns[0].monthly_budget = 175;
    await saveGoogleSearchPlanTree(store.asSupabase(), treeAfterPush);

    // Markers must still be present on every row after autosave.
    assert.ok(
      store.row("google_search_campaigns", "00000000-0000-0000-0000-000000000002")?.pushed_resource_name,
      "BUG REGRESSION: autosave nuked the campaign's pushed_resource_name",
    );
    assert.ok(
      store.row("google_search_ad_groups", "00000000-0000-0000-0000-000000000003")?.pushed_resource_name,
      "BUG REGRESSION: autosave nuked the ad group's pushed_resource_name",
    );
    assert.ok(
      store.row("google_search_keywords", "00000000-0000-0000-0000-000000000004")?.pushed_resource_name,
      "BUG REGRESSION: autosave nuked the keyword's pushed_resource_name",
    );
    assert.ok(
      store.row("google_search_rsas", "00000000-0000-0000-0000-000000000005")?.pushed_resource_name,
      "BUG REGRESSION: autosave nuked the RSA's pushed_resource_name",
    );
    assert.ok(
      store.row("google_search_negatives", "00000000-0000-0000-0000-000000000006")?.pushed_resource_name,
      "BUG REGRESSION: autosave nuked the negative's pushed_resource_name",
    );
    // Status must NOT be flipped back to draft by autosave.
    assert.equal(store.row("google_search_plans", "00000000-0000-0000-0000-000000000001")?.status, "pushed");

    // ── Round 3: re-push (the worst-case double-click scenario) ─────
    const treeForRepush = reloadTreeFromStore(store, treeAfterPush);
    const { client: secondClient, calls: secondCalls } = makeFakeClient();
    const secondSummary = await pushGoogleSearchPlan({
      tree: treeForRepush,
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client: secondClient,
      persister,
    });

    // THE CRITICAL ASSERTION: zero mutate calls on the second push.
    assert.equal(
      secondCalls.length,
      0,
      `EXPECTED zero Google Ads mutate calls on re-push; got ${secondCalls.length} (${secondCalls.map((c) => c.resource).join(", ")}). This would mean duplicate live campaigns on a real account.`,
    );

    // Summary reports every row as reused.
    assert.equal(secondSummary.ok, true);
    assert.equal(secondSummary.campaignsCreated.length, 1);
    assert.equal(secondSummary.campaignsCreated[0].reused, true);
    assert.equal(secondSummary.adGroupsCreated[0].reused, true);
    assert.equal(secondSummary.keywordsCreated[0].reused, true);
    assert.equal(secondSummary.rsasCreated[0].reused, true);
    assert.equal(secondSummary.negativesCreated[0].reused, true);
    assert.equal(secondSummary.partialFailure, false);
  });

  it("autosave + adding a new campaign → re-push creates ONLY the new campaign", async () => {
    const { store, tree } = buildFreshTree();
    const persister = buildPersister(store);
    const { client: firstClient } = makeFakeClient();

    await pushGoogleSearchPlan({
      tree,
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client: firstClient,
      persister,
    });

    // Operator adds a fresh campaign via the wizard (tmp- id).
    const treeAfterPush = reloadTreeFromStore(store, tree);
    treeAfterPush.campaigns.push({
      id: "tmp-campaign-2",
      plan_id: "00000000-0000-0000-0000-000000000001",
      name: "C2 Lookalike",
      priority: null,
      monthly_budget: 80,
      daily_budget: null,
      bid_adjustments: {},
      notes: null,
      sort_order: 1,
      pushed_resource_name: null,
      created_at: "2026-05-21T22:00:00Z",
      ad_groups: [
        {
          id: "tmp-ag-2",
          campaign_id: "tmp-campaign-2",
          name: "LAL",
          default_cpc: null,
          sort_order: 0,
          pushed_resource_name: null,
          created_at: "2026-05-21T22:00:00Z",
          keywords: [
            {
              id: "tmp-kw-2",
              ad_group_id: "tmp-ag-2",
              keyword: "junction 2 lal",
              match_type: "PHRASE",
              est_cpc_low: null,
              est_cpc_high: null,
              intent: null,
              notes: null,
              pushed_resource_name: null,
              created_at: "2026-05-21T22:00:00Z",
            },
          ],
          rsas: [],
        },
      ],
      negatives: [],
    });

    await saveGoogleSearchPlanTree(store.asSupabase(), treeAfterPush);

    // The added campaign got a real id (db-N).
    const allCampaigns = store.rows("google_search_campaigns");
    assert.equal(allCampaigns.length, 2);
    const newCampaign = allCampaigns.find((c) => c.name === "C2 Lookalike");
    assert.ok(newCampaign);
    assert.ok((newCampaign.id as string).startsWith("db-"));

    // ── Re-push (with the wizard re-load) ───────────────────────────
    const treeForRepush = reloadTreeFromStore(store, {
      ...treeAfterPush,
      campaigns: treeAfterPush.campaigns.map((c) =>
        c.id.startsWith("tmp-")
          ? {
              ...c,
              id: newCampaign.id as string,
              ad_groups: c.ad_groups.map((ag) => {
                const storedAg = store
                  .rows("google_search_ad_groups")
                  .find((row) => row.campaign_id === newCampaign.id);
                return {
                  ...ag,
                  id: (storedAg?.id as string) ?? ag.id,
                  keywords: ag.keywords.map((k) => {
                    const storedKw = store
                      .rows("google_search_keywords")
                      .find((row) => row.ad_group_id === storedAg?.id);
                    return { ...k, id: (storedKw?.id as string) ?? k.id };
                  }),
                };
              }),
            }
          : c,
      ),
    });

    const { client: secondClient, calls: secondCalls } = makeFakeClient();
    const secondSummary = await pushGoogleSearchPlan({
      tree: treeForRepush,
      credentials: CREDS,
      eventCode: "J2-MELODIC",
      client: secondClient,
      persister,
    });

    // Round 2 calls the chain for the NEW campaign only (the new
    // ad-group has zero RSAs in this fixture, so adGroupAds is
    // correctly skipped — the writer doesn't issue empty mutates):
    assert.deepEqual(
      secondCalls.map((c) => c.resource),
      ["campaignBudgets", "campaigns", "adGroups", "adGroupCriteria"],
      "second push should hit the chain exactly once (for the new campaign only)",
    );

    // Summary: C1 reused, C2 newly created.
    assert.equal(secondSummary.campaignsCreated.length, 2);
    const reusedFlags = secondSummary.campaignsCreated.map((c) => !!c.reused).sort();
    assert.deepEqual(reusedFlags, [false, true]);
  });
});
