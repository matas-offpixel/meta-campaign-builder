import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatResumeTreeSentence,
  isConfiguredActive,
  isResumable,
  resumePlanAdapter,
  type ResumeTreeCounts,
  type ResumeTreeGraph,
  type ResumeTreeNode,
} from "../resume.ts";

function node(id: string, status: string): ResumeTreeNode {
  return { id, status };
}

function counts(overrides: Partial<ResumeTreeCounts> = {}): ResumeTreeCounts {
  return {
    campaignActivated: false,
    campaignAlreadyActive: false,
    adSetsActivated: 0,
    adSetsAlreadyActive: 0,
    adSetsFailed: 0,
    adSetsTotal: 0,
    adSetsUnread: false,
    adSetsWithUnreadAds: 0,
    adsActivated: 0,
    adsAlreadyActive: 0,
    adsFailed: 0,
    adsTotal: 0,
    ...overrides,
  };
}

function mixedGraph(overrides: {
  activate?: (id: string) => Promise<void>;
  listAdSets?: ResumeTreeGraph["listAdSets"];
  listAds?: ResumeTreeGraph["listAds"];
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
    listAdSets: overrides.listAdSets ?? (async () => adSets),
    listAds: overrides.listAds ?? (async (adSetId) => ads[adSetId] ?? []),
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
      formatResumeTreeSentence(
        counts({
          campaignActivated: true,
          adSetsActivated: 5,
          adSetsTotal: 5,
          adsActivated: 5,
          adsTotal: 5,
        }),
      ),
      "resumed 1 campaign · 5 ad sets · 5 ads",
    );
  });

  it("states a partial ad-set walk without swallowing the rest", () => {
    assert.equal(
      formatResumeTreeSentence(
        counts({
          campaignActivated: true,
          adSetsActivated: 2,
          adSetsFailed: 3,
          adSetsTotal: 5,
          adsActivated: 2,
          adsTotal: 2,
        }),
      ),
      "resumed the campaign · 2 of 5 ad sets — the rest are in Ads Manager ↗",
    );
  });

  it("says already running when nothing was written", () => {
    assert.equal(
      formatResumeTreeSentence(
        counts({
          campaignAlreadyActive: true,
          adSetsAlreadyActive: 5,
          adSetsTotal: 5,
          adsAlreadyActive: 5,
          adsTotal: 5,
        }),
      ),
      "already running · 1 campaign · 5 ad sets · 5 ads",
    );
  });

  it("unread ad sets is not a counted remainder", () => {
    const word = formatResumeTreeSentence(counts({ adSetsUnread: true }));
    assert.equal(
      word,
      "resumed the campaign · couldn't read its ad sets — check Ads Manager ↗",
    );
    assert.doesNotMatch(word, /\d+ of \d+/);
    assert.doesNotMatch(word, /\d/);
  });

  it("unread ads names the ad sets we listed, not an invented ad total", () => {
    const word = formatResumeTreeSentence(
      counts({
        campaignActivated: true,
        adSetsActivated: 5,
        adSetsTotal: 5,
        adSetsWithUnreadAds: 2,
      }),
    );
    assert.equal(
      word,
      "resumed 1 campaign · 5 ad sets · couldn't read the ads on 2 of them — check Ads Manager ↗",
    );
    assert.doesNotMatch(word, /\d+ of \d+/);
  });
});

describe("isResumable", () => {
  it("leaves ARCHIVED, DELETED, and WITH_ISSUES out of the walk", () => {
    assert.equal(isConfiguredActive("ACTIVE"), true);
    assert.equal(isResumable("PAUSED"), true);
    assert.equal(isResumable("ACTIVE"), true);
    assert.equal(isResumable("ARCHIVED"), false);
    assert.equal(isResumable("DELETED"), false);
    assert.equal(isResumable("WITH_ISSUES"), false);
    assert.equal(isResumable("archived"), false);
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

  it("says already running when the tree is ACTIVE and nothing is posted", async () => {
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
    assert.equal(outcome.word, "already running · 1 campaign · 1 ad set · 1 ad");
  });

  it("renders the unread ad-set sentence when the list throws — no invented total", async () => {
    const { graph, posted } = mixedGraph({
      listAdSets: async () => {
        throw new Error("Graph timeout");
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
      "resumed the campaign · couldn't read its ad sets — check Ads Manager ↗",
    );
    assert.doesNotMatch(outcome.word, /\d+ of \d+/);
    assert.doesNotMatch(outcome.word, /\d/);
    assert.deepEqual(posted, ["camp_1"]);
  });

  it("renders the unread-ads sentence when listAds throws — no invented ad total", async () => {
    const { graph } = mixedGraph({
      listAds: async (adSetId) => {
        if (adSetId === "as_paused_3" || adSetId === "as_paused_4") {
          throw new Error("Graph timeout");
        }
        const ads: Record<string, ResumeTreeNode[]> = {
          as_paused_1: [node("ad_1", "PAUSED")],
          as_active: [node("ad_2", "ACTIVE")],
          as_paused_2: [node("ad_3", "PAUSED")],
        };
        return ads[adSetId] ?? [];
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
      "resumed 1 campaign · 5 ad sets · couldn't read the ads on 2 of them — check Ads Manager ↗",
    );
    assert.doesNotMatch(outcome.word, /\d+ of \d+/);
  });

  it("skips ARCHIVED / DELETED / WITH_ISSUES and leaves them out of the total", async () => {
    const posted: string[] = [];
    const graph: ResumeTreeGraph = {
      getCampaign: async () => node("camp_1", "ACTIVE"),
      listAdSets: async () => [
        node("as_live", "ACTIVE"),
        node("as_archived", "ARCHIVED"),
        node("as_deleted", "DELETED"),
        node("as_issues", "WITH_ISSUES"),
      ],
      listAds: async (adSetId) => {
        if (adSetId === "as_live") {
          return [
            node("ad_live", "ACTIVE"),
            node("ad_deleted", "DELETED"),
            node("ad_archived", "ARCHIVED"),
          ];
        }
        return [node(`${adSetId}_ad`, "PAUSED")];
      },
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
    assert.equal(outcome.word, "already running · 1 campaign · 1 ad set · 1 ad");
    assert.equal(posted.includes("as_archived"), false);
    assert.equal(posted.includes("as_deleted"), false);
    assert.equal(posted.includes("as_issues"), false);
    assert.equal(posted.includes("ad_deleted"), false);
    assert.equal(posted.includes("ad_archived"), false);
  });
});
