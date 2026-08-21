import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { visibleTikTokCategoryRows } from "../audience-display.ts";
import { filterTikTokKeywordsByWordBoundary } from "../genre-presets.ts";
import {
  addTikTokTargetingItems,
  addVisibleToTikTokGroup,
  removeTikTokTargetingItems,
  removeVisibleFromTikTokGroup,
  shouldOfferTikTokCategoryBulkActions,
  tikTokAddAllLabel,
} from "../add-suggestions.ts";
import { createEmptyTikTokInterestGroup } from "../interest-groups.ts";
import type { TikTokTargetingItem } from "../../types/tiktok-draft.ts";

function item(
  id: string,
  extras: Partial<TikTokTargetingItem> = {},
): TikTokTargetingItem {
  return { id, name: extras.name ?? id, ...extras };
}

function groupWith(overrides: Partial<ReturnType<typeof createEmptyTikTokInterestGroup>>) {
  const group = createEmptyTikTokInterestGroup();
  group.name = "Active";
  return { ...group, ...overrides };
}

describe("tikTokAddAllLabel", () => {
  it("names the visible count", () => {
    assert.equal(tikTokAddAllLabel(5), "Add all 5");
  });
});

describe("shouldOfferTikTokCategoryBulkActions", () => {
  it("never offers a blanket add on an unfiltered interest tree", () => {
    assert.equal(
      shouldOfferTikTokCategoryBulkActions({
        visibleCount: 12,
        filterQuery: "",
        allowUnfiltered: false,
      }),
      false,
    );
    assert.equal(
      shouldOfferTikTokCategoryBulkActions({
        visibleCount: 3,
        filterQuery: "house",
        allowUnfiltered: false,
      }),
      true,
    );
  });

  it("offers bulk-add on behaviours even with no filter", () => {
    assert.equal(
      shouldOfferTikTokCategoryBulkActions({
        visibleCount: 8,
        filterQuery: "",
        allowUnfiltered: true,
      }),
      true,
    );
  });
});

describe("addTikTokTargetingItems", () => {
  it("adds only the visible filtered keyword rows and keeps provenance", () => {
    const visible = filterTikTokKeywordsByWordBoundary("techno", [
      { id: "kw-1", name: "techno" },
      { id: "kw-2", name: "technology" },
      { id: "kw-3", name: "melodic techno" },
    ]);
    const incoming = visible.map((row) =>
      item(row.id, {
        name: row.name,
        kind: "keyword",
        audienceType: "GENERAL_INTEREST",
        audienceSize: 1000,
      }),
    );
    const next = addTikTokTargetingItems(
      [item("cat-1", { name: "Dance", kind: "category" })],
      incoming,
    );
    assert.deepEqual(
      next.map((row) => row.id),
      ["cat-1", "kw-1", "kw-3"],
    );
    assert.equal(next[1]?.audienceType, "GENERAL_INTEREST");
    assert.equal(next[1]?.audienceSize, 1000);
    assert.equal(
      next.some((row) => row.id === "kw-2"),
      false,
    );
  });

  it("is idempotent and does not overwrite another list's rows", () => {
    const existing = [
      item("kw-1", { name: "techno", kind: "keyword", audienceSize: 9 }),
      item("cat-1", { name: "Dance", kind: "category" }),
    ];
    const once = addTikTokTargetingItems(existing, [
      item("kw-1", { name: "TECHNO", kind: "keyword", audienceSize: 1 }),
      item("kw-2", { name: "house", kind: "keyword" }),
    ]);
    const twice = addTikTokTargetingItems(once, [
      item("kw-1", { name: "TECHNO", kind: "keyword" }),
      item("kw-2", { name: "house", kind: "keyword" }),
    ]);
    assert.deepEqual(twice, once);
    assert.equal(twice[0]?.name, "techno");
    assert.equal(twice[0]?.audienceSize, 9);
    assert.equal(twice[1]?.kind, "category");
  });
});

describe("removeTikTokTargetingItems", () => {
  it("clears only the listed ids", () => {
    const current = [
      item("kw-1", { kind: "keyword" }),
      item("kw-2", { kind: "keyword" }),
      item("cat-1", { kind: "category" }),
      item("hash-1", { kind: "keyword" }),
    ];
    const next = removeTikTokTargetingItems(current, ["kw-1", "kw-2"]);
    assert.deepEqual(
      next.map((row) => row.id),
      ["cat-1", "hash-1"],
    );
  });
});

describe("visible filtered category add-all", () => {
  it("adds the filtered visible rows and not hidden siblings", () => {
    const tree = [
      { id: "10", parent_id: null, label: "Music", depth: 0 },
      { id: "10100", parent_id: "10", label: "Dance", depth: 1 },
      { id: "20", parent_id: null, label: "Sports", depth: 0 },
    ];
    const visible = visibleTikTokCategoryRows(tree, {
      query: "dance",
      expandedIds: [],
    });
    const group = groupWith({
      interestIds: [item("kw-preset", { name: "techno", kind: "keyword" })],
      hashtagIds: [item("hash-1", { name: "#house", kind: "keyword" })],
    });
    const added = addVisibleToTikTokGroup(
      [group],
      group.id,
      "interestIds",
      visible.rows.map((row) => item(row.id, { name: row.label, kind: "category" })),
    );
    assert.deepEqual(
      added[0]?.interestIds.map((row) => row.id),
      ["kw-preset", "10100"],
    );
    assert.deepEqual(
      added[0]?.hashtagIds.map((row) => row.id),
      ["hash-1"],
    );

    const cleared = removeVisibleFromTikTokGroup(
      added,
      group.id,
      "interestIds",
      visible.rows.map((row) => row.id),
    );
    assert.deepEqual(
      cleared[0]?.interestIds.map((row) => row.id),
      ["kw-preset"],
    );
    assert.deepEqual(
      cleared[0]?.hashtagIds.map((row) => row.id),
      ["hash-1"],
    );
  });
});
