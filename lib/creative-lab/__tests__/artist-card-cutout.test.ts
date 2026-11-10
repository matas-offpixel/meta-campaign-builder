import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CUTOUT,
  DISCLOSURE_B1,
  DISCLOSURE_B2,
  chooseVariant,
  distanceOutside,
  fadeAt,
  haloShare,
  maskEdges,
  panelCharcoal,
  planFigure,
  silhouetteSource,
  verticalGradient,
  type MaskEdges,
} from "../artist-card-cutout.ts";
import { extensionLabel } from "../artist-card.ts";
import { deltaE, rgbToLab } from "../colour.ts";

const none: MaskEdges = { bottom: true, left: false, right: false, top: false, headCutLeft: false, headCutRight: false, lowestRow: 5999, bottomShare: 0.4 };

describe("O21 B: figure placement", () => {
  // 4000×6000 portrait, waist-up; head top 1500, eyes 2000, chin 2600, face box 1200 px from x 1400.
  const photo = { width: 4000, height: 6000 };
  const face = { eyeX: 2000, eyeY: 2000, headTopY: 1500, chinY: 2600, box: { x: 1400, width: 1200 } };

  it("meets the face bands and the 216 px floor at ≤ 1.0×, face centred", () => {
    const plan = planFigure(photo, face, none);
    assert.ok(!("blocker" in plan));
    if ("blocker" in plan) return;
    assert.ok(plan.headTop >= 0.53 - 1e-6 && plan.chin <= 0.76 + 1e-6 && plan.eyes >= 0.58 && plan.eyes <= 0.64);
    assert.ok(plan.faceWidthPx >= 216 - 0.5);
    assert.ok(plan.scale <= 1);
    assert.ok(Math.abs(plan.faceCentreX - 0.5) < 1e-6);
    assert.equal(plan.sideCut, null);
  });

  it("fade: a figure ending above the bottom fades over its lowest 0.08 H, never below 0.80 H", () => {
    // A short photo: the person reaches its bottom edge, which lands inside the frame.
    const plan = planFigure({ width: 4000, height: 3200 }, face, none);
    assert.ok(!("blocker" in plan));
    if ("blocker" in plan) return;
    assert.ok(plan.figureEnd >= 0.8 * 1920 - 0.5);
    assert.equal(plan.fade, plan.figureEnd < 1919.5);
    assert.equal(fadeAt(plan.figureEnd - 0.08 * 1920 - 1, plan.figureEnd), 1);
    assert.ok(Math.abs(fadeAt(plan.figureEnd - 0.04 * 1920, plan.figureEnd) - 0.5) < 1e-9);
    assert.equal(fadeAt(plan.figureEnd, plan.figureEnd), 0);
  });

  it("refuses a figure that would end above 0.80 H", () => {
    const plan = planFigure({ width: 4000, height: 2700 }, face, { ...none, bottom: false, lowestRow: 2650 });
    assert.ok("blocker" in plan);
    if ("blocker" in plan) assert.match(plan.blocker, /ends at 0\.\d+ H \(min 0\.8\)/);
  });

  it("side cut: flush on the frame's left passes with the face centre in 0.38–0.62 W", () => {
    const plan = planFigure(photo, { ...face, eyeX: 1200, box: { x: 600, width: 1200 } }, { ...none, left: true });
    assert.ok(!("blocker" in plan));
    if ("blocker" in plan) return;
    assert.equal(plan.rect.left, 0);
    assert.equal(plan.sideCut, "left");
    assert.ok(plan.faceCentreX >= 0.38 && plan.faceCentreX <= 0.62);
  });

  it("side cut: a cut that would sit inside the frame fails (face centre outside 0.38–0.62 when flush)", () => {
    // In an 8000 px wide photo with the face at x 6600, the left cut flush on the frame puts the face past 0.62 W.
    const plan = planFigure({ width: 8000, height: 6000 }, { ...face, eyeX: 6600, box: { x: 6000, width: 1200 } }, { ...none, left: true });
    assert.ok("blocker" in plan);
    if ("blocker" in plan) assert.match(plan.blocker, /face centre/);
  });

  it("side cut: the head is never cut", () => {
    const plan = planFigure(photo, face, { ...none, left: true, headCutLeft: true });
    assert.ok("blocker" in plan);
    if ("blocker" in plan) assert.match(plan.blocker, /cuts the head/);
  });

  it("the photo's top edge never cuts the person", () => {
    const plan = planFigure(photo, face, { ...none, top: true });
    assert.ok("blocker" in plan);
  });

  it("maskEdges reads which photo edges the person touches", () => {
    const w = 50;
    const h = 80;
    const alpha = new Float32Array(w * h);
    for (let y = 30; y < h; y += 1) for (let x = 0; x < 20; x += 1) alpha[y * w + x] = 1;
    const e = maskEdges({ width: w, height: h, alpha }, { top: 10, bottom: 25 });
    assert.equal(e.left, true);
    assert.equal(e.right, false);
    assert.equal(e.bottom, true);
    assert.equal(e.top, false);
    assert.equal(e.headCutLeft, false);
    assert.equal(e.lowestRow, 79);
  });
});

