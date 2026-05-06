import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeVideoSourcesDeduped } from "../merge-video-sources.ts";

describe("mergeVideoSourcesDeduped", () => {
  it("dedupes overlapping video ids across campaigns", () => {
    const a = [
      { id: "v1", title: "A" },
      { id: "v2", title: "B" },
    ];
    const b = [
      { id: "v2", title: "B2" },
      { id: "v3", title: "C" },
    ];
    const merged = mergeVideoSourcesDeduped([a, b]);
    assert.equal(merged.length, 3);
    assert.deepEqual(merged.map((v) => v.id), ["v1", "v2", "v3"]);
    assert.equal(merged.find((v) => v.id === "v2")?.title, "B");
  });
});
