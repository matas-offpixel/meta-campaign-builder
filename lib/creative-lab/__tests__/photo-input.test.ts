import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import { LARGE_PHOTO_SIDE, MAX_PHOTO_PIXELS, needsDownscale, preparePhoto } from "../photo-input.ts";

describe("press photos too large to judge whole", () => {
  it("scales only past 64 MP: every photo stored on 18 Nov (largest 9504 × 6336, 60.2 MP) is left as it is", () => {
    assert.equal(MAX_PHOTO_PIXELS, 64_000_000);
    assert.equal(needsDownscale(9504, 6336), false);
    assert.equal(needsDownscale(6000, 4000), false);
    assert.equal(needsDownscale(8000, 8000), false);
    assert.equal(needsDownscale(9344, 11706), true, "management's 18 Nov photo, 109 MP");
  });

  it("returns a small photo's own bytes", async () => {
    const small = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#808080" } }).jpeg().toBuffer();
    const out = await preparePhoto(small);
    assert.equal(out.note, null);
    assert.equal(out.bytes, small);
  });

  it("scales a photo over 64 MP to 4800 px on its long side, upright", async () => {
    const big = await sharp({ create: { width: 6400, height: 10001, channels: 3, background: "#406080" } }).jpeg({ quality: 60 }).toBuffer();
    const out = await preparePhoto(big);
    const meta = await sharp(out.bytes).metadata();
    assert.equal(Math.max(meta.width!, meta.height!), LARGE_PHOTO_SIDE);
    assert.equal(meta.height, LARGE_PHOTO_SIDE);
    assert.match(out.note ?? "", /6400 × 10001 \(64\.0 MP\) scaled to 4800 px/);
  });
});
