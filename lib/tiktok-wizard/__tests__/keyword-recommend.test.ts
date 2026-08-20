import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { recommendWithSemanticFallback } from "../keyword-recommend.ts";

describe("recommendWithSemanticFallback", () => {
  it("retries once under FUZZ_MATCH when SEMANTIC_RECOMMEND returns zero rows", async () => {
    const calls: string[] = [];
    const result = await recommendWithSemanticFallback({
      mode: "SEMANTIC_RECOMMEND",
      fetch: async (mode) => {
        calls.push(mode);
        if (mode === "SEMANTIC_RECOMMEND") return [];
        return [{ id: "techno", name: "Techno" }];
      },
    });
    assert.deepEqual(calls, ["SEMANTIC_RECOMMEND", "FUZZ_MATCH"]);
    assert.equal(result.semanticFallback, true);
    assert.equal(result.usedMode, "FUZZ_MATCH");
    assert.deepEqual(result.keywords, [{ id: "techno", name: "Techno" }]);
  });

  it("does not retry a non-empty SEMANTIC_RECOMMEND response", async () => {
    const calls: string[] = [];
    const result = await recommendWithSemanticFallback({
      mode: "SEMANTIC_RECOMMEND",
      fetch: async (mode) => {
        calls.push(mode);
        return [{ id: "house", name: "House" }];
      },
    });
    assert.deepEqual(calls, ["SEMANTIC_RECOMMEND"]);
    assert.equal(result.semanticFallback, false);
    assert.equal(result.usedMode, "SEMANTIC_RECOMMEND");
    assert.equal(result.keywords.length, 1);
  });

  it("does not retry FUZZ_MATCH even when it returns zero rows", async () => {
    const calls: string[] = [];
    const result = await recommendWithSemanticFallback({
      mode: "FUZZ_MATCH",
      fetch: async (mode) => {
        calls.push(mode);
        return [];
      },
    });
    assert.deepEqual(calls, ["FUZZ_MATCH"]);
    assert.equal(result.semanticFallback, false);
    assert.equal(result.usedMode, "FUZZ_MATCH");
  });
});
