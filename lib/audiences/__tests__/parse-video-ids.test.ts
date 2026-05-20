// Run with: node --experimental-strip-types --test lib/audiences/__tests__/parse-video-ids.test.ts

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseVideoIds, MAX_VIDEO_IDS } from "../parse-video-ids.ts";

describe("parseVideoIds", () => {
  it("parses a comma-separated list", () => {
    const { ids } = parseVideoIds("aaa,bbb,ccc");
    assert.deepEqual(ids, ["aaa", "bbb", "ccc"]);
  });

  it("parses a semicolon-separated list", () => {
    const { ids } = parseVideoIds("aaa;bbb;ccc");
    assert.deepEqual(ids, ["aaa", "bbb", "ccc"]);
  });

  it("parses a newline-separated list", () => {
    const { ids } = parseVideoIds("aaa\nbbb\nccc");
    assert.deepEqual(ids, ["aaa", "bbb", "ccc"]);
  });

  it("parses a mixed-separator list", () => {
    const { ids } = parseVideoIds("aaa,bbb\nccc;ddd  eee");
    assert.deepEqual(ids, ["aaa", "bbb", "ccc", "ddd", "eee"]);
  });

  it("trims whitespace around IDs", () => {
    const { ids } = parseVideoIds("  aaa  ,  bbb  ");
    assert.deepEqual(ids, ["aaa", "bbb"]);
  });

  it("deduplicates IDs", () => {
    const { ids, totalBeforeCap } = parseVideoIds("aaa,bbb,aaa,ccc,bbb");
    assert.deepEqual(ids, ["aaa", "bbb", "ccc"]);
    assert.equal(totalBeforeCap, 3);
  });

  it("ignores empty tokens from consecutive separators", () => {
    const { ids } = parseVideoIds("aaa,,bbb\n\nccc");
    assert.deepEqual(ids, ["aaa", "bbb", "ccc"]);
  });

  it("returns empty for blank input", () => {
    const { ids, totalBeforeCap } = parseVideoIds("   ");
    assert.deepEqual(ids, []);
    assert.equal(totalBeforeCap, 0);
  });

  it("returns empty for empty string", () => {
    const { ids } = parseVideoIds("");
    assert.deepEqual(ids, []);
  });

  it(`caps at MAX_VIDEO_IDS (${MAX_VIDEO_IDS}) and reports totalBeforeCap`, () => {
    const input = Array.from({ length: MAX_VIDEO_IDS + 10 }, (_, i) => `id${i}`).join(",");
    const { ids, totalBeforeCap } = parseVideoIds(input);
    assert.equal(ids.length, MAX_VIDEO_IDS);
    assert.equal(totalBeforeCap, MAX_VIDEO_IDS + 10);
    assert.equal(ids[0], "id0");
    assert.equal(ids[MAX_VIDEO_IDS - 1], `id${MAX_VIDEO_IDS - 1}`);
  });

  it("exactly MAX_VIDEO_IDS IDs — no truncation", () => {
    const input = Array.from({ length: MAX_VIDEO_IDS }, (_, i) => `id${i}`).join(",");
    const { ids, totalBeforeCap } = parseVideoIds(input);
    assert.equal(ids.length, MAX_VIDEO_IDS);
    assert.equal(totalBeforeCap, MAX_VIDEO_IDS);
  });

  it("preserves numeric-string IDs verbatim", () => {
    const { ids } = parseVideoIds("999159669120596,123456789012345");
    assert.deepEqual(ids, ["999159669120596", "123456789012345"]);
  });
});
