import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OVERLAY_TOOL, frameSampleTimes, overlayPrompt, settleOverlayVerdict } from "../overlay-check.ts";

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

  it("keeps a clip clean when the frames name scene branding with text false", () => {
    const settled = settleOverlayVerdict({
      verdict: "clean",
      frames: [
        { t: 4.571, text: false, what: "Pioneer branding on DJ equipment, part of the scene" },
        { t: 16.786, text: false, what: "Pioneer branding on DJ equipment, part of the scene" },
        { t: 21, text: false, what: "Supreme logo on a cap" },
      ],
      reason: "Only equipment branding and clothing logos.",
    });
    assert.equal(settled.verdict, "clean");
    assert.equal(settled.flagged, 0);
  });

  it("stays strict: one frame marked text is text_overlay whatever the verdict says", () => {
    const settled = settleOverlayVerdict({ verdict: "clean", frames: [{ t: 4, text: true, what: "SAT 14 JUNE" }] });
    assert.equal(settled.verdict, "text_overlay");
    assert.equal(settled.flagged, 1);
  });
});

describe("overlay prompt", () => {
  it("names the thumbnail only when one is sent", () => {
    const withThumb = overlayPrompt({ thumbnail: true });
    const without = overlayPrompt({ thumbnail: false });
    assert.match(withThumb, /The second image is the thumbnail\./);
    assert.match(withThumb, /Text on the thumbnail only is check_by_eye/);
    assert.doesNotMatch(without, /second image/);
    assert.doesNotMatch(without, /Text on the thumbnail only/);
    assert.match(without, /There is no thumbnail\./);
  });

  it("says, in the prompt and the schema, that scene branding is never text", () => {
    const rule = OVERLAY_TOOL.input_schema.properties.frames.items.properties.text.description;
    assert.match(rule, /added on top of the footage in editing/);
    assert.match(rule, /equipment branding/);
    assert.match(rule, /never text/);
    assert.ok(overlayPrompt({ thumbnail: false }).includes(rule));
  });
});
