import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { suggestedCommsPhrase } from "../comms-phrase.ts";
import { suggestedPct } from "../suggested-pct.ts";

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
    assert.deepEqual(suggestedCommsPhrase("SOLD OUT"), {
      primary: "SOLD OUT",
      short: "Sold Out",
    });
    assert.deepEqual(suggestedCommsPhrase(99), {
      primary: "Final tickets remaining",
      short: "Final tickets",
    });
  });

  it("maps suggested percent boundaries to operator comms phrases", () => {
    assert.deepEqual(suggestedCommsPhrase(undefined), {
      primary: "On Sale Soon",
      short: "Soon",
    });
    assert.deepEqual(suggestedCommsPhrase(null), {
      primary: "On sale now",
      short: "On sale",
    });
    assert.deepEqual(suggestedCommsPhrase(90), {
      primary: "Almost sold out",
      short: "Almost sold out",
    });
    assert.deepEqual(suggestedCommsPhrase(80), {
      primary: "Limited tickets remaining",
      short: "Limited",
    });
    assert.deepEqual(suggestedCommsPhrase(70), {
      primary: "Selling fast",
      short: "Selling fast",
    });
    assert.deepEqual(suggestedCommsPhrase(60), {
      primary: "Over half sold",
      short: "Half sold",
    });
    assert.deepEqual(suggestedCommsPhrase(30), {
      primary: "On sale now",
      short: "On sale",
    });
    assert.deepEqual(suggestedCommsPhrase(75, "on_sale_soon"), {
      primary: "On Sale Soon",
      short: "Soon",
    });
  });
});
