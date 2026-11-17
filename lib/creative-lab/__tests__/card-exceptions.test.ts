import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CARD_RULE_EXCEPTIONS, cardRuleException, exceptionLine } from "../card-exceptions.ts";

const PHOTO = "2a5fcf27-10c0-449c-b9e0-4358edf3527c";

describe("artist-card rule exceptions", () => {
  it("covers Luke Dean's 19 09 42 press photo on P26-BDAY only, 9:16, variant A, with the ruling and date", () => {
    const hit = cardRuleException("P26-BDAY", PHOTO);
    assert.ok(hit);
    assert.equal(hit.variant, "A");
    assert.deepEqual(hit.formats, ["9x16"]);
    assert.equal(hit.ruledBy, "Matas");
    assert.equal(hit.ruledOn, "2026-11-17");
  });

  it("never applies to another event or another photo, and the binned 14 00 31 photo has none", () => {
    assert.equal(cardRuleException("NX26-LOCKLEAD", PHOTO), null);
    assert.equal(cardRuleException("P26-BDAY", "f05853cd-88e8-46d7-ac6c-21a1aef7fcba"), null);
    assert.equal(CARD_RULE_EXCEPTIONS.length, 1);
  });

  it("prints every failing rule it overrides, with the measured value", () => {
    const line = exceptionLine(cardRuleException("P26-BDAY", PHOTO)!, [{ rule: "contrast", detail: "54.6 % of the text box below 3:1 (max 10 %)" }]);
    assert.match(line, /^EXCEPTION \(Matas, 2026-11-17\): variant A drawn although it fails, 9x16 only\. Overrides: contrast: 54\.6 %/);
  });
});
