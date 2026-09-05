import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { aspectChipRatio } from "../aspect-chip.ts";

describe("AspectChip — a ratio or —, never OTHER (G14)", () => {
  it("keeps 9:16 / 1:1 / 4:5 and maps OTHER to —", () => {
    assert.equal(aspectChipRatio("9:16"), "9:16");
    assert.equal(aspectChipRatio("1:1"), "1:1");
    assert.equal(aspectChipRatio("4:5"), "4:5");
    assert.equal(aspectChipRatio("OTHER"), "—");
    assert.equal(aspectChipRatio("other"), "—");
    assert.equal(aspectChipRatio(""), "—");
    assert.equal(aspectChipRatio(null), "—");
  });

  it("AspectChip renders the normalised ratio, not the raw token", () => {
    const source = readFileSync("components/viz/metric-chip.tsx", "utf8");
    assert.match(source, /aspectChipRatio/);
    assert.doesNotMatch(source, /OTHER/);
  });
});