describe("O21 B1 silhouette", () => {
  it("scales 1.18× about the figure's bottom-centre and shifts 0.05 W right", () => {
    const about = { x: 500, y: 1900 };
    assert.deepEqual(silhouetteSource(500 + 54, 1900, about), { x: 500, y: 1900 });
    const p = silhouetteSource(500 + 54 + 1.18 * 100, 1900 - 1.18 * 300, about);
    assert.ok(Math.abs(p.x - 600) < 1e-9 && Math.abs(p.y - 1600) < 1e-9);
  });

  it("steps the silhouette's opacity 100 → 70 → 50 %", () => {
    assert.deepEqual([...CUTOUT.silhouette.opacities], [1, 0.7, 0.5]);
    assert.equal(CUTOUT.silhouette.featherPx, 1);
  });

  it("samples the panel's charcoal from its own centre", () => {
    const w = 40;
    const h = 40;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i += 1) rgba.set([37, 38, 36, 232], i * 4);
    assert.equal(panelCharcoal(rgba, w, h), "#252624");
  });
});

describe("O21 B2 gradient", () => {
  it("runs from the panel charcoal at the top to #1e1e1c at the bottom, never red or coral", () => {
    const g = verticalGradient(2, 100, "#252624", CUTOUT.gradientBottom);
    assert.deepEqual([...g.subarray(0, 3)], [0x25, 0x26, 0x24]);
    assert.deepEqual([...g.subarray(99 * 2 * 3, 99 * 2 * 3 + 3)], [0x1e, 0x1e, 0x1c]);
    assert.ok(!(CUTOUT.forbiddenGrounds as readonly string[]).includes(CUTOUT.gradientBottom));
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

  it("passes when the band shows the ground, fails when it carries the source background", () => {
    const ground = Buffer.alloc(w * h * 3, 37);
    assert.equal(haloShare(ground, 3, inside, w, h, green).share, 0);
    const fringed = Buffer.from(ground);
    for (let y = 8; y < 32; y += 1) for (let x = 8; x < 32; x += 1) if (!inside[y * w + x]) fringed.set([30, 160, 60], (y * w + x) * 3);
    assert.ok(haloShare(fringed, 3, inside, w, h, green).share > CUTOUT.halo.maxShare);
  });

  it("ΔE is CIE76 on Lab", () => {
    assert.equal(deltaE([50, 0, 0], [50, 3, 4]), 5);
  });
});

describe("O21 order and disclosure", () => {
  it("A, then B1, then B2, then skip", () => {
    assert.equal(chooseVariant({ pass: true }, { pass: true }, { pass: true }), "A");
    assert.equal(chooseVariant({ pass: false }, { pass: true }, { pass: true }), "B1");
    assert.equal(chooseVariant({ pass: false }, { pass: false }, { pass: true }), "B2");
    assert.equal(chooseVariant({ pass: false }, { pass: false }, { pass: false }), "skip");
    assert.equal(chooseVariant({ pass: false }, null, null), "skip");
  });

  it("the disclosure strings", () => {
    assert.equal(DISCLOSURE_B1, "artist cut out onto a plain ground, with the artwork's paint as a silhouette");
    assert.equal(DISCLOSURE_B2, "artist cut out onto a plain ground");
    assert.equal(extensionLabel({ top: 542, left: 0, right: 0 }), "photo extended top by 542 px");
  });
});
