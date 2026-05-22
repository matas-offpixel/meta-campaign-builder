/**
 * Phase 3.5 bug-fix tests for `saveGoogleSearchPlanTree`.
 *
 * These are the bug-proof tests for the real-money-severity issue in
 * Phase 3: the wizard autosave (1500 ms debounce) used to nuke-and-
 * rewrite the entire subtree, dropping `pushed_resource_name` on every
 * row. The Phase 3 push adapter uses `pushed_resource_name` as its
 * per-row idempotency signal — so once autosave defeated that, the
 * second push on a live client account would create duplicate
 * campaigns spending real money.
 *
 * All assertions below would have failed against the old nuke-and-
 * rewrite implementation.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  isRealRowId,
  partitionTreeRows,
  saveGoogleSearchPlanTree,
} from "../google-search-plans.ts";
import { MemorySupabase, type RecordedOp } from "./_google-search-memory-supabase.ts";
import type {
  GoogleSearchCampaignNode,
  GoogleSearchPlanTree,
} from "../../google-search/types.ts";

// ─── UUID-format ID constants ─────────────────────────────────────────
// Using real UUID format so isRealRowId() recognises them as existing
// DB rows (updates), mirroring production Postgres behaviour.
const ID = {
  plan:  "11111111-0000-0000-0000-000000000001",
  c1:    "c1111111-0000-0000-0000-000000000001", // pushed campaign
  c2:    "c2222222-0000-0000-0000-000000000002", // unpushed campaign
  ag1:   "a1111111-0000-0000-0000-000000000001", // pushed ad group
  ag2:   "a2222222-0000-0000-0000-000000000002", // unpushed ad group
  kw1:   "b1111111-0000-0000-0000-000000000001", // pushed keyword
  kw2:   "b2222222-0000-0000-0000-000000000002", // unpushed keyword
  rsa1:  "d1111111-0000-0000-0000-000000000001", // pushed RSA
  neg1:  "e1111111-0000-0000-0000-000000000001", // pushed negative
} as const;

// ─── Fixture builders ────────────────────────────────────────────────

function buildSeededTree(): {
  store: MemorySupabase;
  tree: GoogleSearchPlanTree;
} {
  // Two campaigns: C1 already pushed (carries pushed_resource_name on
  // campaign + ad group + keyword + RSA + a campaign-scoped negative).
  // C2 not yet pushed.
  const store = new MemorySupabase({
    google_search_plans: [
      {
        id: ID.plan,
        user_id: "user-1",
        event_id: "evt-1",
        google_ads_account_id: "acct-1",
        name: "Junction 2 Melodic",
        status: "pushed",
        total_budget: 500,
        bidding_strategy: "maximize_clicks",
        geo_targets: [],
        geo_target_type: "PRESENCE",
        date_range: null,
        pushed_at: "2026-05-21T00:00:00Z",
        created_at: "2026-05-21T00:00:00Z",
        updated_at: "2026-05-21T00:00:00Z",
      },
    ],
    google_search_campaigns: [
      {
        id: ID.c1,
        plan_id: ID.plan,
        name: "C1 Brand",
        priority: null,
        monthly_budget: 100,
        daily_budget: null,
        bid_adjustments: {},
        notes: null,
        sort_order: 0,
        pushed_resource_name: "customers/123/campaigns/9001",
        created_at: "2026-05-21T00:00:00Z",
      },
      {
        id: ID.c2,
        plan_id: ID.plan,
        name: "C2 PR",
        priority: null,
        monthly_budget: 200,
        daily_budget: null,
        bid_adjustments: {},
        notes: null,
        sort_order: 1,
        pushed_resource_name: null,
        created_at: "2026-05-21T00:00:00Z",
      },
    ],
    google_search_ad_groups: [
      {
        id: ID.ag1,
        campaign_id: ID.c1,
        name: "Brand-Core",
        default_cpc: 0.25,
        sort_order: 0,
        pushed_resource_name: "customers/123/adGroups/7001",
        created_at: "2026-05-21T00:00:00Z",
      },
      {
        id: ID.ag2,
        campaign_id: ID.c2,
        name: "PR-Bookings",
        default_cpc: null,
        sort_order: 0,
        pushed_resource_name: null,
        created_at: "2026-05-21T00:00:00Z",
      },
    ],
    google_search_keywords: [
      {
        id: ID.kw1,
        ad_group_id: ID.ag1,
        keyword: "junction 2 tickets",
        match_type: "EXACT",
        est_cpc_low: null,
        est_cpc_high: null,
        intent: null,
        notes: null,
        pushed_resource_name: "customers/123/adGroupCriteria/5001",
        created_at: "2026-05-21T00:00:00Z",
      },
      {
        id: ID.kw2,
        ad_group_id: ID.ag2,
        keyword: "junction 2 pr",
        match_type: "PHRASE",
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
        id: ID.rsa1,
        ad_group_id: ID.ag1,
        headlines: [{ text: "Junction 2" }, { text: "Melodic Tickets" }, { text: "Book Now" }],
        descriptions: [{ text: "Limited tickets remaining." }, { text: "Book today." }],
        final_url: "https://offpixel.com/j2",
        path1: null,
        path2: null,
        pushed_resource_name: "customers/123/adGroupAds/3001",
        created_at: "2026-05-21T00:00:00Z",
      },
    ],
    google_search_negatives: [
      {
        id: ID.neg1,
        plan_id: ID.plan,
        campaign_id: null,
        keyword: "free tickets",
        match_type: "PHRASE",
        reason: null,
        pushed_resource_name: "customers/123/adGroupCriteria/2001",
        created_at: "2026-05-21T00:00:00Z",
      },
    ],
  });

  // Clone all rows so mutating the tree doesn't smuggle changes
  // straight into the store (which would defeat assertions about what
  // the save actually wrote).
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const cloneRow = <T>(table: string, id: string): T =>
    clone(store.row(table, id) as unknown as T);

  const tree: GoogleSearchPlanTree = {
    plan: cloneRow<GoogleSearchPlanTree["plan"]>("google_search_plans", ID.plan),
    campaigns: [
      {
        ...cloneRow<GoogleSearchCampaignNode>("google_search_campaigns", ID.c1),
        ad_groups: [
          {
            ...cloneRow<GoogleSearchCampaignNode["ad_groups"][number]>(
              "google_search_ad_groups",
              ID.ag1,
            ),
            keywords: [
              cloneRow<GoogleSearchCampaignNode["ad_groups"][number]["keywords"][number]>(
                "google_search_keywords",
                ID.kw1,
              ),
            ],
            rsas: [
              cloneRow<GoogleSearchCampaignNode["ad_groups"][number]["rsas"][number]>(
                "google_search_rsas",
                ID.rsa1,
              ),
            ],
          },
        ],
        negatives: [],
      },
      {
        ...cloneRow<GoogleSearchCampaignNode>("google_search_campaigns", ID.c2),
        ad_groups: [
          {
            ...cloneRow<GoogleSearchCampaignNode["ad_groups"][number]>(
              "google_search_ad_groups",
              ID.ag2,
            ),
            keywords: [
              cloneRow<GoogleSearchCampaignNode["ad_groups"][number]["keywords"][number]>(
                "google_search_keywords",
                ID.kw2,
              ),
            ],
            rsas: [],
          },
        ],
        negatives: [],
      },
    ],
    plan_negatives: [
      cloneRow<GoogleSearchPlanTree["plan_negatives"][number]>(
        "google_search_negatives",
        ID.neg1,
      ),
    ],
    sitelinks: [],
  };

  return { store, tree };
}

function updatePayloadsFor(ops: RecordedOp[], table: string): Array<Record<string, unknown>> {
  return ops
    .filter((o) => o.op === "update" && o.table === table)
    .map((o) => o.payload as Record<string, unknown>);
}

// ─── 1. partitionTreeRows (pure) ─────────────────────────────────────

describe("partitionTreeRows", () => {
  it("partitions tree rows into update / insert / delete buckets by id", () => {
    const UA = "aaaaaaaa-0000-0000-0000-000000000001";
    const UB = "bbbbbbbb-0000-0000-0000-000000000002";
    const UC = "cccccccc-0000-0000-0000-000000000003";
    const existing = new Set([UA, UB, UC]);
    const tree = [
      { id: UA, name: "A" },
      { id: "tmp-new", name: "D" },
      { id: UB, name: "B" },
    ];
    const plan = partitionTreeRows(existing, tree);
    assert.deepEqual(
      plan.updates.map((r) => r.id),
      [UA, UB],
    );
    assert.deepEqual(
      plan.inserts.map((r) => r.id),
      ["tmp-new"],
    );
    assert.deepEqual(plan.deletes.sort(), [UC]);
  });

  it("empty tree → all existing rows are deletes", () => {
    const UA = "aaaaaaaa-0000-0000-0000-000000000001";
    const UB = "bbbbbbbb-0000-0000-0000-000000000002";
    const plan = partitionTreeRows(new Set([UA, UB]), []);
    assert.deepEqual(plan.updates, []);
    assert.deepEqual(plan.inserts, []);
    assert.deepEqual(plan.deletes.sort(), [UA, UB].sort());
  });

  it("empty existing → all tree rows are inserts", () => {
    const plan = partitionTreeRows(new Set<string>(), [
      { id: "tmp-1", name: "X" },
      { id: "tmp-2", name: "Y" },
    ]);
    assert.deepEqual(
      plan.inserts.map((r) => r.id),
      ["tmp-1", "tmp-2"],
    );
    assert.deepEqual(plan.deletes, []);
  });
});

// ─── 2. saveGoogleSearchPlanTree preserves push markers ──────────────

describe("saveGoogleSearchPlanTree — preserves pushed_resource_name", () => {
  it("editing an unrelated field on the pushed campaign keeps pushed_resource_name + id", async () => {
    const { store, tree } = buildSeededTree();
    // Pretend the user changed C1's monthly budget — the push marker
    // must survive this autosave.
    tree.campaigns[0].monthly_budget = 175;

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    const c1 = store.row("google_search_campaigns", ID.c1);
    assert.ok(c1, "pushed campaign must still exist after save");
    assert.equal(c1.id, ID.c1, "id MUST be preserved (idempotency key)");
    assert.equal(
      c1.pushed_resource_name,
      "customers/123/campaigns/9001",
      "pushed_resource_name MUST survive autosave",
    );
    assert.equal(c1.monthly_budget, 175, "the edited field updated");
  });

  it("UPDATE payload never includes pushed_resource_name", async () => {
    const { store, tree } = buildSeededTree();
    tree.campaigns[0].monthly_budget = 175;
    tree.campaigns[0].ad_groups[0].name = "Brand-Core-Renamed";
    tree.campaigns[0].ad_groups[0].keywords[0].notes = "edited";
    tree.campaigns[0].ad_groups[0].rsas[0].path1 = "tickets";
    tree.plan_negatives[0].reason = "edited";

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    const tablesToCheck = [
      "google_search_campaigns",
      "google_search_ad_groups",
      "google_search_keywords",
      "google_search_rsas",
      "google_search_negatives",
    ];
    for (const t of tablesToCheck) {
      const payloads = updatePayloadsFor(store.ops, t);
      for (const p of payloads) {
        assert.ok(
          !("pushed_resource_name" in p),
          `UPDATE on ${t} must NOT include pushed_resource_name (got keys: ${Object.keys(p).join(", ")})`,
        );
      }
    }
  });

  it("plan UPDATE never includes status or pushed_at (push adapter owns those)", async () => {
    const { store, tree } = buildSeededTree();
    // Try to sneak in a status change — the wizard tree shouldn't
    // be able to flip status via autosave.
    tree.plan.status = "draft";
    tree.plan.name = "Renamed plan";

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    const planUpdates = updatePayloadsFor(store.ops, "google_search_plans");
    assert.equal(planUpdates.length, 1, "plan should update exactly once");
    const payload = planUpdates[0];
    assert.ok(!("status" in payload), "plan UPDATE must not write status");
    assert.ok(!("pushed_at" in payload), "plan UPDATE must not write pushed_at");
    assert.equal(payload.name, "Renamed plan");

    // The actual stored status MUST remain 'pushed' from the seeded fixture.
    const plan = store.row("google_search_plans", ID.plan);
    assert.equal(plan?.status, "pushed", "stored status must not regress to draft");
  });
});

// ─── 3. saveGoogleSearchPlanTree handles add ─────────────────────────

describe("saveGoogleSearchPlanTree — add", () => {
  it("a new campaign (tmp-id) is inserted with null push marker; pushed campaign untouched", async () => {
    const { store, tree } = buildSeededTree();
    tree.campaigns.push({
      id: "tmp-campaign-newone",
      plan_id: ID.plan,
      name: "C3 New",
      priority: null,
      monthly_budget: 50,
      daily_budget: null,
      bid_adjustments: {},
      notes: null,
      sort_order: 2,
      pushed_resource_name: null,
      created_at: "2026-05-21T22:00:00Z",
      ad_groups: [],
      negatives: [],
    });

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    const campaigns = store.rows("google_search_campaigns");
    assert.equal(campaigns.length, 3, "should have 3 campaigns after insert");
    const newCampaign = campaigns.find((c) => c.name === "C3 New");
    assert.ok(newCampaign);
    assert.ok(newCampaign.id.startsWith("db-"), "insert should mint a real id");
    assert.equal(newCampaign.pushed_resource_name, undefined, "new row has no push marker yet");

    // Pushed campaign still pushed.
    const c1 = store.row("google_search_campaigns", ID.c1);
    assert.equal(c1?.pushed_resource_name, "customers/123/campaigns/9001");
  });

  it("a new ad-group + keyword under a pushed campaign inserts cleanly without touching the pushed sibling", async () => {
    const { store, tree } = buildSeededTree();
    tree.campaigns[0].ad_groups.push({
      id: "tmp-ag-fresh",
      campaign_id: ID.c1,
      name: "Brand-Lookalike",
      default_cpc: null,
      sort_order: 1,
      pushed_resource_name: null,
      created_at: "2026-05-21T22:00:00Z",
      keywords: [
        {
          id: "tmp-kw-fresh",
          ad_group_id: "tmp-ag-fresh",
          keyword: "junction 2 brand",
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
    });

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    const adGroups = store.rows("google_search_ad_groups");
    assert.equal(adGroups.length, 3);
    const newAg = adGroups.find((ag) => ag.name === "Brand-Lookalike");
    assert.ok(newAg);
    assert.ok((newAg.id as string).startsWith("db-"));
    assert.equal(newAg.campaign_id, ID.c1, "new ad group's FK resolves to existing campaign id");

    const keywords = store.rows("google_search_keywords");
    const newKw = keywords.find((k) => k.keyword === "junction 2 brand");
    assert.ok(newKw);
    assert.equal(newKw.ad_group_id, newAg.id, "new keyword's FK resolves to the newly-inserted ad group");

    // Pushed sibling ad group + keyword still carry their resource names.
    const pushedAg = store.row("google_search_ad_groups", ID.ag1);
    assert.equal(pushedAg?.pushed_resource_name, "customers/123/adGroups/7001");
    const pushedKw = store.row("google_search_keywords", ID.kw1);
    assert.equal(pushedKw?.pushed_resource_name, "customers/123/adGroupCriteria/5001");
  });
});

// ─── 4. saveGoogleSearchPlanTree handles remove ──────────────────────

describe("saveGoogleSearchPlanTree — remove", () => {
  it("removing the unpushed campaign deletes its row + cascades children; pushed campaign keeps its markers", async () => {
    const { store, tree } = buildSeededTree();
    // Drop C2 (the unpushed one). Cascade should drop ag-2 and kw-2.
    tree.campaigns = tree.campaigns.filter((c) => c.id !== ID.c2);

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    assert.equal(store.row("google_search_campaigns", ID.c2), undefined);
    assert.equal(store.row("google_search_ad_groups", ID.ag2), undefined);
    assert.equal(store.row("google_search_keywords", ID.kw2), undefined);

    // C1 + its push markers fully intact.
    const c1 = store.row("google_search_campaigns", ID.c1);
    assert.equal(c1?.pushed_resource_name, "customers/123/campaigns/9001");
    const ag1 = store.row("google_search_ad_groups", ID.ag1);
    assert.equal(ag1?.pushed_resource_name, "customers/123/adGroups/7001");
    const kw1 = store.row("google_search_keywords", ID.kw1);
    assert.equal(kw1?.pushed_resource_name, "customers/123/adGroupCriteria/5001");
    const rsa1 = store.row("google_search_rsas", ID.rsa1);
    assert.equal(rsa1?.pushed_resource_name, "customers/123/adGroupAds/3001");
    const neg = store.row("google_search_negatives", ID.neg1);
    assert.equal(neg?.pushed_resource_name, "customers/123/adGroupCriteria/2001");
  });

  it("removing a keyword from a pushed campaign deletes only that keyword", async () => {
    const { store, tree } = buildSeededTree();
    // Empty the keyword list on C1's ad group.
    tree.campaigns[0].ad_groups[0].keywords = [];

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    assert.equal(store.row("google_search_keywords", ID.kw1), undefined);
    // Everything else intact.
    assert.equal(
      store.row("google_search_campaigns", ID.c1)?.pushed_resource_name,
      "customers/123/campaigns/9001",
    );
    assert.equal(
      store.row("google_search_ad_groups", ID.ag1)?.pushed_resource_name,
      "customers/123/adGroups/7001",
    );
    assert.equal(
      store.row("google_search_rsas", ID.rsa1)?.pushed_resource_name,
      "customers/123/adGroupAds/3001",
    );
  });
});

// ─── 5. isRealRowId ──────────────────────────────────────────────────

describe("isRealRowId", () => {
  it("accepts well-formed lowercase UUIDs", () => {
    assert.ok(isRealRowId("550e8400-e29b-41d4-a716-446655440000"));
    assert.ok(isRealRowId("00000000-0000-0000-0000-000000000000"));
  });

  it("accepts mixed-case UUIDs (Postgres output)", () => {
    assert.ok(isRealRowId("550E8400-E29B-41D4-A716-446655440000"));
  });

  it("rejects tmp- prefixed ids", () => {
    assert.ok(!isRealRowId("tmp-campaign-abc"));
    assert.ok(!isRealRowId("tmp-"));
    assert.ok(!isRealRowId("tmp-00000000-0000-0000-0000-000000000000"));
  });

  it("rejects empty string / short strings", () => {
    assert.ok(!isRealRowId(""));
    assert.ok(!isRealRowId("abc"));
    assert.ok(!isRealRowId("db-1")); // MemorySupabase fake ids
  });
});

// ─── 6. partitionTreeRows — tmp-id is always INSERT ──────────────────

describe("partitionTreeRows — tmp-id guard", () => {
  it("a tmp-id row is INSERT even if the existing set somehow contains it", () => {
    // This shouldn't happen in practice (a tmp- id can't be a DB UUID),
    // but partitionTreeRows is now explicitly defensive.
    const realUuid = "00000000-1234-5678-abcd-000000000001";
    const existing = new Set(["tmp-ghost", realUuid]);
    const tree = [
      { id: "tmp-ghost", name: "ghost" },
      { id: realUuid, name: "real" },
    ];
    const plan = partitionTreeRows(existing, tree);
    assert.deepEqual(plan.inserts.map((r) => r.id), ["tmp-ghost"]);
    assert.deepEqual(plan.updates.map((r) => r.id), [realUuid]);
    assert.deepEqual(plan.deletes, []);
  });
});

// ─── 7. 500-hotfix regression tests ──────────────────────────────────

describe("saveGoogleSearchPlanTree — 500 hotfix", () => {
  it("save does NOT throw when plan.geo_target_type is undefined (stale client state)", async () => {
    const { store, tree } = buildSeededTree();
    // Simulate a stale client-side tree loaded before Phase-5 added
    // geo_target_type — the field is undefined at runtime despite TS type.
    (tree.plan as unknown as Record<string, unknown>).geo_target_type = undefined;

    await assert.doesNotReject(
      () => saveGoogleSearchPlanTree(store.asSupabase(), tree),
      "save must not throw when geo_target_type is missing at runtime",
    );

    // Verify the plan row was updated (geo_targets serialised to something)
    const planUpdates = updatePayloadsFor(store.ops, "google_search_plans");
    assert.equal(planUpdates.length, 1, "plan update must still run");
    const geoTargets = planUpdates[0].geo_targets as { geo_target_type?: string };
    assert.equal(
      geoTargets?.geo_target_type,
      "PRESENCE",
      "geo_target_type should default to PRESENCE when undefined",
    );
  });

  it("save does NOT throw when plan.geo_targets is null at runtime — critical regression", async () => {
    // THE PRIME SUSPECT for the production 500: normaliseTargets(null)
    // threw `TypeError: null is not iterable` before the hotfix.
    const { store, tree } = buildSeededTree();
    (tree.plan as unknown as Record<string, unknown>).geo_targets = null;

    await assert.doesNotReject(
      () => saveGoogleSearchPlanTree(store.asSupabase(), tree),
      "save must not throw when geo_targets is null at runtime",
    );
  });

  it("save does NOT throw when plan.geo_targets is undefined at runtime", async () => {
    const { store, tree } = buildSeededTree();
    (tree.plan as unknown as Record<string, unknown>).geo_targets = undefined;

    await assert.doesNotReject(
      () => saveGoogleSearchPlanTree(store.asSupabase(), tree),
    );
  });

  it("mixed real-UUID + tmp- tree: save succeeds, tmp rows get real ids, no tmp- id reaches SQL", async () => {
    const { store, tree } = buildSeededTree();

    // Add a new campaign with tmp- ids
    tree.campaigns.push({
      id: "tmp-c-new",
      plan_id: ID.plan,
      name: "C3 Fresh",
      priority: null,
      monthly_budget: 30,
      daily_budget: 1,
      bid_adjustments: {},
      notes: null,
      sort_order: 2,
      pushed_resource_name: null,
      created_at: new Date().toISOString(),
      ad_groups: [
        {
          id: "tmp-ag-new",
          campaign_id: "tmp-c-new",
          name: "Fresh-Core",
          default_cpc: 0.5,
          sort_order: 0,
          pushed_resource_name: null,
          created_at: new Date().toISOString(),
          keywords: [
            {
              id: "tmp-kw-new",
              ad_group_id: "tmp-ag-new",
              keyword: "fresh keyword",
              match_type: "EXACT" as const,
              est_cpc_low: null,
              est_cpc_high: null,
              intent: null,
              notes: null,
              pushed_resource_name: null,
              created_at: new Date().toISOString(),
            },
          ],
          rsas: [],
        },
      ],
      negatives: [],
    });

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    // Verify no tmp- id was passed to any select/insert/update filter
    for (const op of store.ops) {
      const filter = op.filter;
      if (filter?.mode === "in") {
        const vals = filter.val as string[];
        for (const v of vals) {
          assert.ok(
            !v.startsWith("tmp-"),
            `tmp- id "${v}" reached a .in() filter on ${op.table} (op: ${op.op})`,
          );
        }
      }
    }

    // Verify the new campaign got a real id
    const campaigns = store.rows("google_search_campaigns");
    const newCampaign = campaigns.find((c) => c.name === "C3 Fresh");
    assert.ok(newCampaign, "new campaign must be inserted");
    assert.ok(isRealRowId(newCampaign.id as string) || (newCampaign.id as string).startsWith("db-"), "new campaign must have a DB-assigned id");

    // Verify the pushed campaign's push marker survived
    const c1 = store.row("google_search_campaigns", ID.c1);
    assert.equal(c1?.pushed_resource_name, "customers/123/campaigns/9001");
  });

  it("survivingCampaignIds / survivingAdGroupIds never contain tmp- strings", async () => {
    // If all campaigns are updates (none added, none deleted), the
    // surviving-ids arrays are just the update ids — always real UUIDs.
    // This test verifies the .filter(isRealRowId) guard by checking that
    // the select calls on ad_groups / keywords / rsas use only real UUIDs.
    const { store, tree } = buildSeededTree();
    tree.campaigns[0].monthly_budget = 999; // trigger an update

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    const adGroupSelects = store.ops.filter(
      (o) => o.op === "select" && o.table === "google_search_ad_groups",
    );
    for (const op of adGroupSelects) {
      if (op.filter?.mode === "in") {
        const vals = op.filter.val as string[];
        for (const v of vals) {
          assert.ok(!v.startsWith("tmp-"), `tmp- id in ad_groups select: ${v}`);
        }
      }
    }
  });
});

// ─── 9. Round-trip: a no-op save reads back exactly what was stored ──

describe("saveGoogleSearchPlanTree — round-trip", () => {
  it("a save with zero edits performs zero deletes + zero inserts and keeps every push marker", async () => {
    const { store, tree } = buildSeededTree();
    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    const deletes = store.ops.filter((o) => o.op === "delete");
    const inserts = store.ops.filter((o) => o.op === "insert");
    assert.equal(deletes.length, 0, "no-op save should not delete anything");
    assert.equal(inserts.length, 0, "no-op save should not insert anything");

    // Updates happen for every existing row — that's expected (we
    // don't diff field-level changes, only row-level membership). The
    // critical invariant is that pushed_resource_name is preserved.
    for (const table of [
      "google_search_campaigns",
      "google_search_ad_groups",
      "google_search_keywords",
      "google_search_rsas",
      "google_search_negatives",
    ]) {
      for (const row of store.rows(table)) {
        // Rows that originally had a push marker still do.
        if (row.id === ID.c1 || row.id === ID.ag1 || row.id === ID.kw1 || row.id === ID.rsa1 || row.id === ID.neg1) {
          assert.ok(row.pushed_resource_name, `${table}/${row.id} lost its pushed_resource_name`);
        }
      }
    }
  });
});

// ─── Sitelinks: diff-aware save (mirrors negatives table semantics) ──

describe("saveGoogleSearchPlanTree — sitelinks", () => {
  function buildTreeWithSitelinks(): {
    store: MemorySupabase;
    tree: GoogleSearchPlanTree;
  } {
    const SL_ID_PUSHED = "f1111111-0000-0000-0000-000000000001";
    const SL_ID_DRAFT = "f2222222-0000-0000-0000-000000000002";
    const { store, tree } = buildSeededTree();

    // Seed two sitelinks: one already pushed (carries
    // pushed_resource_name), one still draft.
    store.tables.set("google_search_sitelinks", [
      {
        id: SL_ID_PUSHED,
        plan_id: ID.plan,
        link_text: "Tickets",
        description1: "Secure your place",
        description2: "Limited availability",
        final_url: null,
        sort_order: 0,
        pushed_resource_name: "customers/123/assets/7001",
        created_at: "2026-05-21T00:00:00Z",
      },
      {
        id: SL_ID_DRAFT,
        plan_id: ID.plan,
        link_text: "Lineup",
        description1: "See the full lineup",
        description2: "Artists & stages",
        final_url: null,
        sort_order: 1,
        pushed_resource_name: null,
        created_at: "2026-05-21T00:00:00Z",
      },
    ]);

    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    tree.sitelinks = [
      clone(
        store.row("google_search_sitelinks", SL_ID_PUSHED) as unknown as GoogleSearchPlanTree["sitelinks"][number],
      ),
      clone(
        store.row("google_search_sitelinks", SL_ID_DRAFT) as unknown as GoogleSearchPlanTree["sitelinks"][number],
      ),
    ];

    return { store, tree };
  }

  it("editing description on a pushed sitelink keeps pushed_resource_name + id", async () => {
    const { store, tree } = buildTreeWithSitelinks();
    const SL_ID_PUSHED = tree.sitelinks[0].id;
    tree.sitelinks[0].description1 = "Edited copy";

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    const sl = store.row("google_search_sitelinks", SL_ID_PUSHED);
    assert.ok(sl, "pushed sitelink must still exist after save");
    assert.equal(
      sl.pushed_resource_name,
      "customers/123/assets/7001",
      "pushed_resource_name MUST survive autosave (idempotency)",
    );
    assert.equal(sl.description1, "Edited copy");
  });

  it("UPDATE payload never includes pushed_resource_name", async () => {
    const { store, tree } = buildTreeWithSitelinks();
    tree.sitelinks[0].description2 = "tweaked";

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    const updates = updatePayloadsFor(store.ops, "google_search_sitelinks");
    assert.ok(updates.length > 0, "expected at least one sitelink update");
    for (const payload of updates) {
      assert.equal(
        "pushed_resource_name" in payload,
        false,
        "pushed_resource_name MUST NOT appear in sitelink update payloads",
      );
    }
  });

  it("removing a sitelink from the tree deletes it; the other one keeps its push marker", async () => {
    const { store, tree } = buildTreeWithSitelinks();
    const SL_ID_PUSHED = tree.sitelinks[0].id;
    const SL_ID_DRAFT = tree.sitelinks[1].id;
    tree.sitelinks = tree.sitelinks.filter((s) => s.id !== SL_ID_DRAFT);

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    const remaining = store.rows("google_search_sitelinks");
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, SL_ID_PUSHED);
    assert.equal(remaining[0].pushed_resource_name, "customers/123/assets/7001");
  });

  it("adding a new sitelink with a tmp- id inserts it (no FK gymnastics needed)", async () => {
    const { store, tree } = buildTreeWithSitelinks();
    tree.sitelinks.push({
      id: "tmp-sl-faq",
      plan_id: tree.plan.id,
      link_text: "FAQ",
      description1: null,
      description2: null,
      final_url: null,
      sort_order: 2,
      pushed_resource_name: null,
      created_at: new Date().toISOString(),
    });

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    const all = store.rows("google_search_sitelinks");
    assert.equal(all.length, 3);
    const inserted = all.find((r) => r.link_text === "FAQ");
    assert.ok(inserted);
    // Real Postgres replaces the tmp- id with a UUID; the in-memory shim
    // uses `db-N`. Both are "not the tmp- id" — the property the wizard
    // relies on so the next save treats it as an update, not an insert.
    assert.notEqual(inserted!.id, "tmp-sl-faq");
  });
});

