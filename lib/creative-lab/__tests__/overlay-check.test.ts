import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { frameSampleTimes, settleOverlayVerdict } from "../overlay-check.ts";

describe("overlay check", () => {
  it("takes eight times: the half second, six between, and the last second", () => {
    const times = frameSampleTimes(30);
    assert.equal(times.length, 8);
    assert.equal(times[0], 0.5);
    assert.equal(times[7], 29);
  });

  it("keeps a clean clip, rejects burned-in text, and holds thumbnail-only and unsure for a person", () => {
    const frames = [{ t: 0.5, text: false, what: "" }];
    assert.equal(settleOverlayVerdict({ verdict: "clean", frames }).verdict, "clean");
    const burned = settleOverlayVerdict({
      verdict: "text_overlay",
      frames: [
        { t: 1, text: true, what: "date" },
        { t: 2, text: true, what: "date" },
        { t: 3, text: true, what: "title" },
      ],
    });
    assert.equal(burned.verdict, "text_overlay");
    assert.equal(burned.reason, "Text burned into 3 of 8 frames");
    assert.equal(settleOverlayVerdict({ verdict: "clean", frames: [{ t: 0, text: true, what: "title", thumbnail: true }] }).verdict, "check_by_eye");
    assert.equal(settleOverlayVerdict({ verdict: "clean", unsure: true, frames }).verdict, "check_by_eye");
  });
});
