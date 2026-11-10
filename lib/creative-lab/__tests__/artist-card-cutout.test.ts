import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CUTOUT,
  DISCLOSURE_B,
  addGrain,
  applyUnifyLab,
  bottomDarken,
  boundUnify,
  chooseUnify,
  chooseVariant,
  composeMatte,
  distanceOutside,
  faceAlphaRule,
  fadeAt,
  grainSigma,
  groundSpec,
  haloShare,
  hairWeight,
  liftCentre,
  liftColourAt,
  localBackground,
  lumaNoise,
  maskEdges,
  nearestInside,
  panelCharcoal,
  planFigure,
  renderGround,
  shadowMap,
  solveForeground,
  spillShare,
  squareFaceCentre,
  squareFigureOffset,
  wrapWeight,
  screen,
  type MaskEdges,
} from "../artist-card-cutout.ts";
import { extensionLabel, gaussianNoise } from "../artist-card.ts";
import { deltaE, labToRgb, parseHex, rgbToLab, smoothstep } from "../colour.ts";

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
    assert.ok(Math.abs(plan.squareCentreX - 0.5) < 1e-6);
  });

  it("a figure ending above the bottom fades and must end in the darkened ground (≥ 0.85 H)", () => {
    const plan = planFigure({ width: 4000, height: 3400 }, face, none);
    assert.ok(!("blocker" in plan));
    if ("blocker" in plan) return;
    assert.ok(plan.figureEnd >= 0.85 * 1920 - 0.5);
    assert.equal(plan.fade, plan.figureEnd < 1919.5);
    const short = planFigure({ width: 4000, height: 3000 }, face, { ...none, bottom: false, lowestRow: 2950 });
    assert.ok("blocker" in short);
    if ("blocker" in short) assert.match(short.blocker, /ends at 0\.\d+ H \(min 0\.85/);
  });

  it("the head is never cut; the photo's top edge never cuts the person; both side cuts are refused", () => {
    assert.match((planFigure(photo, face, { ...none, left: true, headCutLeft: true }) as { blocker: string }).blocker, /cuts the head/);
    assert.ok("blocker" in planFigure(photo, face, { ...none, top: true }));
    assert.match((planFigure(photo, face, { ...none, left: true, right: true }) as { blocker: string }).blocker, /both photo sides/);
  });

  it("side cut: flush on the frame's left, face centre in 0.38–0.62 W of the frame and of the square", () => {
    const plan = planFigure(photo, { ...face, eyeX: 1700, box: { x: 1100, width: 1200 } }, { ...none, left: true });
    assert.ok(!("blocker" in plan));
    if ("blocker" in plan) return;
    assert.equal(plan.rect.left, 0);
    assert.equal(plan.sideCut, "left");
    assert.ok(plan.faceCentreX >= 0.38 && plan.faceCentreX <= 0.62);
    assert.ok(plan.squareCentreX >= 0.38 && plan.squareCentreX <= 0.62);
  });

  it("side cut: refused when the face sits too near the cut side for the square", () => {
    // Face centre ≈ 0.42 W of the frame: inside 0.38–0.62 there, but 0.8 × 0.42 = 0.34 of the square.
    const plan = planFigure(photo, { ...face, eyeX: 1200, box: { x: 600, width: 1200 } }, { ...none, left: true });
    assert.ok("blocker" in plan);
    if ("blocker" in plan) assert.match(plan.blocker, /of the 1:1 outside 0\.38–0\.62/);
  });

  it("maskEdges reads which photo edges the person touches", () => {
    const w = 50;
    const h = 80;
    const alpha = new Float32Array(w * h);
    for (let y = 30; y < h; y += 1) for (let x = 0; x < 20; x += 1) alpha[y * w + x] = 1;
    const e = maskEdges({ width: w, height: h, alpha }, { top: 10, bottom: 25 });
    assert.deepEqual([e.left, e.right, e.bottom, e.top, e.headCutLeft, e.lowestRow], [true, false, true, false, false, 79]);
  });
});

