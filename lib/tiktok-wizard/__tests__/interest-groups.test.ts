import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  createEmptyTikTokInterestGroup,
  flattenTikTokInterestGroups,
  formatTikTokInterestGroupCounts,
} from "../interest-groups.ts";

describe("flattenTikTokInterestGroups", () => {
  it("retains legacy targeting after adding an empty group", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.audiences.interestGroups = [];
    draft.audiences.interestCategoryIds = ["cat-1"];
    draft.audiences.interestCategoryLabels = { "cat-1": "Dance" };
    draft.audiences.interestKeywordIds = ["kw-1"];
    draft.audiences.behaviourCategoryIds = ["beh-1"];
    draft.audiences.behaviourCategoryLabels = { "beh-1": "Creators" };

    const empty = createEmptyTikTokInterestGroup();
    empty.name = "Group 1";
    const flat = flattenTikTokInterestGroups([empty], draft.audiences);

    assert.deepEqual(flat.interestCategoryIds, ["cat-1"]);
    assert.equal(flat.interestCategoryLabels["cat-1"], "Dance");
    assert.deepEqual(flat.interestKeywordIds, ["kw-1"]);
    assert.deepEqual(flat.behaviourCategoryIds, ["beh-1"]);
    assert.equal(flat.behaviourCategoryLabels["beh-1"], "Creators");
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

