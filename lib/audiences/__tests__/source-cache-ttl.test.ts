import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AUDIENCE_SOURCE_CACHE_TTL_MS } from "../source-cache.ts";

describe("audience source cache TTL", () => {
  it("uses a 30-minute TTL for read-heavy Graph sources", () => {
    assert.equal(AUDIENCE_SOURCE_CACHE_TTL_MS, 30 * 60 * 1000);
  });
});
