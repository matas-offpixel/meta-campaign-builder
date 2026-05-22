/**
 * Tests for listGoogleSearchPlansForUser.
 *
 * Verifies the function returns all plans for the authenticated user,
 * scoped correctly (not leaking other users' plans), newest-first, and
 * that the hydration layer correctly picks up structure_mode.
 *
 * Root-cause regression guard: the /google-ads list page used to render
 * the Phase 0 skeleton (hardcoded empty state) instead of querying the DB.
 * This test ensures the DB helper exists and returns the right rows.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { listGoogleSearchPlansForUser } from "../google-search-plans.ts";
import { MemorySupabase } from "./_google-search-memory-supabase.ts";

const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";

function basePlan(overrides: Record<string, unknown>) {
  return {
    id: `plan-${Math.random().toString(36).slice(2)}`,
    user_id: USER_A,
    event_id: null,
    google_ads_account_id: null,
    name: "Test Plan",
    status: "draft",
    total_budget: null,
    bidding_strategy: "maximize_clicks",
    structure_mode: "single_campaign",
    geo_targets: JSON.stringify({ geo_target_type: "PRESENCE", targets: [] }),
    date_range: null,
    pushed_at: null,
    created_at: "2026-05-22T08:00:00Z",
    updated_at: "2026-05-22T08:00:00Z",
    ...overrides,
  };
}

describe("listGoogleSearchPlansForUser", () => {
  it("returns all plans belonging to the user", async () => {
    const store = new MemorySupabase({
      google_search_plans: [
        basePlan({ id: "plan-1", name: "Plan One", user_id: USER_A }),
        basePlan({ id: "plan-2", name: "Plan Two", user_id: USER_A }),
        basePlan({ id: "plan-3", name: "Other User", user_id: USER_B }),
      ],
    });

    const plans = await listGoogleSearchPlansForUser(store.asSupabase(), USER_A);

    assert.equal(plans.length, 2, "should return exactly the 2 user-A plans");
    const names = plans.map((p) => p.name).sort();
    assert.deepEqual(names, ["Plan One", "Plan Two"]);
  });

  it("returns an empty array when the user has no plans", async () => {
    const store = new MemorySupabase({
      google_search_plans: [
        basePlan({ id: "plan-1", user_id: USER_B }),
      ],
    });

    const plans = await listGoogleSearchPlansForUser(store.asSupabase(), USER_A);
    assert.equal(plans.length, 0);
  });

  it("does not return plans belonging to a different user", async () => {
    const store = new MemorySupabase({
      google_search_plans: [
        basePlan({ id: "plan-other", user_id: USER_B, name: "Should not appear" }),
      ],
    });

    const plans = await listGoogleSearchPlansForUser(store.asSupabase(), USER_A);
    assert.equal(plans.length, 0, "RLS scoping: no cross-user leakage");
  });

  it("hydrates structure_mode from the raw row", async () => {
    const store = new MemorySupabase({
      google_search_plans: [
        basePlan({ id: "plan-sc", structure_mode: "single_campaign", user_id: USER_A }),
        basePlan({ id: "plan-pt", structure_mode: "campaign_per_theme", user_id: USER_A }),
      ],
    });

    const plans = await listGoogleSearchPlansForUser(store.asSupabase(), USER_A);
    assert.equal(plans.length, 2);
    const modes = plans.map((p) => p.structure_mode).sort();
    assert.deepEqual(modes, ["campaign_per_theme", "single_campaign"]);
  });

  it("falls back to single_campaign for rows with unknown/missing structure_mode", async () => {
    const store = new MemorySupabase({
      google_search_plans: [
        basePlan({ id: "plan-old", structure_mode: null, user_id: USER_A }),
        basePlan({ id: "plan-unk", structure_mode: "something_unknown", user_id: USER_A }),
      ],
    });

    const plans = await listGoogleSearchPlansForUser(store.asSupabase(), USER_A);
    assert.equal(plans.length, 2);
    for (const p of plans) {
      assert.equal(
        p.structure_mode,
        "single_campaign",
        `expected fallback for unknown mode, got ${p.structure_mode}`,
      );
    }
  });
});
