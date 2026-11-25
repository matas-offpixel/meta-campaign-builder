import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { M4_WORDS, TODAY_WORDS } from "../words.ts";

const M4 = new URL("./fixtures/words-m4-render-2026-11-25.tsv", import.meta.url);
const TD = new URL("./fixtures/words-mcp-today-2026-11-25.tsv", import.meta.url);
const rows = (u: URL) => readFileSync(u, "utf8").trimEnd().split("\n").slice(1).map((l) => l.split("\t"));

test("the fixture is the M4 word list as briefed: 122 rows, sha256 c86c2fbd…5085", () => {
  const bytes = readFileSync(M4);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "c86c2fbd660ac915a591275a581b469d35cf63337e19ab61f732261592f85066");
  assert.equal(rows(M4).length, 122);
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
  assert.equal(createHash("sha256").update(readFileSync(TD)).digest("hex"), "5aeca085a051cc358091bf0861ebe908e08174030241792f865325fb3f6d1980");
  for (const [k, v] of Object.entries(TODAY_WORDS)) assert.equal(v, td.get(k), k);
});
