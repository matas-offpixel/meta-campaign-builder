/**
 * Every tree.* row of the record's word list (words-rc-2026-11-24.tsv, the
 * fixture CC-1 keeps in lib/replicate/__tests__/fixtures) is in
 * lib/campaign-tree/words.ts word for word, and words.ts holds nothing the
 * list doesn't. Each FRAME_WORDS string is drawn in the record's frames.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { REPLICATE_WORDS } from "../../replicate/words.ts";
import { FRAME_WORDS, TREE_WORDS, adSetCount } from "../words.ts";

const TSV = readFileSync(new URL("../../replicate/__tests__/fixtures/words-rc-2026-11-24.tsv", import.meta.url), "utf8");
const ROWS = TSV.trimEnd()
  .split("\n")
  .slice(1)
  .map((line) => line.split("\t"))
  .map(([key, where, words]) => ({ key: key!, where: where!, words: words! }));

const RECORD = readFileSync(
  new URL("../../../docs/design-record/2026-11-24-campaign-creator-replicate.html", import.meta.url),
  "utf8",
);

function recordText(): string {
  return RECORD.replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&rsquo;|&#8217;/g, "’")
    .replace(/&hellip;|&#8230;/g, "…")
    .replace(/&rarr;|&#8594;/g, "→")
    .replace(/&nearr;|&#8599;/g, "↗")
    .replace(/&middot;|&#183;/g, "·")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ");
}

describe("campaign tree words", () => {
  it("the fixture is the final list (242 rows)", () => {
    assert.equal(ROWS.length, 242);
  });

  it("every tree.* row is in words.ts or CC-1's words.ts, word for word", () => {
    const tree = ROWS.filter((r) => r.key.startsWith("tree."));
    assert.equal(tree.length, 41);
    for (const r of tree) {
      const here = (TREE_WORDS as Record<string, string>)[r.key] ?? (REPLICATE_WORDS as Record<string, string>)[r.key];
      assert.equal(here, r.words, r.key);
    }
  });

  it("words.ts holds no string that isn't in the list", () => {
    const list = new Map(ROWS.map((r) => [r.key, r.words]));
    for (const [key, words] of Object.entries(TREE_WORDS)) assert.equal(list.get(key), words, key);
  });

  it("every replicate.* and duplicate.* row the dialog uses is CC-1's, word for word", () => {
    const rows = ROWS.filter((r) => /^(replicate|duplicate)\./.test(r.key));
    assert.equal(rows.length, 42);
    for (const r of rows) assert.equal((REPLICATE_WORDS as Record<string, string>)[r.key], r.words, r.key);
  });

  it("each frame word is drawn in the record", () => {
    const text = recordText();
    const drawn: Record<keyof typeof FRAME_WORDS, string> = {
      live: "live · 18 ad sets",
      paused: "paused · 1 ad set",
      adSets: "18 ad sets",
      adSetOne: "1 ad set",
      more: "… and 3 more",
      cancel: "Cancel",
      next: "Next",
      back: "Back",
      upcoming: "Upcoming · Electric",
      editDraft: "Edit draft",
      adsManager: "View in Ads Manager ↗",
    };
    for (const [key, sample] of Object.entries(drawn)) {
      assert.ok(text.includes(sample), `${key}: "${sample}" is not in the record`);
    }
    assert.equal(FRAME_WORDS.more, ROWS.find((r) => r.key === "launch.evidence.more")?.words);
  });

  it("the campaign row's count has the frame's one form", () => {
    assert.equal(adSetCount(1), "1 ad set");
    assert.equal(adSetCount(18), "18 ad sets");
  });
});
