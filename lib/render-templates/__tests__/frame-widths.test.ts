/**
 * Every M4a baseline is as wide as its name says: "-1280" frames 1280 px,
 * "-393" frames 393 px (the PNG's IHDR width). A frame mount capped below
 * the viewport (1024 px, design's FAIL on 1c6b0a7) fails here before it
 * reaches design.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const DIR = new URL("../../../docs/frames/", import.meta.url);

function pngWidth(bytes: Buffer): number {
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  return bytes.readUInt32BE(16);
}

test("each M4 and render consent baseline is exactly its named width", () => {
  const files = readdirSync(DIR).filter((f) => /^(M4-|MCP-consent-claude-render).*-(1280|393)\.png$/.test(f));
  assert.ok(files.length >= 20, `found ${files.length} baselines`);
  for (const f of files) {
    const want = Number(/-(1280|393)\.png$/.exec(f)![1]);
    assert.equal(pngWidth(readFileSync(new URL(f, DIR))), want, f);
  }
});
