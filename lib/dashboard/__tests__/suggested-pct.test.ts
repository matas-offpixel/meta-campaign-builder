import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { suggestedCommsPhrase, suggestedPct } from "../suggested-pct.ts";

describe("suggestedPct", () => {
  it("matches the marketing comms reference curve", () => {
    assert.equal(suggestedPct(0), 60);
    assert.equal(Math.round(Number(suggestedPct(49))), 69);
    assert.equal(Math.round(Number(suggestedPct(50))), 70);
    assert.equal(Math.round(Number(suggestedPct(75))), 95);
    assert.equal(Math.round(Number(suggestedPct(82))), 97);
    assert.equal(Math.round(Number(suggestedPct(90))), 99);
    assert.equal(Math.round(Number(suggestedPct(95))), 99);
    assert.equal(suggestedPct(100), "SOLD OUT");
  });

  it("handles explicit sellout and boundary cases", () => {
    assert.equal(suggestedPct(99.5), 99);
    assert.equal(suggestedPct(20, { isSoldOut: true }), "SOLD OUT");
    assert.equal(suggestedPct(0), 60);
    assert.equal(suggestedCommsPhrase("SOLD OUT"), "SOLD OUT");
    assert.equal(suggestedCommsPhrase(99), "Final tickets remaining");
  });
});
