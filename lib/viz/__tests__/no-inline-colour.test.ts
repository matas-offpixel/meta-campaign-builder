/**
 * Grep-guard: no colour invented inside components/viz/**.
 * Tokens live in lib/viz/tokens.ts. Hex / rgb / hsl / bg-[…] fail.
 *
 * Run: node --test lib/viz/__tests__/no-inline-colour.test.ts
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsx(path));
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const HEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const RGB = /\brgba?\(/;
const HSL = /\bhsla?\(/;
const BG_ARBITRARY = /\bbg-\[/;
const BANNED_HUE = /\b(?:sky|fuchsia|amber|emerald|violet|slate)-\d/;

describe("no inline colour in components/viz", () => {
  const files = walkTsx("components/viz");

  it("scans every viz primitive file", () => {
    assert.ok(files.length >= 16, `expected viz files, got ${files.length}`);
  });

  it("fails on hex / rgb / hsl / bg-[…] arbitrary values", () => {
    const hits: string[] = [];
    for (const file of files) {
      const body = stripComments(readFileSync(file, "utf8"));
      if (HEX.test(body)) hits.push(`${file}: hex`);
      if (RGB.test(body)) hits.push(`${file}: rgb`);
      if (HSL.test(body)) hits.push(`${file}: hsl`);
      if (BG_ARBITRARY.test(body)) hits.push(`${file}: bg-[`);
    }
    assert.deepEqual(hits, [], hits.join("\n"));
  });

  it("forbids the removed Tailwind hue classes (sky / fuchsia / amber / …)", () => {
    const hits: string[] = [];
    for (const file of files) {
      const body = stripComments(readFileSync(file, "utf8"));
      if (BANNED_HUE.test(body)) hits.push(file);
    }
    assert.deepEqual(hits, [], hits.join("\n"));
  });
});
