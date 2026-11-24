/**
 * The words are design's (2026-11-24-campaign-creator-location-pin, word
 * list = words-location-pins-2026-11-24.tsv, copied here byte for byte as the
 * fixture). Every row must be in lib/meta/location-pins.ts with identical
 * text, the module must hold nothing the list doesn't, and every key must be
 * used by the picker's code (no unused keys).
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { LOCATION_PIN_WORDS } from "../location-pins.ts";

const RAW = readFileSync(new URL("./fixtures/words-location-pins-2026-11-24.tsv", import.meta.url));
const ROWS = RAW.toString("utf8")
  .trimEnd()
  .split("\n")
  .slice(1)
  .map((line) => line.split("\t"))
  .map(([key, where, words]) => ({ key: key!, where: where!, words: words! }));

/** The code that puts the words on screen (or into the launch checks). */
const SOURCES = [
  "../location-pins.ts",
  "../../../components/steps/budget-schedule.tsx",
  "../../../components/steps/location-pin-form.tsx",
].map((p) => readFileSync(new URL(p, import.meta.url), "utf8"));

describe("location pin words", () => {
  it("the fixture is design's list byte for byte: 25 rows, unique keys", () => {
    assert.equal(
      createHash("sha256").update(RAW).digest("hex"),
      "7e65aeb868536c22bf6679205380d7799d6a05cf9da3c5432ffadcc710e6e4cc",
    );
    assert.equal(ROWS.length, 25);
    assert.equal(new Set(ROWS.map((r) => r.key)).size, 25);
  });

  it("every row is in location-pins.ts, word for word, and nothing else is", () => {
    const list = new Map(ROWS.map((r) => [r.key, r.words]));
    for (const r of ROWS) assert.equal((LOCATION_PIN_WORDS as Record<string, string>)[r.key], r.words, r.key);
    for (const [key, words] of Object.entries(LOCATION_PIN_WORDS)) assert.equal(list.get(key), words, key);
  });

  it("every key used in the code is in the list", () => {
    const keys = new Set(ROWS.map((r) => r.key));
    const used = new Set<string>();
    // Strip the words table itself, then collect every quoted "location.…" key.
    const code = SOURCES.map((src) => src.replace(/export const LOCATION_PIN_WORDS = \{[\s\S]*?\} as const;/, ""));
    for (const src of code) for (const m of src.matchAll(/"(location\.[a-z_.]+)"/g)) used.add(m[1]!);
    for (const key of used) assert.ok(keys.has(key), `${key} is not in the list`);
  });

  it("the list has no unused keys", () => {
    const code = SOURCES.map((src) => src.replace(/export const LOCATION_PIN_WORDS = \{[\s\S]*?\} as const;/, "")).join("\n");
    for (const r of ROWS) assert.ok(code.includes(`"${r.key}"`), `${r.key} is never used`);
  });
});
