import assert from "node:assert/strict";
import { describe, it } from "node:test";

import reference from "../../../src/remotion/caption-style/reference/reference.json" with { type: "json" };
import { CHARS_PER_LINE, LOW_QUALITY_AFTER_CROP, boxInsideRect, captionInsideSafeRect, captionLayout, captionLineStrokes, cropWindow, hashProfile, lineFits, outputSize, profile, styleVersion } from "../../../src/remotion/caption-style/profile.ts";
import { quoteProfile, quoteStyleVersion } from "../../../src/remotion/caption-style/quote-profile.ts";

const sourceY = profile.verticalCenterPctOfSourceHeight * 1280;

describe("caption layout", () => {
  it("9:16 is uncropped and scaled to 1080×1920", () => {
    const layout = captionLayout(720, 1280, "9:16", 0.5);
    assert.deepEqual(layout.output, { width: 1080, height: 1920 });
    assert.deepEqual(layout.crop, { left: 0, top: 0, width: 720, height: 1280 });
    assert.ok(Math.abs(layout.scale - 1080 / 720) < 0.0001);
    assert.ok(Math.abs(layout.fontPx - profile.fontSizePctOfWidth * 1080) < 0.01, `font ${layout.fontPx}`);
    assert.equal(layout.crop.top, 0);
    assert.ok(Math.abs(layout.centerY - sourceY * layout.scale) < 0.01);
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

  it("every source outputs 1080×1920", () => {
    assert.deepEqual(outputSize(1080, 1920, "9:16"), { width: 1080, height: 1920 });
    assert.deepEqual(outputSize(720, 1280, "9:16"), { width: 1080, height: 1920 });
    assert.throws(() => outputSize(1080, 1920, "4:5"), /9:16 only/);
  });

  it("crops each aspect to a 9:16 window and scales it", () => {
    assert.deepEqual(cropWindow(1080, 1920, 0.5), { left: 0, top: 0, width: 1080, height: 1920 });
    const fourFive = cropWindow(1080, 1350, 0.5);
    assert.equal(fourFive.height, 1350);
    assert.equal(fourFive.width, 760);
    assert.equal(fourFive.left, (1080 - 760) / 2);
    const square = cropWindow(1080, 1080, 0.5);
    assert.deepEqual(square, { left: (1080 - 608) / 2, top: 0, width: 608, height: 1080 });
    const wide = cropWindow(1920, 1080, 0.5);
    assert.deepEqual(wide, { left: (1920 - 608) / 2, top: 0, width: 608, height: 1080 });
    const fourThree = cropWindow(1440, 1080, 0.5);
    assert.equal(fourThree.width, 608);
    assert.equal(fourThree.height, 1080);
    const tall = cropWindow(1080, 2400, 0.5);
    assert.deepEqual(tall, { left: 0, top: (2400 - 1920) / 2, width: 1080, height: 1920 });
    const fitted = captionLayout(1920, 1080, "9:16", 0.5, "default", 0.5);
    assert.deepEqual(fitted.output, { width: 1080, height: 1920 });
    assert.equal(fitted.crop.width, 608);
    assert.ok(Math.abs(fitted.scale - 1080 / 608) < 0.0001);
  });

  it("places a 16:9 window by focus and clamps 0 and 1", () => {
    assert.equal(cropWindow(1920, 1080, 0).left, 0);
    assert.equal(cropWindow(1920, 1080, 0.5).left, (1920 - 608) / 2);
    assert.equal(cropWindow(1920, 1080, 1).left, 1920 - 608);
    assert.equal(cropWindow(1920, 1080, -2).left, 0);
    assert.equal(cropWindow(1920, 1080, 4).left, 1920 - 608);
  });

  it("refuses a crop under 540 px wide", () => {
    const small = cropWindow(800, 450, 0.5);
    assert.ok(small.width < 540);
    assert.throws(() => outputSize(800, 450, "9:16"), (err: unknown) => err instanceof Error && err.message === LOW_QUALITY_AFTER_CROP);
  });

  it("strokes every line from the profile", () => {
    const layout = captionLayout(720, 1280, "9:16", 0.5);
    const strokes = captionLineStrokes(reference.lines.length, layout);
    assert.equal(strokes.length, reference.lines.length);
    const expected = profile.strokeWidthPctOfFontSize * layout.fontPx;
    for (const stroke of strokes) {
      assert.equal(stroke.color, profile.stroke);
      assert.ok(Math.abs(stroke.widthPx - expected) < 0.001);
      assert.equal(stroke.drawnPx, stroke.widthPx * 2);
    }
    assert.ok(Math.abs(expected - 2 * (1080 / 720)) < 0.01, `outside edge ${expected}px at 1080 wide`);
  });

  it("a line wider than the safe zone does not fit", () => {
    const layout = captionLayout(720, 1280, "9:16", 0.5);
    assert.equal(lineFits(300, layout), true);
    assert.equal(lineFits(layout.safeWidth + 1, layout), false);
    assert.ok(layout.safeWidth < 1080);
  });

  it("reads the wrap width from v1.json and hashes the profile stably", async () => {
    assert.equal(CHARS_PER_LINE, 18);
    assert.equal(profile.fontWeight, 400);
    assert.equal(profile.longApproved, true);
    assert.equal(profile.long.charsPerLine, 24);
    assert.equal(profile.long.maxLines, 5);
    assert.ok(Math.abs(profile.long.fontSizePctOfWidth / profile.fontSizePctOfWidth - 0.75) < 0.001);
    const layout = captionLayout(720, 1280, "9:16", 0.5);
    const longLayout = captionLayout(720, 1280, "9:16", 0.5, "long");
    assert.ok(Math.abs(longLayout.fontPx / layout.fontPx - 0.75) < 0.01);
    assert.ok(Math.abs(longLayout.strokePx / layout.strokePx - 0.75) < 0.01);
    assert.equal(await hashProfile(profile), await hashProfile({ ...profile, longApproved: false }));
    assert.equal(await styleVersion(), await styleVersion());
    assert.match(await styleVersion(), /^[0-9a-f]{64}$/);
  });

  it("rule 13 is unchanged and the quote profile is a second file", async () => {
    assert.equal(profile.fontFamily, "TikTok Sans");
    assert.equal(profile.fontWeight, 400);
    assert.equal(profile.fontWidth, 120);
    assert.equal(profile.fontSizePctOfWidth, 0.051389);
    assert.equal(profile.fill, "#FFFFFF");
    assert.equal(profile.stroke, "#000000");
    assert.equal(profile.strokeWidthPctOfFontSize, 0.054054);
    assert.equal(profile.lineHeight, 1.054);
    assert.equal(profile.charsPerLine, 18);
    assert.equal(profile.maxLines, 4);
    assert.equal(profile.horizontalCenterPctOfWidth, 0.493);
    assert.equal(profile.verticalCenterPctOfSourceHeight, 0.355469);
    assert.equal(quoteProfile.fontFamily, "TikTok Sans");
    assert.equal(quoteProfile.fontWeight, 700);
    assert.equal(quoteProfile.altFontWeight, 400);
    assert.equal(quoteProfile.fontWidth, 100);
    assert.equal(quoteProfile.stroke, null);
    assert.equal(quoteProfile.capPctOfHeight, 0.0135);
    assert.equal(quoteProfile.fontSizePctOfHeight, 0.0193);
    assert.equal(quoteProfile.pitchPctOfHeight, 0.03);
    assert.equal(quoteProfile.verticalCenterPctOfSourceHeight, 0.28);
    assert.equal(quoteProfile.verticalCenterInFourFive, 0.187);
    assert.equal(quoteProfile.horizontalCenterMin, 0.499);
    assert.equal(quoteProfile.horizontalCenterMax, 0.506);
    assert.equal(quoteProfile.wrapPctOfWidth, 0.7);
    assert.equal(quoteProfile.maxLines, 4);
    assert.equal(quoteProfile.quoteMarks, false);
    assert.equal(quoteProfile.attribution, false);
    assert.notEqual(await quoteStyleVersion(), await styleVersion());
  });

  it("five long lines stay inside the 4:5 safe rectangle at the caption centre", () => {
    const layout = captionLayout(720, 1280, "9:16", 0.5, "long");
    assert.equal(profile.longApproved, true);
    assert.equal(profile.long.maxLines, 5);
    const width = layout.safeWidth;
    assert.equal(lineFits(width, layout), true);
    assert.equal(captionInsideSafeRect(layout, Array.from({ length: 5 }, () => width)), true);
    const block = 5 * layout.fontPx * profile.lineHeight;
    assert.ok(layout.centerY - block / 2 >= layout.safeRect.y);
    assert.ok(layout.centerY + block / 2 <= layout.safeRect.y + layout.safeRect.height);
  });
});
