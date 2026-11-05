import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CHARS_PER_LINE, captionLayout, lineFits, outputSize, profile, styleVersion } from "../../../src/remotion/caption-style/profile.ts";

const sourceY = profile.verticalCenterPctOfSourceHeight * 1280;

describe("caption layout", () => {
  it("9:16 matches the source and sizes the type from the width", () => {
    const layout = captionLayout(720, 1280, "9:16", 0.5);
    assert.deepEqual(layout.output, { width: 720, height: 1280 });
    assert.ok(Math.abs(layout.fontPx - 37) < 0.01, `font ${layout.fontPx}`);
    assert.equal(layout.crop.top, 0);
    assert.ok(Math.abs(layout.centerY - sourceY) < 0.01);
  });

  it("4:5 is a same-width crop, so the caption stays the same size on the same footage", () => {
    const vertical = captionLayout(720, 1280, "9:16", 0.5);
    const feed = captionLayout(720, 1280, "4:5", 0.5);
    assert.deepEqual(feed.output, { width: 720, height: 900 });
    assert.equal(feed.fontPx, vertical.fontPx);
    assert.equal(feed.crop.top, 190);
    assert.ok(Math.abs(feed.centerY - (sourceY - 190)) < 0.01);
  });

  it("a lower crop focus moves the window and the caption stays put on the footage", () => {
    const low = captionLayout(720, 1280, "4:5", 0.7);
    assert.equal(low.crop.top, 380);
    assert.ok(Math.abs(low.centerY - (sourceY - 380)) < 0.01);
  });

  it("a 1080 source stays 1080 and a 720 source is never upscaled", () => {
    assert.deepEqual(outputSize(1080, 1920, "9:16"), { width: 1080, height: 1920 });
    assert.deepEqual(outputSize(1080, 1920, "4:5"), { width: 1080, height: 1350 });
    assert.equal(outputSize(720, 1280, "9:16").width, 720);
  });

  it("rounds an odd source down to even dimensions", () => {
    assert.deepEqual(outputSize(721, 1281, "9:16"), { width: 720, height: 1280 });
  });

  it("a wide original is centre-cropped to 9:16, and 4:5 crops that window", () => {
    const vertical = captionLayout(956, 718, "9:16", 0.5);
    assert.deepEqual(vertical.output, { width: 402, height: 718 });
    assert.equal(vertical.scale, 1);
    assert.equal(vertical.crop.left, (956 - 402) / 2);
    assert.equal(vertical.crop.top, 0);
    const feed = captionLayout(956, 718, "4:5", 0.5);
    assert.deepEqual(feed.output, { width: 402, height: 502 });
    assert.equal(feed.fontPx, vertical.fontPx);
    assert.equal(feed.crop.left, vertical.crop.left);
    assert.equal(feed.crop.top, 108);
  });

  it("refuses a source too short to crop to 4:5", () => {
    assert.throws(() => outputSize(720, 800, "4:5"), /not tall enough/);
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
