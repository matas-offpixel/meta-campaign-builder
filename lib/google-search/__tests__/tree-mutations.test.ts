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
      geo_targets: [],
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
