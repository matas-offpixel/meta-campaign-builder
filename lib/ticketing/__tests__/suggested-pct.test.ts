import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { suggestedPct } from "../suggested-pct.ts";

describe("suggestedPct", () => {
  it("matches the ticketing comms reference points", () => {
    assert.equal(Math.round(suggestedPct(0)), 60);
    assert.equal(Math.round(suggestedPct(50)), 70);
    assert.equal(Math.round(suggestedPct(75)), 95);
    assert.equal(Math.round(suggestedPct(82)), 97);
    assert.equal(Math.round(suggestedPct(90)), 99);
    assert.equal(Math.round(suggestedPct(95)), 99);
  });
});
