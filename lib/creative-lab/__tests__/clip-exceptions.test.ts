import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLIP_FACE_EXCEPTIONS, clipExceptionLine, clipFaceException, faceExceptionAllows } from "../clip-exceptions.ts";
import { T1V_FACE } from "../t1-face.ts";

const C27 = "01aa4d92-b946-455e-8823-16b4f00cd97a";
const C30 = "b75b6bf8-1020-44f7-bbec-0bc368870cb4";
// The other P26-BDAY Luke clips with T1 edits (29, 33, 34).
const OTHERS = ["7c5f8707-edf3-4af9-b163-5785375b0204", "b533f644-5566-4a35-b5b8-e6d51c827bb3", "89089cf1-f0b6-4549-9400-9359c6ce3811"];
// The approved drafts' figures (18 Nov run, 5 samples a second): 27 is 16 of 72 claim samples, 12 of 80 top, an
// 8-sample run; 30 is 16 of 92, 17 of 100, a 6-sample run.
const APPROVED_27 = { claimShare: 16 / 72, topShare: 12 / 80, longestRunS: 8 / 5 };
const APPROVED_30 = { claimShare: 16 / 92, topShare: 17 / 100, longestRunS: 6 / 5 };

describe("T1 face-rule clip exceptions", () => {
  it("covers P26-BDAY clips 27 and 30, roll-call only, ruled by Matas on 18 Nov 2026", () => {
    assert.equal(CLIP_FACE_EXCEPTIONS.length, 2);
    for (const id of [C27, C30]) {
      const hit = clipFaceException("P26-BDAY", id, "v2-roll-call");
      assert.ok(hit);
      assert.equal(hit.ruledBy, "Matas");
      assert.equal(hit.ruledOn, "2026-11-18");
      assert.equal(hit.maxClaimShare, 0.225);
    }
  });

  it("lets the approved drafts through at their measured figures, which the rule refuses", () => {
    for (const [id, figures] of [[C27, APPROVED_27], [C30, APPROVED_30]] as const) {
      assert.ok(figures.claimShare > T1V_FACE.maxShare, "the rule refuses it");
      assert.equal(faceExceptionAllows(clipFaceException("P26-BDAY", id, "v2-roll-call"), figures), true);
    }
    assert.match(clipExceptionLine(clipFaceException("P26-BDAY", C27, "v2-roll-call")!, APPROVED_27), /^EXCEPTION \(Matas, 2026-11-18\): clip 27 v2-roll-call .* claim 22\.2 % \(cap 22\.5 %\)/);
  });

  it("still refuses above any cap", () => {
    const e27 = clipFaceException("P26-BDAY", C27, "v2-roll-call");
    assert.equal(faceExceptionAllows(e27, { ...APPROVED_27, claimShare: 0.23 }), false, "claim over 22 %");
    assert.equal(faceExceptionAllows(e27, { ...APPROVED_27, topShare: 0.16 }), false, "top block over its cap");
    assert.equal(faceExceptionAllows(e27, { ...APPROVED_27, longestRunS: 1.8 }), false, "run over its cap");
    const e30 = clipFaceException("P26-BDAY", C30, "v2-roll-call");
    assert.equal(faceExceptionAllows(e30, { ...APPROVED_30, claimShare: 0.23 }), false);
    assert.equal(faceExceptionAllows(e30, APPROVED_27), false, "27's figures are over 30's caps");
  });

  it("never applies to the no-CTA, to another clip or to another event", () => {
    for (const id of [C27, C30]) {
      assert.equal(clipFaceException("P26-BDAY", id, "v1-no-cta"), null);
      assert.equal(clipFaceException("NX26-LOCKLEAD", id, "v2-roll-call"), null);
    }
    for (const id of OTHERS) assert.equal(clipFaceException("P26-BDAY", id, "v2-roll-call"), null);
    assert.equal(faceExceptionAllows(null, { claimShare: 0, topShare: 0, longestRunS: 0 }), false);
  });
});
