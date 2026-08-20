import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterTikTokRegions,
  resolveTikTokGenderLabel,
  resolveTikTokLanguageLabel,
  resolveTikTokLocationLabel,
  visibleTikTokCategoryRows,
} from "../audience-display.ts";

const regions = [
  { id: "2635167", name: "United Kingdom", countryCode: "GB" },
  { id: "2749991", name: "'s Hertogenbosch", countryCode: "NL" },
  { id: "2643743", name: "London", countryCode: "GB" },
];

describe("filterTikTokRegions", () => {
  it("renders nothing for an empty query", () => {
    assert.deepEqual(filterTikTokRegions(regions, ""), { rows: [], total: 0 });
    assert.deepEqual(filterTikTokRegions(regions, "   "), { rows: [], total: 0 });
  });

  it("returns matching rows for a non-empty query", () => {
    const result = filterTikTokRegions(regions, "united");
    assert.equal(result.total, 1);
    assert.deepEqual(
      result.rows.map((row) => row.id),
      ["2635167"],
    );
  });
});

describe("resolveTikTokLocationLabel", () => {
  it("renders a stored name, then a catalog name, then the raw code", () => {
    assert.equal(
      resolveTikTokLocationLabel("GB", { GB: "Britain" }, regions),
      "Britain",
    );
    assert.equal(resolveTikTokLocationLabel("GB", {}, regions), "United Kingdom");
    assert.equal(resolveTikTokLocationLabel("ZZ", {}, regions), "ZZ");
  });

  it("does not turn a resolved name into the persisted value", () => {
    const persisted = ["GB"];
    const label = resolveTikTokLocationLabel("GB", {}, regions);
    assert.equal(label, "United Kingdom");
    assert.deepEqual(persisted, ["GB"]);
  });
});

describe("resolveTikTokLanguageLabel", () => {
  const languages = [
    { id: "en", name: "English" },
    { id: "nl", name: "Dutch" },
  ];

  it("renders a known name and falls back to the raw code", () => {
    assert.equal(
      resolveTikTokLanguageLabel("en", {}, languages),
      "English",
    );
    assert.equal(resolveTikTokLanguageLabel("xx", {}, languages), "xx");
  });
});

describe("resolveTikTokGenderLabel", () => {
  it("renders a readable gender without changing the stored code", () => {
    assert.equal(resolveTikTokGenderLabel("MALE"), "Male");
    assert.equal(resolveTikTokGenderLabel("MALE") === "MALE", false);
  });
});

describe("visibleTikTokCategoryRows", () => {
  const tree = [
    { id: "10", parent_id: null, label: "Music", depth: 0 },
    { id: "10100", parent_id: "10", label: "Dance", depth: 1 },
    { id: "20", parent_id: null, label: "Sports", depth: 0 },
  ];

  it("hides children until expanded and caps a search", () => {
    const collapsed = visibleTikTokCategoryRows(tree, {
      query: "",
      expandedIds: [],
    });
    assert.deepEqual(
      collapsed.rows.map((row) => row.id),
      ["10", "20"],
    );

    const expanded = visibleTikTokCategoryRows(tree, {
      query: "",
      expandedIds: ["10"],
    });
    assert.deepEqual(
      expanded.rows.map((row) => row.id),
      ["10", "10100", "20"],
    );

    const searched = visibleTikTokCategoryRows(tree, {
      query: "dance",
      expandedIds: [],
      limit: 1,
    });
    assert.equal(searched.total, 1);
    assert.equal(searched.rows[0]?.id, "10100");
  });
});
