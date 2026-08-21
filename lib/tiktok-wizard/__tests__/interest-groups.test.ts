import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  createEmptyTikTokInterestGroup,
  flattenTikTokInterestGroups,
  formatTikTokInterestGroupCounts,
  removeTikTokInterestGroup,
  seedTikTokInterestGroupFromLegacy,
} from "../interest-groups.ts";

describe("flattenTikTokInterestGroups", () => {
  it("clears the flat targeting when every group is empty", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.audiences.interestCategoryIds = ["cat-1"];
    draft.audiences.interestCategoryLabels = { "cat-1": "Dance" };
    draft.audiences.interestKeywordIds = ["kw-1"];
    draft.audiences.behaviourCategoryIds = ["beh-1"];
    draft.audiences.behaviourCategoryLabels = { "beh-1": "Creators" };

    const empty = createEmptyTikTokInterestGroup();
    empty.name = "Group 1";
    const flat = flattenTikTokInterestGroups([empty]);

    assert.deepEqual(flat.interestCategoryIds, []);
    assert.deepEqual(flat.interestCategoryLabels, {});
    assert.deepEqual(flat.interestKeywordIds, []);
    assert.deepEqual(flat.behaviourCategoryIds, []);
    assert.deepEqual(flat.behaviourCategoryLabels, {});
  });

  it("clears the flat targeting when the last group is removed", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    const only = createEmptyTikTokInterestGroup();
    only.name = "House";
    only.interestIds = [{ id: "cat-1", name: "Dance", kind: "category" }];
    draft.audiences.interestGroups = [only];
    draft.audiences.interestCategoryIds = ["cat-1"];
    draft.audiences.interestCategoryLabels = { "cat-1": "Dance" };

    const next = removeTikTokInterestGroup(draft.audiences, only.id);

    assert.deepEqual(next.interestGroups, []);
    assert.deepEqual(next.interestCategoryIds, []);
    assert.deepEqual(next.interestCategoryLabels, {});
  });

  it("keeps legacy targeting through the seeded group, not a merge-back", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.audiences.interestCategoryIds = ["cat-1"];
    draft.audiences.interestCategoryLabels = { "cat-1": "Dance" };
    draft.audiences.interestKeywordIds = ["kw-1"];
    draft.audiences.behaviourCategoryIds = ["beh-1"];
    draft.audiences.behaviourCategoryLabels = { "beh-1": "Creators" };

    const seeded = seedTikTokInterestGroupFromLegacy(draft.audiences);
    const flat = flattenTikTokInterestGroups([seeded]);

    assert.deepEqual(flat.interestCategoryIds, ["cat-1"]);
    assert.equal(flat.interestCategoryLabels["cat-1"], "Dance");
    assert.deepEqual(flat.interestKeywordIds, ["kw-1"]);
    assert.deepEqual(flat.behaviourCategoryIds, ["beh-1"]);
    assert.equal(flat.behaviourCategoryLabels["beh-1"], "Creators");
  });
});

describe("removeTikTokInterestGroup", () => {
  it("removes a non-empty group and drops its ids from the flat targeting fields", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    const keep = createEmptyTikTokInterestGroup();
    keep.name = "UK";
    keep.interestIds = [{ id: "keep-kw", name: "House", kind: "keyword" }];
    keep.hashtagIds = [{ id: "keep-tag", name: "house", kind: "keyword" }];
    const remove = createEmptyTikTokInterestGroup();
    remove.name = "London";
    remove.interestIds = [{ id: "gone-kw", name: "Techno", kind: "keyword" }];
    remove.hashtagIds = [{ id: "gone-tag", name: "techno", kind: "keyword" }];
    remove.behaviourIds = [{ id: "gone-beh", name: "Creators", kind: "category" }];
    draft.audiences.interestGroups = [keep, remove];
    draft.audiences.interestKeywordIds = ["keep-kw", "keep-tag", "gone-kw", "gone-tag"];
    draft.audiences.behaviourCategoryIds = ["gone-beh"];
    draft.audiences.behaviourCategoryLabels = { "gone-beh": "Creators" };

    const persisted = {
      current: JSON.parse(JSON.stringify(draft)) as typeof draft,
    };
    persisted.current.audiences = removeTikTokInterestGroup(
      persisted.current.audiences,
      remove.id,
    );
    const reloaded = JSON.parse(JSON.stringify(persisted.current)) as typeof draft;

    assert.equal(reloaded.audiences.interestGroups.length, 1);
    assert.equal(reloaded.audiences.interestGroups[0]?.name, "UK");
    assert.equal(
      reloaded.audiences.interestGroups.some((group) => group.id === remove.id),
      false,
    );
    assert.deepEqual(reloaded.audiences.interestKeywordIds, ["keep-kw", "keep-tag"]);
    assert.equal(reloaded.audiences.interestKeywordIds.includes("gone-kw"), false);
    assert.equal(reloaded.audiences.interestKeywordIds.includes("gone-tag"), false);
    assert.deepEqual(reloaded.audiences.behaviourCategoryIds, []);
    assert.equal(reloaded.audiences.behaviourCategoryLabels["gone-beh"], undefined);
  });
});

describe("formatTikTokInterestGroupCounts", () => {
  it("renders counts from group contents", () => {
    const group = createEmptyTikTokInterestGroup();
    group.interestIds = [
      { id: "1", name: "House", kind: "keyword" },
      { id: "2", name: "Techno", kind: "keyword" },
      { id: "3", name: "Disco", kind: "keyword" },
    ];
    group.hashtagIds = [
      { id: "h1", name: "house", kind: "keyword" },
      { id: "h2", name: "techno", kind: "keyword" },
    ];
    group.behaviourIds = [{ id: "b1", name: "Creators", kind: "category" }];
    assert.equal(
      formatTikTokInterestGroupCounts(group),
      "3 interests · 2 hashtags · 1 behaviour",
    );
  });
});

