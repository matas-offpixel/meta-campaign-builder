import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  addAdGroup,
  addCampaign,
  addKeyword,
  addNegative,
  addRsa,
  moveCampaign,
  removeCampaign,
  removeKeyword,
  setRsaDescriptions,
  setRsaHeadlines,
  updateAdGroup,
  updateCampaign,
  updateKeyword,
  updatePlan,
} from "../tree-mutations.ts";
import { parseBidModifierInput } from "../bid-modifier.ts";
import type { GoogleSearchPlanTree } from "../types.ts";

function emptyTree(): GoogleSearchPlanTree {
  return {
    plan: {
      id: "p-1",
      user_id: "u-1",
      event_id: null,
      google_ads_account_id: null,
      name: "Test",
      status: "draft",
      total_budget: null,
      bidding_strategy: "maximize_clicks",
      structure_mode: "single_campaign",
      geo_targets: [],
      geo_target_type: "PRESENCE",
      date_range: null,
      pushed_at: null,
      created_at: "2026-05-21T00:00:00Z",
      updated_at: "2026-05-21T00:00:00Z",
    },
    campaigns: [],
    plan_negatives: [],
  };
}

describe("tree-mutations — immutability", () => {
  it("addCampaign returns a new tree without mutating the original", () => {
    const tree = emptyTree();
    const before = tree.campaigns;
    const next = addCampaign(tree);
    assert.notEqual(next, tree);
    assert.notEqual(next.campaigns, before);
    assert.equal(tree.campaigns.length, 0);
    assert.equal(next.campaigns.length, 1);
  });

  it("removeCampaign reindexes sort_order on remaining rows", () => {
    let tree = emptyTree();
    tree = addCampaign(tree);
    tree = addCampaign(tree);
    tree = addCampaign(tree);
    const middle = tree.campaigns[1].id;
    tree = removeCampaign(tree, middle);
    assert.equal(tree.campaigns.length, 2);
    assert.deepEqual(
      tree.campaigns.map((c) => c.sort_order),
      [0, 1],
    );
  });

  it("moveCampaign swaps positions and rewrites sort_order", () => {
    let tree = emptyTree();
    tree = addCampaign(tree);
    tree = updateCampaign(tree, tree.campaigns[0].id, { name: "A" });
    tree = addCampaign(tree);
    tree = updateCampaign(tree, tree.campaigns[1].id, { name: "B" });

    const second = tree.campaigns[1].id;
    tree = moveCampaign(tree, second, -1);
    assert.deepEqual(
      tree.campaigns.map((c) => c.name),
      ["B", "A"],
    );
    assert.deepEqual(
      tree.campaigns.map((c) => c.sort_order),
      [0, 1],
    );
  });
});

