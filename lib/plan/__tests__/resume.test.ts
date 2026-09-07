import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatResumeTreeSentence,
  resumePlanAdapter,
  type ResumeTreeGraph,
  type ResumeTreeNode,
} from "../resume.ts";

function node(id: string, status: string): ResumeTreeNode {
  return { id, status };
}

function mixedGraph(overrides: {
  activate?: (id: string) => Promise<void>;
} = {}): { graph: ResumeTreeGraph; posted: string[] } {
  const posted: string[] = [];
  const adSets = [
    node("as_paused_1", "PAUSED"),
    node("as_active", "ACTIVE"),
    node("as_paused_2", "PAUSED"),
    node("as_paused_3", "PAUSED"),
    node("as_paused_4", "PAUSED"),
  ];
  const ads: Record<string, ResumeTreeNode[]> = {
    as_paused_1: [node("ad_1", "PAUSED")],
    as_active: [node("ad_2", "ACTIVE")],
    as_paused_2: [node("ad_3", "PAUSED")],
    as_paused_3: [node("ad_4", "PAUSED")],
    as_paused_4: [node("ad_5", "PAUSED")],
  };
  const graph: ResumeTreeGraph = {
    getCampaign: async () => node("camp_1", "PAUSED"),
    listAdSets: async () => adSets,
    listAds: async (adSetId) => ads[adSetId] ?? [],
    activate: async (id) => {
      posted.push(id);
      await overrides.activate?.(id);
    },
  };
  return { graph, posted };
}

describe("formatResumeTreeSentence", () => {
  it("states a full tree in the operator's words", () => {
    assert.equal(
      formatResumeTreeSentence({
        campaignActivated: true,
        campaignAlreadyActive: false,
        campaignFailed: false,
        adSetsActivated: 5,
        adSetsAlreadyActive: 0,
        adSetsFailed: 0,
        adSetsTotal: 5,
        adsActivated: 5,
        adsAlreadyActive: 0,
        adsFailed: 0,
        adsTotal: 5,
      }),
      "resumed 1 campaign · 5 ad sets · 5 ads",
    );
  });

  it("states a partial ad-set walk without swallowing the rest", () => {
    assert.equal(
      formatResumeTreeSentence({
        campaignActivated: true,
        campaignAlreadyActive: false,
        campaignFailed: false,
        adSetsActivated: 2,
        adSetsAlreadyActive: 0,
        adSetsFailed: 3,
        adSetsTotal: 5,
        adsActivated: 2,
        adsAlreadyActive: 0,
        adsFailed: 0,
        adsTotal: 2,
      }),
      "resumed the campaign · 2 of 5 ad sets — the rest are in Ads Manager ↗",
    );
  });
});

describe("resumePlanAdapter tree walk", () => {
  it("activates paused nodes and skips already-ACTIVE ones", async () => {
    const { graph, posted } = mixedGraph();
    const outcome = await resumePlanAdapter({
      adapter: "meta",
      campaignId: "camp_1",
      gateEnabled: true,
      graph,
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.word, "resumed 1 campaign · 5 ad sets · 5 ads");
    assert.deepEqual(posted, [
      "camp_1",
      "as_paused_1",
      "ad_1",
      "as_paused_2",
      "ad_3",
      "as_paused_3",
      "ad_4",
      "as_paused_4",
      "ad_5",
    ]);
    assert.equal(posted.includes("as_active"), false);
    assert.equal(posted.includes("ad_2"), false);
  });

  it("renders the honest sentence when some ad sets fail", async () => {
    const { graph } = mixedGraph({
      activate: async (id) => {
        if (id === "as_paused_3" || id === "as_paused_4" || id === "ad_4") {
          throw new Error("Meta refused");
        }
      },
    });
    const outcome = await resumePlanAdapter({
      adapter: "meta",
      campaignId: "camp_1",
      gateEnabled: true,
      graph,
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(
      outcome.word,
      "resumed the campaign · 3 of 5 ad sets — the rest are in Ads Manager ↗",
    );
  });

  it("posts nothing for an already-ACTIVE tree", async () => {
    const posted: string[] = [];
    const graph: ResumeTreeGraph = {
      getCampaign: async () => node("camp_1", "ACTIVE"),
      listAdSets: async () => [node("as_1", "ACTIVE")],
      listAds: async () => [node("ad_1", "ACTIVE")],
      activate: async (id) => {
        posted.push(id);
      },
    };
    const outcome = await resumePlanAdapter({
      adapter: "meta",
      campaignId: "camp_1",
      gateEnabled: true,
      graph,
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(posted, []);
    assert.equal(outcome.word, "resumed 1 campaign · 1 ad set · 1 ad");
  });
});
