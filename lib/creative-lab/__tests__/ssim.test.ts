import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { maskOverlap, readPng, ssim, thresholdBox } from "../ssim.ts";

function fill(width: number, height: number, on: (x: number, y: number) => boolean): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (on(x, y)) out[y * width + x] = 255;
  return out;
}

describe("caption mask comparison", () => {
  it("scores identical masks at 1 and a shifted mask lower", () => {
    const width = 16;
    const height = 16;
    const block = (dx: number) => fill(width, height, (x, y) => x >= 4 + dx && x < 12 + dx && y >= 4 && y < 12);
    const same = block(0);
    assert.ok(ssim(same, block(0), width, height) > 0.999);
    assert.equal(maskOverlap(same, block(0)).dice, 1);
    const shifted = ssim(same, block(2), width, height);
    assert.ok(shifted < 0.95, `shifted ${shifted}`);
    const overlap = maskOverlap(same, block(2));
    assert.ok(overlap.iou < 1 && overlap.iou > 0.4);
  });

  it("reads the reference frame and finds the caption inside the stored box", () => {
    const frame = readPng(readFileSync(new URL("../../../src/remotion/caption-style/reference/frame.png", import.meta.url)));
    assert.deepEqual([frame.width, frame.height], [720, 1280]);
    const mask = thresholdBox(frame, { x: 190, y: 377, width: 330, height: 156 }, 175);
    const lit = mask.reduce((sum, v) => sum + (v === 255 ? 1 : 0), 0);
    assert.ok(lit > 1000, `lit ${lit}`);
  });
});