describe("tree-mutations — nested edits", () => {
  it("addKeyword adds under the right ad group", () => {
    let tree = emptyTree();
    tree = addCampaign(tree);
    const campaignId = tree.campaigns[0].id;
    tree = addAdGroup(tree, campaignId);
    const adGroupId = tree.campaigns[0].ad_groups[0].id;
    tree = addKeyword(tree, campaignId, adGroupId, "tickets", "EXACT");
    assert.equal(tree.campaigns[0].ad_groups[0].keywords.length, 1);
    assert.equal(tree.campaigns[0].ad_groups[0].keywords[0].keyword, "tickets");
    assert.equal(tree.campaigns[0].ad_groups[0].keywords[0].match_type, "EXACT");
  });

  it("updateKeyword patches in place without disturbing siblings", () => {
    let tree = emptyTree();
    tree = addCampaign(tree);
    const campaignId = tree.campaigns[0].id;
    tree = addAdGroup(tree, campaignId);
    const adGroupId = tree.campaigns[0].ad_groups[0].id;
    tree = addKeyword(tree, campaignId, adGroupId, "tickets");
    tree = addKeyword(tree, campaignId, adGroupId, "vip tickets");
    const firstId = tree.campaigns[0].ad_groups[0].keywords[0].id;
    tree = updateKeyword(tree, campaignId, adGroupId, firstId, { match_type: "BROAD" });
    assert.equal(tree.campaigns[0].ad_groups[0].keywords[0].match_type, "BROAD");
    assert.equal(tree.campaigns[0].ad_groups[0].keywords[1].match_type, "PHRASE");
  });

  it("removeKeyword removes one and keeps the other", () => {
    let tree = emptyTree();
    tree = addCampaign(tree);
    const campaignId = tree.campaigns[0].id;
    tree = addAdGroup(tree, campaignId);
    const adGroupId = tree.campaigns[0].ad_groups[0].id;
    tree = addKeyword(tree, campaignId, adGroupId, "a");
    tree = addKeyword(tree, campaignId, adGroupId, "b");
    const firstId = tree.campaigns[0].ad_groups[0].keywords[0].id;
    tree = removeKeyword(tree, campaignId, adGroupId, firstId);
    assert.equal(tree.campaigns[0].ad_groups[0].keywords.length, 1);
    assert.equal(tree.campaigns[0].ad_groups[0].keywords[0].keyword, "b");
  });

  it("setRsaHeadlines / setRsaDescriptions overwrite arrays atomically", () => {
    let tree = emptyTree();
    tree = addCampaign(tree);
    const campaignId = tree.campaigns[0].id;
    tree = addAdGroup(tree, campaignId);
    const adGroupId = tree.campaigns[0].ad_groups[0].id;
    tree = addRsa(tree, campaignId, adGroupId);
    const rsaId = tree.campaigns[0].ad_groups[0].rsas[0].id;
    tree = setRsaHeadlines(tree, campaignId, adGroupId, rsaId, [
      { text: "Headline 1" },
      { text: "Headline 2" },
      { text: "Headline 3" },
    ]);
    tree = setRsaDescriptions(tree, campaignId, adGroupId, rsaId, [
      { text: "Description 1" },
      { text: "Description 2" },
    ]);
    const rsa = tree.campaigns[0].ad_groups[0].rsas[0];
    assert.equal(rsa.headlines.length, 3);
    assert.equal(rsa.descriptions.length, 2);
  });

  it("updateAdGroup persists per-ad-group fields", () => {
    let tree = emptyTree();
    tree = addCampaign(tree);
    const campaignId = tree.campaigns[0].id;
    tree = addAdGroup(tree, campaignId);
    const adGroupId = tree.campaigns[0].ad_groups[0].id;
    tree = updateAdGroup(tree, campaignId, adGroupId, { default_cpc: 1.25, name: "Brand" });
    assert.equal(tree.campaigns[0].ad_groups[0].default_cpc, 1.25);
    assert.equal(tree.campaigns[0].ad_groups[0].name, "Brand");
  });
});

describe("tree-mutations — negatives", () => {
  it("addNegative scope=plan appends to plan_negatives", () => {
    let tree = emptyTree();
    tree = addNegative(tree, { kind: "plan" }, "free", "PHRASE");
    assert.equal(tree.plan_negatives.length, 1);
    assert.equal(tree.plan_negatives[0].keyword, "free");
    assert.equal(tree.plan_negatives[0].campaign_id, null);
  });

  it("addNegative scope=campaign appends under the right campaign", () => {
    let tree = emptyTree();
    tree = addCampaign(tree);
    const cid = tree.campaigns[0].id;
    tree = addNegative(tree, { kind: "campaign", campaign_id: cid }, "promo");
    assert.equal(tree.plan_negatives.length, 0);
    assert.equal(tree.campaigns[0].negatives.length, 1);
    assert.equal(tree.campaigns[0].negatives[0].campaign_id, cid);
  });
});

describe("tree-mutations — plan updates", () => {
  it("updatePlan patches plan-level fields", () => {
    const tree = emptyTree();
    const next = updatePlan(tree, { google_ads_account_id: "acct-1", total_budget: 500 });
    assert.equal(next.plan.google_ads_account_id, "acct-1");
    assert.equal(next.plan.total_budget, 500);
    assert.equal(tree.plan.google_ads_account_id, null, "original untouched");
  });
});

