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
  partitionTreeRows,
  saveGoogleSearchPlanTree,
} from "../google-search-plans.ts";
import { MemorySupabase, type RecordedOp } from "./_google-search-memory-supabase.ts";
import type {
  GoogleSearchCampaignNode,
  GoogleSearchPlanTree,
} from "../../google-search/types.ts";

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
        id: "plan-1",
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
        id: "c-1",
        plan_id: "plan-1",
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
        id: "c-2",
        plan_id: "plan-1",
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
        id: "ag-1",
        campaign_id: "c-1",
        name: "Brand-Core",
        default_cpc: 0.25,
        sort_order: 0,
        pushed_resource_name: "customers/123/adGroups/7001",
        created_at: "2026-05-21T00:00:00Z",
      },
      {
        id: "ag-2",
        campaign_id: "c-2",
        name: "PR-Bookings",
        default_cpc: null,
        sort_order: 0,
        pushed_resource_name: null,
        created_at: "2026-05-21T00:00:00Z",
      },
    ],
    google_search_keywords: [
      {
        id: "kw-1",
        ad_group_id: "ag-1",
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
        id: "kw-2",
        ad_group_id: "ag-2",
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
        id: "rsa-1",
        ad_group_id: "ag-1",
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
        id: "neg-1",
        plan_id: "plan-1",
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
    plan: cloneRow<GoogleSearchPlanTree["plan"]>("google_search_plans", "plan-1"),
    campaigns: [
      {
        ...cloneRow<GoogleSearchCampaignNode>("google_search_campaigns", "c-1"),
        ad_groups: [
          {
            ...cloneRow<GoogleSearchCampaignNode["ad_groups"][number]>(
              "google_search_ad_groups",
              "ag-1",
            ),
            keywords: [
              cloneRow<GoogleSearchCampaignNode["ad_groups"][number]["keywords"][number]>(
                "google_search_keywords",
                "kw-1",
              ),
            ],
            rsas: [
              cloneRow<GoogleSearchCampaignNode["ad_groups"][number]["rsas"][number]>(
                "google_search_rsas",
                "rsa-1",
              ),
            ],
          },
        ],
        negatives: [],
      },
      {
        ...cloneRow<GoogleSearchCampaignNode>("google_search_campaigns", "c-2"),
        ad_groups: [
          {
            ...cloneRow<GoogleSearchCampaignNode["ad_groups"][number]>(
              "google_search_ad_groups",
              "ag-2",
            ),
            keywords: [
              cloneRow<GoogleSearchCampaignNode["ad_groups"][number]["keywords"][number]>(
                "google_search_keywords",
                "kw-2",
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
        "neg-1",
      ),
    ],
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
    const existing = new Set(["a", "b", "c"]);
    const tree = [
      { id: "a", name: "A" },
      { id: "tmp-new", name: "D" },
      { id: "b", name: "B" },
    ];
    const plan = partitionTreeRows(existing, tree);
    assert.deepEqual(
      plan.updates.map((r) => r.id),
      ["a", "b"],
    );
    assert.deepEqual(
      plan.inserts.map((r) => r.id),
      ["tmp-new"],
    );
    assert.deepEqual(plan.deletes.sort(), ["c"]);
  });

  it("empty tree → all existing rows are deletes", () => {
    const plan = partitionTreeRows(new Set(["a", "b"]), []);
    assert.deepEqual(plan.updates, []);
    assert.deepEqual(plan.inserts, []);
    assert.deepEqual(plan.deletes.sort(), ["a", "b"]);
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

    const c1 = store.row("google_search_campaigns", "c-1");
    assert.ok(c1, "pushed campaign must still exist after save");
    assert.equal(c1.id, "c-1", "id MUST be preserved (idempotency key)");
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
    const plan = store.row("google_search_plans", "plan-1");
    assert.equal(plan?.status, "pushed", "stored status must not regress to draft");
  });
});

// ─── 3. saveGoogleSearchPlanTree handles add ─────────────────────────

describe("saveGoogleSearchPlanTree — add", () => {
  it("a new campaign (tmp-id) is inserted with null push marker; pushed campaign untouched", async () => {
    const { store, tree } = buildSeededTree();
    tree.campaigns.push({
      id: "tmp-campaign-newone",
      plan_id: "plan-1",
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
    const c1 = store.row("google_search_campaigns", "c-1");
    assert.equal(c1?.pushed_resource_name, "customers/123/campaigns/9001");
  });

  it("a new ad-group + keyword under a pushed campaign inserts cleanly without touching the pushed sibling", async () => {
    const { store, tree } = buildSeededTree();
    tree.campaigns[0].ad_groups.push({
      id: "tmp-ag-fresh",
      campaign_id: "c-1",
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
    assert.equal(newAg.campaign_id, "c-1", "new ad group's FK resolves to existing campaign id");

    const keywords = store.rows("google_search_keywords");
    const newKw = keywords.find((k) => k.keyword === "junction 2 brand");
    assert.ok(newKw);
    assert.equal(newKw.ad_group_id, newAg.id, "new keyword's FK resolves to the newly-inserted ad group");

    // Pushed sibling ad group + keyword still carry their resource names.
    const pushedAg = store.row("google_search_ad_groups", "ag-1");
    assert.equal(pushedAg?.pushed_resource_name, "customers/123/adGroups/7001");
    const pushedKw = store.row("google_search_keywords", "kw-1");
    assert.equal(pushedKw?.pushed_resource_name, "customers/123/adGroupCriteria/5001");
  });
});

// ─── 4. saveGoogleSearchPlanTree handles remove ──────────────────────

describe("saveGoogleSearchPlanTree — remove", () => {
  it("removing the unpushed campaign deletes its row + cascades children; pushed campaign keeps its markers", async () => {
    const { store, tree } = buildSeededTree();
    // Drop C2 (the unpushed one). Cascade should drop ag-2 and kw-2.
    tree.campaigns = tree.campaigns.filter((c) => c.id !== "c-2");

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    assert.equal(store.row("google_search_campaigns", "c-2"), undefined);
    assert.equal(store.row("google_search_ad_groups", "ag-2"), undefined);
    assert.equal(store.row("google_search_keywords", "kw-2"), undefined);

    // C1 + its push markers fully intact.
    const c1 = store.row("google_search_campaigns", "c-1");
    assert.equal(c1?.pushed_resource_name, "customers/123/campaigns/9001");
    const ag1 = store.row("google_search_ad_groups", "ag-1");
    assert.equal(ag1?.pushed_resource_name, "customers/123/adGroups/7001");
    const kw1 = store.row("google_search_keywords", "kw-1");
    assert.equal(kw1?.pushed_resource_name, "customers/123/adGroupCriteria/5001");
    const rsa1 = store.row("google_search_rsas", "rsa-1");
    assert.equal(rsa1?.pushed_resource_name, "customers/123/adGroupAds/3001");
    const neg = store.row("google_search_negatives", "neg-1");
    assert.equal(neg?.pushed_resource_name, "customers/123/adGroupCriteria/2001");
  });

  it("removing a keyword from a pushed campaign deletes only that keyword", async () => {
    const { store, tree } = buildSeededTree();
    // Empty the keyword list on C1's ad group.
    tree.campaigns[0].ad_groups[0].keywords = [];

    await saveGoogleSearchPlanTree(store.asSupabase(), tree);

    assert.equal(store.row("google_search_keywords", "kw-1"), undefined);
    // Everything else intact.
    assert.equal(
      store.row("google_search_campaigns", "c-1")?.pushed_resource_name,
      "customers/123/campaigns/9001",
    );
    assert.equal(
      store.row("google_search_ad_groups", "ag-1")?.pushed_resource_name,
      "customers/123/adGroups/7001",
    );
    assert.equal(
      store.row("google_search_rsas", "rsa-1")?.pushed_resource_name,
      "customers/123/adGroupAds/3001",
    );
  });
});

// ─── 5. Round-trip: a no-op save reads back exactly what was stored ──

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
        if (row.id === "c-1" || row.id === "ag-1" || row.id === "kw-1" || row.id === "rsa-1" || row.id === "neg-1") {
          assert.ok(row.pushed_resource_name, `${table}/${row.id} lost its pushed_resource_name`);
        }
      }
    }
  });
});
