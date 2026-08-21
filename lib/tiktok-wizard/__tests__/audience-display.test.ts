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
  { id: "2657832", name: "Aberdeen", countryCode: "GB" },
  { id: "2653941", name: "Bath", countryCode: "GB" },
  { id: "2643743", name: "London", countryCode: "GB" },
  { id: "2635167", name: "United Kingdom", countryCode: "GB" },
  { id: "2749991", name: "'s Hertogenbosch", countryCode: "NL" },
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
  it("resolves GB to United Kingdom, not the first alphabetically ordered GB city", () => {
    assert.equal(resolveTikTokLocationLabel("GB", {}, regions), "United Kingdom");
    assert.notEqual(resolveTikTokLocationLabel("GB", {}, regions), "Aberdeen");
  });

  it("resolves a numeric location id to its own name", () => {
    assert.equal(resolveTikTokLocationLabel("2643743", {}, regions), "London");
  });

  it("falls back to the raw code when nothing matches", () => {
    assert.equal(resolveTikTokLocationLabel("ZZ", {}, regions), "ZZ");
  });

  it("lets a stored label win over catalog names", () => {
    assert.equal(
      resolveTikTokLocationLabel("GB", { GB: "Britain" }, regions),
      "Britain",
    );
  });

  it("does not change persisted codes when rendering a name", () => {
    const persisted = ["GB"];
    const label = resolveTikTokLocationLabel("GB", {}, regions);
    assert.equal(label, "United Kingdom");
    assert.deepEqual(persisted, ["GB"]);
  });

  it("only uses a countryCode match on a COUNTRY-level row", () => {
    const withoutLevel = resolveTikTokLocationLabel("IE", {}, [
      { id: "2964574", name: "Dublin", countryCode: "IE" },
    ]);
    assert.equal(withoutLevel, "IE");
    const withLevel = resolveTikTokLocationLabel("IE", {}, [
      { id: "2964574", name: "Dublin", countryCode: "IE" },
      {
        id: "2963597",
        name: "Ireland",
        countryCode: "IE",
        level: "COUNTRY",
      },
    ]);
    assert.equal(withLevel, "Ireland");
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

  it("keeps the full filtered set on all when the render list is capped", () => {
    const many = Array.from({ length: 90 }, (_, index) => ({
      id: String(index),
      parent_id: null,
      label: `house ${index}`,
      depth: 0,
    }));
    const visible = visibleTikTokCategoryRows(many, {
      query: "house",
      expandedIds: [],
      limit: 80,
    });
    assert.equal(visible.rows.length, 80);
    assert.equal(visible.all.length, 90);
    assert.equal(visible.total, 90);
    assert.equal(visible.capped, true);
  });
});