describe("O21 B: the 1:1 side-cut offset", () => {
  it("moves the figure layer out by the re-sit offset so the cut stays flush on the square's side", () => {
    assert.equal(squareFigureOffset(null), 135);
    assert.equal(squareFigureOffset("left"), 0);
    assert.equal(squareFigureOffset("right"), 270);
    // On the square (×0.8): the frame's left edge lands at 108 px centred, 0 with a left cut; the right edge at 972, or 1080 with a right cut.
    assert.equal((0 + squareFigureOffset(null)) * 0.8, 108);
    assert.equal((0 + squareFigureOffset("left")) * 0.8, 0);
    assert.equal((1080 + squareFigureOffset("right")) * 0.8, 1080);
  });

  it("the face centre on the square follows the moved layer; the type keeps its 0.8× positions", () => {
    assert.ok(Math.abs(squareFaceCentre(0.5, null) - 0.5) < 1e-9);
    assert.ok(Math.abs(squareFaceCentre(0.5, "left") - 0.4) < 1e-9);
    assert.ok(Math.abs(squareFaceCentre(0.5, "right") - 0.6) < 1e-9);
    assert.equal(CUTOUT.squareOffset, 108);
  });
});

describe("O21 B: ground", () => {
  it("re-samples the panel's own charcoal", () => {
    const rgba = new Uint8Array(40 * 40 * 4);
    for (let i = 0; i < 1600; i += 1) rgba.set([37, 38, 36, 232], i * 4);
    assert.equal(panelCharcoal(rgba, 40, 40), "#252624");
  });

  it("the lift's centre is the charcoal +8 L* (≈ #454541), its edge #1e1e1c", () => {
    const c = liftCentre("#32322f");
    assert.ok(deltaE(rgbToLab(...parseHex(c)), rgbToLab(...parseHex("#454541"))) < 1.5, c);
    assert.ok(Math.abs(rgbToLab(...parseHex(c))[0] - rgbToLab(...parseHex("#32322f"))[0] - 8) < 0.6);
    const g = groundSpec("lift", 540);
    assert.equal(g.kind, "lift");
    if (g.kind !== "lift") return;
    assert.equal(Math.round(g.radius), 756);
    assert.equal(g.cy, 0.6 * 1920);
    assert.ok(deltaE(rgbToLab(...liftColourAt(g, 0)), rgbToLab(...parseHex(g.centre))) < 0.5);
    assert.ok(deltaE(rgbToLab(...liftColourAt(g, 756)), rgbToLab(...parseHex("#1e1e1c"))) < 0.5);
    assert.ok(deltaE(rgbToLab(...liftColourAt(g, 2000)), rgbToLab(...parseHex("#1e1e1c"))) < 0.5);
  });

  it("the lift falls off smoothly: monotone, no step at the radius (no visible ring)", () => {
    const g = groundSpec("lift", 540);
    if (g.kind !== "lift") return;
    let last = Infinity;
    let maxStep = 0;
    for (let d = 0; d <= 900; d += 1) {
      const L = rgbToLab(...liftColourAt(g, d))[0];
      assert.ok(L <= last + 1e-6);
      if (last !== Infinity) maxStep = Math.max(maxStep, last - L);
      last = L;
    }
    assert.ok(maxStep < 0.05, `largest step ${maxStep} L* per px`);
    assert.ok(rgbToLab(...liftColourAt(g, 755))[0] - rgbToLab(...liftColourAt(g, 757))[0] < 1e-3);
  });

  it("below 0.85 H the ground darkens linearly to 25 % black at the bottom", () => {
    assert.equal(bottomDarken(1000), 1);
    assert.equal(bottomDarken(0.85 * 1920), 1);
    assert.ok(Math.abs(bottomDarken(1920) - 0.75) < 1e-9);
    assert.ok(Math.abs(bottomDarken((0.85 * 1920 + 1920) / 2) - 0.875) < 1e-9);
    const flat = renderGround(groundSpec("flat", 540), 2, 1920);
    assert.deepEqual([...flat.subarray(0, 3)].map(Math.round), [0x32, 0x32, 0x2f]);
    assert.ok(Math.abs(flat[1919 * 2 * 3]! - 0x32 * (1 - 0.25 * (1919 - 1632) / 288)) < 1e-3);
  });
});

