import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { suggestedPct } from "../../dashboard/suggested-pct.ts";

describe("suggestedPct", () => {
  it("matches the ticketing comms reference points", () => {
    assert.equal(suggestedPct(0), 60);
    assert.equal(Math.round(Number(suggestedPct(50))), 70);
    assert.equal(Math.round(Number(suggestedPct(75))), 95);
    assert.equal(Math.round(Number(suggestedPct(82))), 97);
    assert.equal(Math.round(Number(suggestedPct(90))), 99);
    assert.equal(Math.round(Number(suggestedPct(95))), 99);
    assert.equal(suggestedPct(100), "SOLD OUT");
  });
});
