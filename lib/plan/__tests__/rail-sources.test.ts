import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * Every figure in an IR fixture row must be on the README's "IR sources"
 * table, on one line with its value key, so a typed figure cannot slip in.
 */

const ROW = /row\("(\w+)", "(\w+)", ([\d.]+|null), (IR[23]_BASELINE|[\d.]+), ([\d.]+|null), "(\w+)", (\d+)\)/g;
const BASELINES: Record<string, string> = { IR3_BASELINE: "4.16", IR2_BASELINE: "46.86" };

function sourceLines(): string[] {
  const readme = readFileSync(new URL("../../../scripts/plan-frames/README.md", import.meta.url), "utf8");
  const start = readme.indexOf("## IR sources");
  assert.ok(start >= 0, "README has an IR sources section");
  const section = readme.slice(start, readme.indexOf("\n## ", start + 1) === -1 ? undefined : readme.indexOf("\n## ", start + 1));
  return section.split("\n").filter((line) => line.startsWith("|"));
}

describe("IR fixture sources", () => {
  it("every fixture row is on the README's IR sources table with all its figures", () => {
    const fixture = readFileSync(new URL("../../../scripts/plan-frames/rail-fixtures.ts", import.meta.url), "utf8");
    const lines = sourceLines();
    const rows = [...fixture.matchAll(ROW)];
    assert.ok(rows.length >= 40, `only ${rows.length} rows parsed`);
    const misses: string[] = [];
    for (const match of rows) {
      const [, dimension, key, cpr, baselineRaw, shrunk, confidence, funded] = match;
      const baseline = BASELINES[baselineRaw!] ?? baselineRaw!;
      const cells = [dimension!, key!, cpr!, baseline, shrunk!, confidence!, funded!];
      const found = lines.some((line) => {
        const parts = line.split("|").map((part) => part.trim());
        return cells.every((cell, index) => parts[index + 1] === cell);
      });
      if (!found) misses.push(`${dimension} ${key} ${cpr} ${baseline} ${shrunk} ${confidence} ${funded}`);
    }
    assert.deepEqual(misses, []);
  });

  it("the fixture types no baseline but the two stored ones", () => {
    const fixture = readFileSync(new URL("../../../scripts/plan-frames/rail-fixtures.ts", import.meta.url), "utf8");
    for (const match of fixture.matchAll(ROW)) assert.match(match[4]!, /^IR[23]_BASELINE$/, match[0]);
    assert.match(fixture, /IR2_BASELINE = 46\.86/);
    assert.doesNotMatch(fixture, /46\.8\b(?!6)/);
  });
});
