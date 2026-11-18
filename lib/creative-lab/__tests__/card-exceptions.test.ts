import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CARD_RULE_EXCEPTIONS, cardRuleException, exceptionLine } from "../card-exceptions.ts";

const PHOTO = "2a5fcf27-10c0-449c-b9e0-4358edf3527c";

describe("artist-card rule exceptions", () => {
  it("covers Luke Dean's 19 09 42 press photo on P26-BDAY only, 9:16, 4:5 and 1:1, variant A, with the ruling and dates", () => {
    const hit = cardRuleException("P26-BDAY", PHOTO);
    assert.ok(hit);
    assert.equal(hit.variant, "A");
    assert.deepEqual(hit.formats, ["9x16", "4x5", "1x1"]);
    assert.equal(hit.ruledBy, "Matas");
    assert.equal(hit.ruledOn, "2026-11-17");
    assert.match(hit.ruling, /4:5 and 1:1 added by Matas on 18 Nov 2026/);
    assert.match(hit.ruling, /same contrast override/);
  });

  it("draws the 4:5 and 1:1 for that photo only: every other photo still fails the rules at 4:5 and 1:1", () => {
    // scripts/artist-card.mts draws a format past a failing rule only when the asset's exception lists it.
    const draws = (event: string, asset: string, format: "9x16" | "4x5" | "1x1") => cardRuleException(event, asset)?.formats.includes(format) ?? false;
    for (const format of ["4x5", "1x1"] as const) {
      assert.equal(draws("P26-BDAY", PHOTO, format), true, format);
      assert.equal(draws("P26-BDAY", "f05853cd-88e8-46d7-ac6c-21a1aef7fcba", format), false, `binned photo ${format}`);
      assert.equal(draws("P26-BDAY", "00000000-0000-0000-0000-000000000000", format), false, `any other photo ${format}`);
      assert.equal(draws("NX26-LOCKLEAD", PHOTO, format), false, `same photo, other event ${format}`);
    }
  });

  it("never applies to another event or another photo, and the binned 14 00 31 photo has none", () => {
    assert.equal(cardRuleException("NX26-LOCKLEAD", PHOTO), null);
    assert.equal(cardRuleException("P26-BDAY", "f05853cd-88e8-46d7-ac6c-21a1aef7fcba"), null);
    assert.equal(CARD_RULE_EXCEPTIONS.length, 1);
  });

  it("prints every failing rule it overrides, with the measured value", () => {
    const line = exceptionLine(cardRuleException("P26-BDAY", PHOTO)!, [{ rule: "contrast", detail: "54.6 % of the text box below 3:1 (max 10 %)" }]);
    assert.match(line, /^EXCEPTION \(Matas, 2026-11-17\): variant A drawn although it fails, 9x16, 4x5, 1x1 only\. Overrides: contrast: 54\.6 %/);
  });
});
