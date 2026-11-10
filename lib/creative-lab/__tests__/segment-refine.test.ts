import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { guidedFilter, refineAtSource } from "../segment.ts";

describe("refineAtSource (O21 round 5 matte)", () => {
  it("equals one guided-filter pass (radius 8) over the region, computed in strips, and leaves the rest unchanged", async () => {
    const sharp = (await import("sharp")).default;
    const w = 48;
    const h = 1200; // more than two 512-row strips
    const rgb = Buffer.alloc(w * h * 3);
    const alpha = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const v = x < 20 + ((y >> 4) % 7) ? 210 : 40;
        rgb.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3);
        alpha[y * w + x] = Math.min(1, Math.max(0, (30 - x) / 14));
      }
    }
    const png = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const region = { left: 0, top: 100, width: w, height: 1000 };
    const got = await refineAtSource(png, { width: w, height: h, alpha }, region);
    const grey = await sharp(png).greyscale().raw().toBuffer();
    const I = new Float32Array(w * 1000);
    const p = new Float32Array(w * 1000);
    for (let y = 0; y < 1000; y += 1) {
      for (let x = 0; x < w; x += 1) {
        I[y * w + x] = grey[(y + 100) * w + x]! / 255;
        p[y * w + x] = alpha[(y + 100) * w + x]!;
      }
    }
    const whole = guidedFilter(I, p, w, 1000, 8, 1e-3);
    let maxDiff = 0;
    for (let y = 0; y < 1000; y += 1) for (let x = 0; x < w; x += 1) maxDiff = Math.max(maxDiff, Math.abs(got.alpha[(y + 100) * w + x]! - whole[y * w + x]!));
    assert.ok(maxDiff < 1e-4, `max difference ${maxDiff}`);
    assert.equal(got.alpha[50 * w + 25], alpha[50 * w + 25]);
    assert.equal(got.alpha[1150 * w + 25], alpha[1150 * w + 25]);
  });
});
