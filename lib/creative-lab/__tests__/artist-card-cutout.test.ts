import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CUTOUT, CUTOUT_DISCLOSURE, bottomReach, chooseVariant, deltaE, distanceOutside, haloShare, planCutout, rgbToLab, slicedEdges } from "../artist-card-cutout.ts";
import { extensionLabel } from "../artist-card.ts";

function mask(width: number, height: number, fill: (x: number, y: number) => number) {
  const alpha = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) alpha[y * width + x] = fill(x, y);
  return { width, height, alpha };
}

describe("O21 bottom-anchoring", () => {
  // 4000×6000 portrait, a waist-up person to the bottom; head top 1500, eyes 2000, chin 2600, face box 1200 px.
  const photo = { width: 4000, height: 6000 };
  const face = { eyeX: 2000, eyeY: 2000, headTopY: 1500, chinY: 2600, box: { x: 1400, width: 1200 } };

  it("puts the photo's bottom on the frame's bottom and the eyes in their band", () => {
    const plan = planCutout(photo, face);
    assert.ok(!("blocker" in plan));
    if ("blocker" in plan) return;
    assert.ok(Math.abs(plan.rect.top + plan.rect.height - 1920) < 1e-6);
    assert.ok(plan.eyes >= 0.58 && plan.eyes <= 0.64);
    assert.ok(Math.abs(1920 - (photo.height - face.eyeY) * plan.scale - plan.eyes * 1920) < 1e-6);
    assert.ok(plan.headTop >= 0.53 - 1e-6 && plan.chin <= 0.76 + 1e-6);
    assert.ok(plan.faceWidthPx >= 216 - 0.5);
    assert.ok(plan.scale <= 1);
    assert.ok(Math.abs(plan.rect.left + (face.box.x + face.box.width / 2) * plan.scale - 540) < 1e-6);
  });

  it("refuses a small face (box under 216 px bottom-anchored)", () => {
    const plan = planCutout(photo, { ...face, box: { x: 1700, width: 600 } });
    assert.ok("blocker" in plan);
    if ("blocker" in plan) assert.match(plan.blocker, /face box \d+ px \(min 216\)/);
  });

  it("refuses a close-up whose head can't fit the band bottom-anchored", () => {
    const plan = planCutout({ width: 5478, height: 3652 }, { eyeX: 2700, eyeY: 1450, headTopY: 600, chinY: 2300, box: { x: 2400, width: 600 } });
    assert.ok("blocker" in plan);
  });

  it("the person must reach the photo's bottom edge", () => {
    assert.ok(bottomReach(mask(100, 100, (x, y) => (x > 30 && x < 70 && y > 20 ? 1 : 0))) >= CUTOUT.bottomShare);
    assert.equal(bottomReach(mask(100, 100, (x, y) => (x > 30 && x < 70 && y > 20 && y < 90 ? 1 : 0))), 0);
  });

  it("a photo edge inside the frame that cuts the person is a slice; the frame's own edge is not", () => {
    const m = mask(100, 100, (x, y) => (x < 40 && y > 20 ? 1 : 0)); // the person runs off the photo's left edge
    assert.deepEqual(slicedEdges(m, { left: 300, top: 1000, width: 500, height: 920 }), ["left"]);
    assert.deepEqual(slicedEdges(m, { left: -50, top: 1000, width: 500, height: 920 }), []);
  });
});

describe("O21 halo", () => {
  const w = 40;
  const h = 40;
  const inside = new Uint8Array(w * h);
  for (let y = 10; y < 30; y += 1) for (let x = 10; x < 30; x += 1) inside[y * w + x] = 1;
  const green = rgbToLab(30, 160, 60);

  it("distanceOutside is 0 inside and grows outward", () => {
    const d = distanceOutside(inside, w, h);
    assert.equal(d[15 * w + 15], 0);
    assert.equal(d[15 * w + 8], 2);
  });

  it("passes when the band shows the poster, not the source background", () => {
    const comp = Buffer.alloc(w * h * 3, 200);
    assert.equal(haloShare(comp, 3, inside, w, h, green).share, 0);
  });

  it("fails when the band carries the source background colour", () => {
    const comp = Buffer.alloc(w * h * 3, 200);
    for (let y = 8; y < 32; y += 1) for (let x = 8; x < 32; x += 1) if (!inside[y * w + x]) comp.set([30, 160, 60], (y * w + x) * 3);
    const halo = haloShare(comp, 3, inside, w, h, green);
    assert.ok(halo.share > CUTOUT.halo.maxShare);
  });

  it("ΔE is CIE76 on Lab", () => {
    assert.equal(deltaE([50, 0, 0], [50, 3, 4]), 5);
    assert.ok(deltaE(rgbToLab(255, 255, 255), [100, 0, 0]) < 0.5);
  });
});

describe("O21 order and disclosure", () => {
  it("A when every rule passes, else B, else skip", () => {
    assert.equal(chooseVariant({ pass: true }, { pass: true }), "A");
    assert.equal(chooseVariant({ pass: false }, { pass: true }), "B");
    assert.equal(chooseVariant({ pass: false }, { pass: false }), "skip");
    assert.equal(chooseVariant({ pass: false }, null), "skip");
  });

  it("the two disclosure strings", () => {
    assert.equal(CUTOUT_DISCLOSURE, "artist cut out onto the poster background");
    assert.equal(extensionLabel({ top: 542, left: 0, right: 0 }), "photo extended top by 542 px");
  });
});