describe("O21 B: decontamination and spill", () => {
  it("solves the foreground against the local background", () => {
    const F = [200, 150, 100];
    const B = [20, 160, 40];
    const a = 0.4;
    const I = F.map((f, k) => a * f + (1 - a) * B[k]!);
    const got = solveForeground(I, a, B);
    for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(got[k]! - F[k]!) < 1e-6);
    assert.deepEqual(solveForeground([0, 0, 0], 0.1, [255, 255, 255]), [0, 0, 0]);
  });

  it("the local background is the median of alpha < 0.05 pixels within 24 px", () => {
    const w = 60;
    const h = 60;
    const rgb = new Uint8Array(w * h * 3);
    const a = new Float32Array(w * h);
    const inPhoto = new Uint8Array(w * h).fill(1);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        if (x < 30) {
          a[i] = 1;
          rgb.set([200, 100, 50], i * 3);
        } else rgb.set([10, 120, 30], i * 3);
      }
    }
    const need = new Uint8Array(w * h);
    need[30 * w + 29] = 1;
    const bg = localBackground(rgb, a, inPhoto, w, h, need);
    assert.deepEqual(bg.at(29, 30), [10, 120, 30]);
    assert.equal(bg.at(2, 2), null);
  });

  it("spill: at most 2 % of the inner band within ΔE 12 of the local background", () => {
    const B: [number, number, number] = [40, 140, 60];
    const clean = Array.from({ length: 100 }, () => [200, 160, 130]);
    assert.equal(spillShare(clean, clean.map(() => B)).share, 0);
    const fringed = clean.map((c, i) => (i < 5 ? [42, 138, 61] : c));
    const s = spillShare(fringed, fringed.map(() => B));
    assert.equal(s.share, 0.05);
    assert.ok(s.share > CUTOUT.spill.maxShare);
    assert.equal(spillShare([[1, 2, 3]], [null]).unknown, 1);
  });
});

describe("O21 B: matte", () => {
  it("feathers body edges 1.25 px and hair (the soft region above the chin) 2.5 px", () => {
    const w = 80;
    const h = 80;
    const a = new Float32Array(w * h);
    // Left half solid; the top half's edge is soft over 8 px (hair), the bottom half's is hard (body).
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) a[y * w + x] = y < 40 ? Math.min(1, Math.max(0, (44 - x) / 8)) : x < 40 ? 1 : 0;
    const hair = hairWeight(a, w, h, 40);
    assert.ok(hair[20 * w + 40]! > 0.9);
    assert.equal(hair[60 * w + 40], 0);
    const matte = composeMatte(a, w, h, hair);
    // The 10–90 % width along a row, crossings interpolated between pixel centres.
    const width = (y: number) => {
      const at = (level: number) => {
        for (let x = 0; x < w - 1; x += 1) {
          const p = matte[y * w + x]!;
          const q = matte[y * w + x + 1]!;
          if (p >= level && q < level) return x + (p - level) / (p - q);
        }
        return NaN;
      };
      return at(0.1) - at(0.9);
    };
    assert.ok(width(70) >= 0.8 && width(70) <= 1.6, `body ${width(70)}`);
    assert.ok(width(15) > width(70), `hair ${width(15)} vs body ${width(70)}`);
    assert.ok(CUTOUT.feather.hairPx >= 2 && CUTOUT.feather.hairPx <= 3 && CUTOUT.feather.bodyPx >= 1 && CUTOUT.feather.bodyPx <= 1.5);
  });

  it("the face-alpha share rule: ≥ 99 % at ≥ 0.9 and no pixel below 0.5 in the inner 80 %", () => {
    const w = 100;
    const alpha = new Float32Array(w * w).fill(1);
    const box = { x0: 0, y0: 0, x1: 100, y1: 100 };
    assert.ok(faceAlphaRule(alpha, w, box).pass);
    // A corner of 50 px at 0 (0.5 %): passes the share, outside the inner 80 %.
    for (let y = 0; y < 5; y += 1) for (let x = 0; x < 10; x += 1) alpha[y * w + x] = 0;
    const r = faceAlphaRule(alpha, w, box);
    assert.ok(r.pass && r.share === 0.995 && r.innerMin === 1);
    // One pixel at 0.4 in the inner 80 %: fails.
    alpha[50 * w + 50] = 0.4;
    assert.equal(faceAlphaRule(alpha, w, box).pass, false);
    // 2 % of the box below 0.9 at the edge: fails the share.
    alpha[50 * w + 50] = 1;
    for (let y = 0; y < 20; y += 1) for (let x = 0; x < 10; x += 1) alpha[y * w + x] = 0.8;
    assert.equal(faceAlphaRule(alpha, w, box).pass, false);
  });

  it("nearestInside finds the nearest site; distanceOutside is 0 inside and grows outward", () => {
    const w = 40;
    const inside = new Uint8Array(w * w);
    for (let y = 10; y < 30; y += 1) for (let x = 10; x < 30; x += 1) inside[y * w + x] = 1;
    const d = distanceOutside(inside, w, w);
    assert.equal(d[15 * w + 15], 0);
    assert.equal(d[15 * w + 8], 2);
    assert.equal(nearestInside(inside, w, w).idx[15 * w + 2], 15 * w + 10);
  });
});

