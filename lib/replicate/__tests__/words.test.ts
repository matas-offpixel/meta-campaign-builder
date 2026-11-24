/**
 * The words are the record's (2026-11-24-campaign-creator-replicate, word
 * list = words-rc-2026-11-24.tsv, copied here as the fixture). Every
 * replicate.* row must be in lib/replicate/words.ts with identical text, and
 * the module must hold nothing the list doesn't.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { REPLICATE_WORDS, fillWords } from "../words.ts";

const TSV = readFileSync(new URL("./fixtures/words-rc-2026-11-24.tsv", import.meta.url), "utf8");
const ROWS = TSV.trimEnd()
  .split("\n")
  .slice(1)
  .map((line) => line.split("\t"))
  .map(([key, where, words]) => ({ key: key!, where: where!, words: words! }));

describe("replicate words", () => {
  it("the fixture is the record's list: 151 rows, unique keys", () => {
    assert.equal(ROWS.length, 151);
    assert.equal(new Set(ROWS.map((r) => r.key)).size, 151);
  });

  it("every replicate.* and duplicate.* row is in words.ts, word for word", () => {
    const wanted = ROWS.filter((r) => /^(replicate|duplicate)\./.test(r.key));
    assert.equal(wanted.length, 32);
    for (const r of wanted) {
      assert.equal((REPLICATE_WORDS as Record<string, string>)[r.key], r.words, r.key);
    }
  });

  it("words.ts holds no string that isn't in the list", () => {
    const list = new Map(ROWS.map((r) => [r.key, r.words]));
    for (const [key, words] of Object.entries(REPLICATE_WORDS)) {
      assert.equal(list.get(key), words, key);
    }
  });

  it("the Event and Dates rows fill to RC-B's frame text", () => {
    const W = REPLICATE_WORDS;
    assert.equal(fillWords(W["replicate.change.event"], { code: "NX27-GLITTERBOX", venue: "NX Newcastle" }), "NX27-GLITTERBOX · NX Newcastle");
    assert.equal(fillWords(W["replicate.change.dates"], { date: "Thu 26 Nov", stage: "On sale" }), "Starts Thu 26 Nov · ends at On sale");
    assert.equal(fillWords(W["replicate.change.dates.day"], { date: ["Thu 26 Nov", "Sat 6 Mar"] }), "Starts Thu 26 Nov · ends Sat 6 Mar");
  });

  it("fills braces and leaves an unknown one alone", () => {
    assert.equal(fillWords("Pixel …{last 4}", { "last 4": "2763" }), "Pixel …2763");
    assert.equal(fillWords("{Field}: not set for {venue}, check", { Field: "Pixel" }), "Pixel: not set for {venue}, check");
  });
});
