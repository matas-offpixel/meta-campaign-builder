import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  equalSplitMonetaryAmounts,
  isWc26OpponentAllocatorEventCode,
} from "../venue-equal-split.ts";

describe("isWc26OpponentAllocatorEventCode", () => {
  it("is true for WC26-* prefixes only", () => {
    assert.equal(isWc26OpponentAllocatorEventCode("WC26-BRIGHTON"), true);
    assert.equal(isWc26OpponentAllocatorEventCode("  WC26-LONDON-KENTISH  "), true);
    assert.equal(isWc26OpponentAllocatorEventCode("4TF26-ARSENAL-CL-FL"), false);
    assert.equal(isWc26OpponentAllocatorEventCode("LEEDS26-FACUP"), false);
    assert.equal(isWc26OpponentAllocatorEventCode("BB26-KAYODE"), false);
  });
});

describe("equalSplitMonetaryAmounts", () => {
  it("splits evenly with remainder on last index", () => {
    const parts = equalSplitMonetaryAmounts(100, 3);
    assert.equal(parts.length, 3);
    assert.ok(Math.abs(parts.reduce((a, b) => a + b, 0) - 100) < 0.02);
  });

  it("handles singleton total", () => {
    assert.deepEqual(equalSplitMonetaryAmounts(219.16, 1), [219.16]);
  });

  it("handles two-way split", () => {
    const parts = equalSplitMonetaryAmounts(219.16, 2);
    assert.equal(parts.length, 2);
    assert.ok(Math.abs(parts[0] + parts[1] - 219.16) < 0.02);
  });
});
