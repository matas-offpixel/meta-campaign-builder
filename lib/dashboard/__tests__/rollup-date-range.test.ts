import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eachInclusiveYmd } from "../rollup-date-range.ts";

describe("eachInclusiveYmd", () => {
  it("returns inclusive UTC calendar steps", () => {
    assert.deepEqual(eachInclusiveYmd("2026-04-08", "2026-04-10"), [
      "2026-04-08",
      "2026-04-09",
      "2026-04-10",
    ]);
  });
  it("returns single day when since equals until", () => {
    assert.deepEqual(eachInclusiveYmd("2026-04-18", "2026-04-18"), [
      "2026-04-18",
    ]);
  });
  it("returns empty when since > until", () => {
    assert.deepEqual(eachInclusiveYmd("2026-04-10", "2026-04-08"), []);
  });
});
