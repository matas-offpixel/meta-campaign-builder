import assert from "node:assert/strict";
import { describe, it } from "node:test";

import reference from "../../../src/remotion/caption-style/reference/reference.json" with { type: "json" };
import { CHARS_PER_LINE, boxInsideRect, captionInsideSafeRect, captionLayout, lineFits, outputSize, profile, styleVersion } from "../../../src/remotion/caption-style/profile.ts";

const sourceY = profile.verticalCenterPctOfSourceHeight * 1280;

describe("caption layout", () => {
  it("9:16 matches the source and sizes the type from the width", () => {
    const layout = captionLayout(720, 1280, "9:16", 0.5);
    assert.deepEqual(layout.output, { width: 720, height: 1280 });
    assert.ok(Math.abs(layout.fontPx - 37) < 0.01, `font ${layout.fontPx}`);
    assert.equal(layout.crop.top, 0);
    assert.ok(Math.abs(layout.centerY - sourceY) < 0.01);
  });

  it("the centred safe rectangle is the profile's 4:5 window", () => {
    const layout = captionLayout(1080, 1920, "9:16", 0.5);
    assert.deepEqual(profile.safeRect["9:16"], { x: 0, y: 0.1458, w: 1, h: 0.7083 });
    assert.equal(layout.safeRect.x, 0);
    assert.ok(Math.abs(layout.safeRect.y - 0.1458 * 1920) < 0.01);
    assert.equal(layout.safeRect.width, 1080);
    assert.ok(Math.abs(layout.safeRect.height - 0.7083 * 1920) < 0.01);
  });

  it("crop focus 0.3 moves the rectangle up and the caption with it", () => {
    const mid = captionLayout(720, 1280, "9:16", 0.5);
    const up = captionLayout(720, 1280, "9:16", 0.3);
    assert.ok(up.safeRect.y < mid.safeRect.y);
    assert.ok(up.centerY < mid.centerY);
    assert.ok(Math.abs(mid.safeRect.y - up.safeRect.y - (mid.centerY - up.centerY)) < 0.01);
    assert.equal(up.crop.top, 0);
    assert.ok(up.safeRect.y >= 0);
    assert.ok(up.safeRect.y + up.safeRect.height <= up.output.height + 0.01);
  });

  it("a caption block inside the safe rectangle passes, and one that crosses fails", () => {
    const layout = captionLayout(720, 1280, "9:16", 0.5);
    assert.equal(captionInsideSafeRect(layout, [200, 180, 160, 80]), true);
    assert.equal(captionInsideSafeRect(layout, [layout.output.width]), false);
  });

  it("the reference caption sits inside the recorded safe rectangle", () => {
    assert.deepEqual(reference.safeRect, profile.safeRect["9:16"]);
    const frame = reference.frame;
    const spec = reference.safeRect;
    const rect = { x: spec.x * frame.width, y: spec.y * frame.height, width: spec.w * frame.width, height: spec.h * frame.height };
    const box = reference.box;
    assert.equal(boxInsideRect(rect, { left: box.x, top: box.y, width: box.width, height: box.height }), true);
    const centre = (box.y + box.height / 2) / frame.height;
    assert.ok(centre > 0.34 && centre < 0.37, `block centre ${centre}`);
  });

  it("a 1080 source stays 1080 and a 720 source is never upscaled", () => {
    assert.deepEqual(outputSize(1080, 1920, "9:16"), { width: 1080, height: 1920 });
    assert.equal(outputSize(720, 1280, "9:16").width, 720);
    assert.throws(() => outputSize(1080, 1920, "4:5"), /9:16 only/);
  });

  it("rounds an odd source down to even dimensions", () => {
    assert.deepEqual(outputSize(721, 1281, "9:16"), { width: 720, height: 1280 });
  });

  it("a wide original is centre-cropped to 9:16", () => {
    const vertical = captionLayout(956, 718, "9:16", 0.5);
    assert.deepEqual(vertical.output, { width: 402, height: 718 });
    assert.equal(vertical.scale, 1);
    assert.equal(vertical.crop.left, (956 - 402) / 2);
    assert.equal(vertical.crop.top, 0);
  });

  it("a line wider than the safe zone does not fit", () => {
    const layout = captionLayout(720, 1280, "9:16", 0.5);
    assert.equal(lineFits(300, layout), true);
    assert.equal(lineFits(layout.safeWidth + 1, layout), false);
    assert.ok(layout.safeWidth < 720);
  });

  it("reads the wrap width from v1.json and hashes the profile stably", async () => {
    assert.equal(CHARS_PER_LINE, 18);
    assert.equal(profile.fontWeight, 500);
    assert.equal(await styleVersion(), await styleVersion());
    assert.match(await styleVersion(), /^[0-9a-f]{64}$/);
  });
});