describe("O21 B: light wrap and shadow", () => {
  it("light wrap: 25 % at the edge, 0 at 6 px (8 px on hair), scaled by alpha", () => {
    assert.equal(wrapWeight(0, 1, 0), 0.25);
    assert.equal(wrapWeight(6, 1, 0), 0);
    assert.ok(Math.abs(wrapWeight(3, 1, 0) - 0.125) < 1e-9);
    assert.ok(wrapWeight(6, 1, 1) > 0);
    assert.equal(wrapWeight(8, 1, 1), 0);
    assert.equal(wrapWeight(0, 0.5, 0), 0.125);
    assert.equal(screen(100, 0), 100);
    assert.equal(screen(0, 50), 50);
    assert.ok(screen(100, 50) > 100);
  });

  it("the shadow is the alpha 11 px down, blurred (sigma 0.02 W), at 30 %", () => {
    const w = 200;
    const h = 400;
    const alpha = new Float32Array(w * h);
    for (let y = 100; y < 300; y += 1) for (let x = 50; x < 150; x += 1) alpha[y * w + x] = 1;
    const s = shadowMap(alpha, w, h, 1080);
    assert.ok(Math.abs(s[200 * w + 100]! - 0.3) < 0.01);
    // Below the figure's bottom (row 300) the shadow is offset 11 px down: darker 10 px below than 10 px above the same distance from the top edge.
    assert.ok(s[305 * w + 100]! > s[(100 + 11 - 6) * w + 100]!);
    assert.ok(s[50 * w + 100]! < 0.01);
    assert.equal(CUTOUT.shadow.opacity, 0.3);
    assert.equal(Math.round(CUTOUT.shadow.blur * 1080), 43);
    assert.equal(Math.round(CUTOUT.shadow.dy * 1080), 11);
  });
});

describe("O21 B: unify bounds", () => {
  const ground = rgbToLab(...parseHex("#32322f"));

  it("stays inside contrast ±10 %, saturation −15 %…0 and a white-balance shift of ΔE ≤ 4", () => {
    const wild = chooseUnify({ p5L: 60, medianL: 70, medianC: 80, midGreyAB: [20, -20], midGreys: 5000 }, ground);
    assert.equal(wild.contrast, 1.1);
    assert.equal(wild.saturation, 0.85);
    assert.ok(Math.abs(Math.hypot(...wild.wb) - 4) < 1e-9);
    const soft = chooseUnify({ p5L: 5, medianL: 50, medianC: 5, midGreyAB: [ground[1] + 1, ground[2]], midGreys: 5000 }, ground);
    assert.equal(soft.contrast, 0.9);
    assert.equal(soft.saturation, 1);
    assert.ok(Math.abs(soft.wb[0] + 1) < 1e-9 && Math.abs(soft.wb[1]) < 1e-9);
    const few = chooseUnify({ p5L: 20, medianL: 50, medianC: 20, midGreyAB: [5, 5], midGreys: 10 }, ground);
    assert.deepEqual(few.wb, [0, 0]);
  });

  it("scales back so the face box's median colour moves at most ΔE 3; no relighting (pivot on the median)", () => {
    const face = Array.from({ length: 50 }, (_, i) => [55 + (i % 10), 18, 22]);
    const u = { contrast: 1.1, saturation: 0.85, wb: [-3, -2.6] as [number, number] };
    const b = boundUnify(u, face, 50);
    assert.ok(b.faceDeltaE <= 3 + 1e-6);
    assert.ok(b.k < 1 && b.k > 0);
    assert.deepEqual(applyUnifyLab([50, 0, 0], { contrast: 1, saturation: 1, wb: [0, 0] }, 50), [50, 0, 0]);
    assert.equal(applyUnifyLab([50, 10, 10], { contrast: 1.1, saturation: 1, wb: [0, 0] }, 50)[0], 50);
  });
});