// ─── Bug 2: daily_budget persistence via updateCampaign ──────────────
//
// Confirms that the Campaigns-step onChange wiring correctly writes
// `daily_budget` into the tree state so the autosave payload includes it.

describe("tree-mutations — daily_budget (Bug 2 regression)", () => {
  it("updateCampaign with { daily_budget: 1 } sets the value on the target campaign", () => {
    let t = emptyTree();
    t = addCampaign(t);
    const cid = t.campaigns[0].id;
    assert.equal(t.campaigns[0].daily_budget, null, "starts null");
    const next = updateCampaign(t, cid, { daily_budget: 1 });
    assert.equal(next.campaigns[0].daily_budget, 1);
    assert.equal(t.campaigns[0].daily_budget, null, "original untouched");
  });

  it("updateCampaign with { daily_budget: null } clears the value", () => {
    let t = emptyTree();
    t = addCampaign(t);
    const cid = t.campaigns[0].id;
    let next = updateCampaign(t, cid, { daily_budget: 5 });
    next = updateCampaign(next, cid, { daily_budget: null });
    assert.equal(next.campaigns[0].daily_budget, null);
  });

  it("bulk-set logic: chained updateCampaign updates all campaigns without losing earlier changes", () => {
    let t = emptyTree();
    t = addCampaign(t);
    t = addCampaign(t);
    t = addCampaign(t);
    // Simulate the applyBulkDaily loop in the Campaigns step component.
    let next = t;
    for (const c of t.campaigns) {
      next = updateCampaign(next, c.id, { daily_budget: 1 });
    }
    assert.equal(next.campaigns.length, 3);
    assert.equal(next.campaigns[0].daily_budget, 1);
    assert.equal(next.campaigns[1].daily_budget, 1);
    assert.equal(next.campaigns[2].daily_budget, 1);
  });

  it("updateCampaign only touches the targeted campaign, not siblings", () => {
    let t = emptyTree();
    t = addCampaign(t);
    t = addCampaign(t);
    const [c0, c1] = t.campaigns;
    const next = updateCampaign(t, c0.id, { daily_budget: 5 });
    assert.equal(next.campaigns[0].daily_budget, 5);
    assert.equal(next.campaigns[1].daily_budget, null, "sibling untouched");
    assert.equal(next.campaigns[1].id, c1.id);
  });
});

// ─── Bug 3: parseBidModifierInput ────────────────────────────────────
//
// Verifies that the bid-modifier text input's custom parser correctly
// handles "+20", "20", "-10" and edge cases. This parser was introduced
// to replace `Number(e.target.value)` on a `type="number"` input, which
// causes browsers to silently return `""` for "+N%" values (treating "+"
// as an invalid prefix for number inputs), leading to `null` being saved.

describe("parseBidModifierInput (Bug 3 regression)", () => {
  it('"+20" → 20', () => assert.equal(parseBidModifierInput("+20"), 20));
  it('"20" → 20', () => assert.equal(parseBidModifierInput("20"), 20));
  it('"-10" → -10', () => assert.equal(parseBidModifierInput("-10"), -10));
  it('"0" → 0', () => assert.equal(parseBidModifierInput("0"), 0));
  it('"15.5" → 15.5', () => assert.equal(parseBidModifierInput("15.5"), 15.5));
  it('"+15.5" → 15.5', () => assert.equal(parseBidModifierInput("+15.5"), 15.5));
  it('"" → null (empty)', () => assert.equal(parseBidModifierInput(""), null));
  it('"+" → null (partial plus)', () => assert.equal(parseBidModifierInput("+"), null));
  it('"-" → null (partial minus)', () => assert.equal(parseBidModifierInput("-"), null));
  it('"abc" → null (non-numeric)', () => assert.equal(parseBidModifierInput("abc"), null));
  it('whitespace stripped: "  +20  " → 20', () => assert.equal(parseBidModifierInput("  +20  "), 20));
});
