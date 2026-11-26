import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { M4_WORDS, TODAY_WORDS } from "../words.ts";

const M4 = new URL("./fixtures/words-m4-render-2026-11-25.tsv", import.meta.url);
const TD = new URL("./fixtures/words-mcp-today-2026-11-25.tsv", import.meta.url);
const rows = (u: URL) => readFileSync(u, "utf8").trimEnd().split("\n").slice(1).map((l) => l.split("\t"));

test("the fixture is the M4 word list with design's 19 rows: 141 rows, sha256 35aa880c…8600", () => {
  const bytes = readFileSync(M4);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "35aa880ccc3327d1e1fa57e0e3d2acac67a756c0102954a4b866490ac6878600");
  assert.equal(rows(M4).length, 141);
});

test("M4_WORDS holds every row exactly, in order, and nothing else", () => {
  const r = rows(M4);
  assert.deepEqual(Object.keys(M4_WORDS), r.map((x) => x[0]));
  for (const [key, , words] of r) assert.equal(M4_WORDS[key as keyof typeof M4_WORDS], words, key);
});

test("RY4's retired rows are gone, RY's changed rows read as re-ruled", () => {
  assert.ok(!("today.mcp.row.render.inputs" in M4_WORDS));
  assert.ok(!("today.mcp.row.render.approve_note" in M4_WORDS));
  assert.match(M4_WORDS["m4.mcp.missing"], /Nothing was rendered\.$/);
  assert.equal(M4_WORDS["today.mcp.result.rendered"], "Done · {files} rendered and filed in Drive · {p} passed every check");
});

test("TODAY_WORDS are TD's rows exactly (FC1's log row)", () => {
  const td = new Map(rows(TD).map((x) => [x[0], x[2]]));
  assert.equal(createHash("sha256").update(readFileSync(TD)).digest("hex"), "432fdd5ff4b148bd6ab3c8882692c72852af7687913d683e733f1ff0588faf59");
  for (const [k, v] of Object.entries(TODAY_WORDS)) assert.equal(v, td.get(k), k);
});