describe("O21 B: grain and fade", () => {
  it("measures the photo's luma noise and clamps the grain to 2–5 levels", () => {
    const w = 120;
    const h = 120;
    const noise = gaussianNoise(7);
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i += 1) {
      const v = Math.round(128 + noise() * 3);
      rgb.set([v, v, v], i * 3);
    }
    const m = lumaNoise(rgb, w, h, new Uint8Array(w * h).fill(1));
    assert.ok(m > 2.4 && m < 3.6, `measured ${m}`);
    assert.equal(grainSigma(0.5), 2);
    assert.equal(grainSigma(3.2), 3.2);
    assert.equal(grainSigma(9), 5);
  });

  it("adds one monochrome 1 px layer (the same offset on R, G and B)", () => {
    const rgb = new Float32Array(30 * 3).fill(100);
    addGrain(rgb, 30, 1, 3, 1);
    for (let i = 0; i < 30; i += 1) assert.ok(rgb[i * 3] === rgb[i * 3 + 1] && rgb[i * 3 + 1] === rgb[i * 3 + 2]);
    assert.ok(new Set(Array.from({ length: 30 }, (_, i) => rgb[i * 3])).size > 20);
  });

  it("the bottom fade is a smoothstep over 0.12 H (230 px) ending at the figure's end", () => {
    const end = 1800;
    assert.equal(fadeAt(end, end), 0);
    assert.equal(fadeAt(end - 0.12 * 1920, end), 1);
    assert.equal(fadeAt(100, end), 1);
    assert.ok(Math.abs(fadeAt(end - 0.06 * 1920, end) - 0.5) < 1e-9);
    assert.ok(Math.abs(fadeAt(end - 0.03 * 1920, end) - smoothstep(0.25)) < 1e-9);
    assert.equal(Math.round(CUTOUT.fadeBand * 1920), 230);
  });
});

describe("O21 halo, order and disclosure", () => {
  it("halo passes on the ground, fails when the band carries the source background", () => {
    const w = 40;
    const inside = new Uint8Array(w * w);
    for (let y = 10; y < 30; y += 1) for (let x = 10; x < 30; x += 1) inside[y * w + x] = 1;
    const green = rgbToLab(30, 160, 60);
    const ground = Buffer.alloc(w * w * 3, 37);
    assert.equal(haloShare(ground, 3, inside, w, w, green).share, 0);
    const fringed = Buffer.from(ground);
    for (let y = 8; y < 32; y += 1) for (let x = 8; x < 32; x += 1) if (!inside[y * w + x]) fringed.set([30, 160, 60], (y * w + x) * 3);
    assert.ok(haloShare(fringed, 3, inside, w, w, green).share > CUTOUT.halo.maxShare);
  });

  it("A, then B, then skip", () => {
    assert.equal(chooseVariant({ pass: true }, { pass: true }), "A");
    assert.equal(chooseVariant({ pass: false }, { pass: true }), "B");
    assert.equal(chooseVariant({ pass: false }, { pass: false }), "skip");
    assert.equal(chooseVariant({ pass: false }, null), "skip");
  });

  it("the disclosure line, and Lab round-trips", () => {
    assert.equal(DISCLOSURE_B, "artist cut out onto a plain ground");
    assert.equal(extensionLabel({ top: 542, left: 0, right: 0 }), "photo extended top by 542 px");
    const back = labToRgb(...rgbToLab(50, 50, 47));
    assert.ok(back.every((v, k) => Math.abs(v - [50, 50, 47][k]!) < 0.5));
    assert.ok(!(CUTOUT.forbiddenGrounds as readonly string[]).includes(CUTOUT.ground.charcoal));
  });
});
