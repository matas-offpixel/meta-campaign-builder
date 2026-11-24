import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CARD_RULE_EXCEPTIONS, cardRuleException, exceptionAllows, exceptionLine, storedPhotoSha256 } from "../card-exceptions.ts";

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
    assert.equal(CARD_RULE_EXCEPTIONS.length, 2);
  });

  it("prints every failing rule it overrides, with the measured value", () => {
    const line = exceptionLine(cardRuleException("P26-BDAY", PHOTO)!, [{ rule: "contrast", detail: "54.6 % of the text box below 3:1 (max 10 %)" }]);
    assert.match(line, /^EXCEPTION \(Matas, 2026-11-17\): variant A drawn although it fails, 9x16, 4x5, 1x1 only\. Overrides: contrast: 54\.6 %/);
  });

  describe("card 5: the 18 Nov preferred photo, cut-out (B), ruled by Matas 18 Nov", () => {
    const SHA = "bf617e7c613761aa7504ace368b09c08770e67df6e6fe24249c18d2dd0357df6";
    const STORED = `images/creative-lab/fe3736d8-4252-4282-bb32-de1e3fdfb359/${SHA}.jpg`;
    // The drafts Matas accepted (18 Nov): face box 97.71 % solid, edge spill 20.40 %.
    const MEASURED = { faceAlphaShare: 0.9771, spillShare: 0.204 };

    it("matches those exact bytes on P26-BDAY by the stored file's sha256, whatever the asset id", () => {
      assert.equal(storedPhotoSha256(STORED), SHA);
      const hit = cardRuleException("P26-BDAY", "any-asset-id", STORED);
      assert.ok(hit);
      assert.equal(hit.variant, "B");
      assert.deepEqual(hit.formats, ["9x16", "4x5", "1x1"]);
      assert.deepEqual(hit.overrides, ["faceAlpha", "spill"]);
      assert.equal(hit.ruledBy, "Matas");
      assert.equal(hit.ruledOn, "2026-11-18");
      assert.equal(cardRuleException("NX26-LOCKLEAD", "any-asset-id", STORED), null);
    });

    it("another photo still fails: no exception for other bytes, and the old photo's doesn't carry over", () => {
      assert.equal(cardRuleException("P26-BDAY", "f05853cd-88e8-46d7-ac6c-21a1aef7fcba", `images/creative-lab/x/${"0".repeat(64)}.jpg`), null);
      const old = cardRuleException("P26-BDAY", PHOTO);
      assert.ok(old && old.variant === "A" && old.photoSha256 === undefined);
      assert.equal(storedPhotoSha256("images/creative-lab/x/not-a-hash.jpg"), null);
    });

    it("covers its two rules at the measured figures, and nothing over the caps or beyond them", () => {
      const e = cardRuleException("P26-BDAY", "any", STORED)!;
      assert.deepEqual(exceptionAllows(e, ["faceAlpha", "spill"], MEASURED), { ok: true });
      assert.equal(exceptionAllows(e, ["faceAlpha", "spill"], { ...MEASURED, faceAlphaShare: 0.976 }).ok, false, "face box under 97.7 %");
      assert.equal(exceptionAllows(e, ["faceAlpha", "spill"], { ...MEASURED, spillShare: 0.206 }).ok, false, "spill over 20.5 %");
      assert.equal(exceptionAllows(e, ["faceAlpha", "spill", "halo"], MEASURED).ok, false, "a rule it doesn't name");
      assert.equal(exceptionAllows(e, ["contrast"], MEASURED).ok, false);
      assert.equal(exceptionAllows(e, ["faceAlpha"], { faceAlphaShare: null }).ok, false, "unmeasured");
    });

    it("leaves the #1307 exception as ruled: every failing rule of its variant", () => {
      assert.deepEqual(exceptionAllows(cardRuleException("P26-BDAY", PHOTO)!, ["contrast", "anything"], {}), { ok: true });
    });
  });
});
