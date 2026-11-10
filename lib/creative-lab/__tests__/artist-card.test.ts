import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eyesMeasurable } from "../face-detect.ts";
import { maskTouches } from "../segment.ts";
import {
  MASTER,
  NO_EXTENSION,
  O20,
  SAFE,
  SLOTS,
  cardFileName,
  cardFolderKey,
  checkLayout,
  extendCanvas,
  extensionCandidates,
  extensionLabel,
  judgePhoto,
  layoutText,
  lowContrastShare,
  measureHeadTop,
  pieceScale,
  planFaceCrop,
  relativeLuminance,
  seamP95,
  stripColourTests,
  stripStats,
  textBoxRect,
  type CropPlan,
  type Piece,
} from "../artist-card.ts";

function piece(label: string, width: number, height: number, capPx = height): Piece {
  return { label, width, height, capPx, png: Buffer.alloc(0) };
}

/** The P26-BDAY STATIC pieces' ink sizes. */
const LOCKUP = piece("lockup", 1851, 558);
const ENZO = piece("ENZO SIRAGUSA", 2071, 476);
const LUKE = piece("LUKE DEAN", 1388, 469);
const INFO = [piece("CIRCUIT > SOUTHAMPTON", 1201, 183), piece("SUNDAY 27TH DECEMBER", 1206, 182), piece("1PM > 9:30PM", 602, 180)];

describe("slot table (fix round 1)", () => {
  it("SAFE is the 4:5 band with 76 px insets, 361–1559 (0.812 H)", () => {
    assert.deepEqual(SAFE, { top: 361, bottom: 1559 });
    assert.equal(Math.round(0.812 * 1920), SAFE.bottom);
  });

  it("lockup 0.28 W at y 361; name 28 px under it at cap 220; info 36 px under the name, cap 60, pitch 83", () => {
    const layout = layoutText({ lockup: LOCKUP, name: LUKE, info: INFO });
    assert.equal(layout.lockup!.width, 302);
    assert.equal(layout.claim.text, null);
    assert.equal(layout.lockup!.top, 361);
    assert.equal(layout.lockup!.left, Math.round((1080 - 302) / 2));
    assert.equal(layout.name.top, layout.lockup!.top + layout.lockup!.height + 28);
    assert.equal(layout.name.height, 220);
    assert.equal(layout.name.stepped, false);
    const firstCapTop = layout.name.top + layout.name.height + 36;
    // Each info line sits on its cap line: the tallest cap is 60 px, the pitch 83.
    const baselines = layout.info.map((p) => p.top + p.height);
    assert.ok(Math.abs(baselines[0]! - (firstCapTop + 0.031 * 1920)) <= 1);
    assert.ok(Math.abs(baselines[1]! - baselines[0]! - 0.043 * 1920) <= 1);
    assert.ok(Math.abs(baselines[2]! - baselines[1]! - 0.043 * 1920) <= 1);
    const check = checkLayout(layout);
    assert.equal(check.insideSafe, true);
    assert.equal(check.insideTextBox, true);
    assert.ok(layout.block.top + layout.block.height <= 0.512 * 1920);
  });

  it("a long name steps down to 0.80 W and stays above the floor", () => {
    const layout = layoutText({ lockup: LOCKUP, name: ENZO, info: INFO });
    assert.equal(layout.name.width, 864);
    assert.equal(layout.name.stepped, true);
    assert.equal(layout.name.belowFloor, false);
  });

  it("pieceScale never enlarges and flags the floor", () => {
    assert.deepEqual(pieceScale({ width: 300, capPx: 100 }, SLOTS.name), { scale: 1, short: true, stepped: false, belowFloor: false });
    assert.equal(pieceScale({ width: 4000, capPx: 250 }, SLOTS.name).belowFloor, true);
  });
});

describe("planFaceCrop", () => {
  it("puts the head, eyes and chin in their bands as large as they allow", () => {
    // 4000×6000 portrait, head top 2800, eyes 3200, chin 3600: plenty of photo above.
    const plan = planFaceCrop({ width: 4000, height: 6000 }, { eyeX: 2000, eyeY: 3200, headTopY: 2800, chinY: 3600 });
    assert.ok(plan.headTop >= 0.53 - 1e-3);
    assert.ok(plan.eyes >= 0.58 - 1e-3 && plan.eyes <= 0.64 + 1e-3);
    assert.ok(plan.chin <= 0.76 + 1e-3);
    assert.ok(plan.scale <= 1);
    assert.deepEqual(plan.extend, NO_EXTENSION);
    assert.equal(plan.clamped.y, false);
    // Largest: one of the two bands is met exactly.
    assert.ok(Math.abs(plan.headTop - 0.53) < 2e-3 || Math.abs(plan.chin - 0.76) < 2e-3);
  });

  it("never upscales: a small photo stays at 1.0× even when the bands would allow more", () => {
    const plan = planFaceCrop({ width: 1080, height: 1920 }, { eyeX: 540, eyeY: 1180, headTopY: 1120, chinY: 1240 });
    assert.equal(plan.scale, 1);
  });

  it("never extends: a face too high stays too high in planFaceCrop", () => {
    const plan = planFaceCrop({ width: 5486, height: 3657 }, { eyeX: 3000, eyeY: 1300, headTopY: 880, chinY: 1700 });
    assert.ok(plan.eyes < 0.58);
    assert.deepEqual(plan.extend, NO_EXTENSION);
  });
});

describe("O20 strip tests", () => {
  const w = 300;
  const h = 48;
  it("a smooth gradient passes", () => {
    const lum = new Float64Array(w * h).map((_, i) => 60 + ((i % w) / w) * 40);
    const st = stripStats(lum, w, h);
    assert.ok(st.detailStdev <= 4, `detail ${st.detailStdev}`);
    assert.ok(st.sobelShare <= 0.02, `sobel ${st.sobelShare}`);
    assert.equal(st.pass, true);
  });

  it("texture fails", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const lum = new Float64Array(w * h).map(() => 60 + rand() * 160);
    const st = stripStats(lum, w, h);
    assert.ok(st.detailStdev > 4);
    assert.ok(st.sobelShare > 0.02);
    assert.equal(st.pass, false);
  });

  it("normalised Sobel (÷ 8): photo grain passes", () => {
    // ±3 levels of noise on a flat wall: raw 3×3 magnitudes reach ~20, normalised ones stay near 2.
    let seed = 11;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const lum = new Float64Array(w * h).map(() => 100 + (rand() - 0.5) * 6);
    const st = stripStats(lum, w, h);
    assert.equal(st.sobelShare, 0);
    assert.equal(st.pass, true);
  });

  it("normalised Sobel: a hard line fails", () => {
    // A 4 px bright line every 24 columns: steps of 160 levels, far over 20 per pixel.
    const lum = new Float64Array(w * h).map((_, i) => ((i % w) % 24 < 4 ? 220 : 60));
    const st = stripStats(lum, w, h);
    assert.ok(st.sobelShare > 0.02, `sobel ${st.sobelShare}`);
    assert.equal(st.pass, false);
  });
});

describe("O20 colour tests (round 4, CIELAB)", () => {
  const length = 300;
  const depth = 48;
  /** RGB strip laid out (d × length + i) × 3, d = 0 at the photo's outer edge. */
  const strip = (colour: (i: number, d: number) => [number, number, number]) => {
    const out = new Uint8Array(length * depth * 3);
    for (let d = 0; d < depth; d += 1) for (let i = 0; i < length; i += 1) out.set(colour(i, d), (d * length + i) * 3);
    return out;
  };

  it("a smooth gradient passes (a) and (b)", () => {
    const t = stripColourTests(strip((i) => [60 + Math.round((i / length) * 30), 80, 70]), length, depth);
    assert.ok(t.columnMaxDeltaE <= 3, `a ${t.columnMaxDeltaE}`);
    assert.ok(t.driftP95 <= 3, `b ${t.driftP95}`);
  });

  it("streaky foliage fails (a): colour bands along the strip", () => {
    const t = stripColourTests(strip((i) => (Math.floor(i / 20) % 2 ? [40, 90, 40] : [140, 170, 90])), length, depth);
    assert.ok(t.columnMaxDeltaE > 3, `a ${t.columnMaxDeltaE}`);
    assert.equal(t.passColumn, false);
  });

  it("colour that changes from the edge inward fails (b)", () => {
    const t = stripColourTests(strip((_, d) => (d < 24 ? [90, 120, 80] : [40, 70, 50])), length, depth);
    assert.ok(t.driftP95 > 3, `b ${t.driftP95}`);
    assert.equal(t.passDrift, false);
  });

  it("(c) a hard join fails; a smooth one passes", () => {
    const w = 100;
    const h = 60;
    const hard = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) hard.set(y < 30 ? [60, 60, 60] : [110, 110, 110], (y * w + x) * 3);
    assert.ok(seamP95(hard, w, h, 3, { edge: "top", at: 30, from: 0, to: w }) > 2);
    const smooth = new Uint8Array(w * h * 3).fill(80);
    assert.ok(seamP95(smooth, w, h, 3, { edge: "top", at: 30, from: 0, to: w }) <= 2);
    const side = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) side.set(x < 50 ? [60, 60, 60] : [110, 110, 110], (y * w + x) * 3);
    assert.ok(seamP95(side, w, h, 3, { edge: "left", at: 50, from: 0, to: h }) > 2);
  });
});

describe("O20 person mask in a strip", () => {
  it("any mask pixel above 0.5 inside the strip's source rectangle is counted", () => {
    const mask = { width: 100, height: 60, alpha: new Float32Array(100 * 60) };
    // The person's hair reaches row 2 at columns 40–49.
    for (let y = 2; y < 60; y += 1) for (let x = 40; x < 50; x += 1) mask.alpha[y * 100 + x] = 0.9;
    assert.equal(maskTouches(mask, { left: 0, top: 0, width: 100, height: 10 }), 80);
    assert.equal(maskTouches(mask, { left: 0, top: 0, width: 30, height: 60 }), 0);
    assert.equal(maskTouches(mask, { left: 0, top: 0, width: 100, height: 2 }), 0);
  });
});

describe("O20 extension candidates", () => {
  // 4000×2667 landscape; face high up: eyes at 1000, head top 750, chin 1250, face box 700 px wide.
  const photo = { width: 4000, height: 2667 };
  const face = { eyeX: 2000, eyeY: 1000, headTopY: 750, chinY: 1250, box: { width: 700 } };

  it("extends the top within 0.30 H and keeps the head 48 px + 0.05 H under the strip", () => {
    const list = extensionCandidates(photo, face);
    assert.ok(list.length > 0);
    assert.ok(list[0]!.extend.top > 0);
    for (const c of list) {
      assert.ok(c.extend.top <= O20.maxTop);
      assert.ok(c.extend.left <= O20.maxSide && c.extend.right <= O20.maxSide);
      if (c.extend.top > 0) assert.ok(face.headTopY * c.scale >= O20.strip + O20.headGap * 1920 - 1e-6);
      assert.ok(c.scale <= 1);
      assert.ok(c.faceWidthPx >= O20.minFaceWidth * 1080 - 1e-6);
      assert.ok(c.headTop >= 0.53 - 1e-6 && c.chin <= 0.76 + 1e-6 && c.eyes >= 0.58 - 1e-6 && c.eyes <= 0.64 + 1e-6);
    }
  });

  it("never extends the bottom: a face too low has no candidate", () => {
    const why = { blocker: "" };
    const list = extensionCandidates({ width: 4000, height: 2667 }, { eyeX: 2000, eyeY: 2500, headTopY: 2300, chinY: 2620, box: { width: 600 } }, MASTER, why);
    assert.equal(list.length, 0);
    assert.match(why.blocker, /bottom/);
  });

  it("refuses a top extension past 0.30 H", () => {
    const why = { blocker: "" };
    // A tiny photo strip with the face at its very top: the top would need far more than 576 px.
    const list = extensionCandidates({ width: 6000, height: 1400 }, { eyeX: 3000, eyeY: 200, headTopY: 120, chinY: 280, box: { width: 300 } }, MASTER, why);
    assert.equal(list.length, 0);
    assert.ok(why.blocker.length > 0);
  });

  it("refuses when the head's top is too close to the top strip", () => {
    const why = { blocker: "" };
    // Head top 20 px from the photo's top edge: never 48 px + 0.05 H below the strip at any allowed scale.
    const list = extensionCandidates({ width: 4000, height: 2667 }, { eyeX: 2000, eyeY: 220, headTopY: 20, chinY: 420, box: { width: 520 } }, MASTER, why);
    assert.equal(list.length, 0);
    assert.match(why.blocker, /head's top|top would need/);
  });

  it("O19 amended: the floor is 0.20 W (216 px)", () => {
    assert.equal(O20.minFaceWidth * 1080, 216);
  });

  it("refuses a face box under 0.20 W at the largest size the bands allow", () => {
    const why = { blocker: "" };
    const list = extensionCandidates(photo, { ...face, box: { width: 200 } }, MASTER, why);
    assert.equal(list.length, 0);
    assert.match(why.blocker, /face box is \d+ px wide/);
  });

  it("orders no extension first, then the larger face", () => {
    const list = extensionCandidates({ width: 4000, height: 6000 }, { eyeX: 2000, eyeY: 3200, headTopY: 2800, chinY: 3600, box: { width: 600 } });
    const total = (c: (typeof list)[number]) => c.extend.top + c.extend.left + c.extend.right;
    assert.equal(total(list[0]!), 0);
  });

  it("labels the disclosure string", () => {
    assert.equal(extensionLabel(NO_EXTENSION), "");
    assert.equal(extensionLabel({ top: 319, left: 0, right: 0 }), "photo extended top by 319 px");
    assert.equal(extensionLabel({ top: 0, left: 40, right: 40 }), "photo extended sides by 40 px");
    assert.equal(extensionLabel({ top: 300, left: 40, right: 12 }), "photo extended top by 300 px and sides by 40 px (left) / 12 px (right)");
    assert.equal(extensionLabel({ top: 488, left: 0, right: 46 }), "photo extended top by 488 px and right side by 46 px");
  });
});

describe("O20 fill", () => {
  it("extends top and sides from the strip's own colours, never the bottom", () => {
    // Blue top half, red bottom half; the fill is blurred along the edge (σ 32 px), so
    // the side fill is checked well past that reach of the colour change.
    const w = 60;
    const h = 400;
    const rgb = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) rgb.set(y < 200 ? [10, 20, 200] : [250, 0, 0], (y * w + x) * 3);
    const out = extendCanvas(rgb, w, h, { top: 30, left: 10, right: 5 }, { top: 0, left: 0, right: 0 });
    assert.equal(out.width, 75);
    assert.equal(out.height, 430);
    const at = (x: number, y: number) => [...out.data.subarray((y * out.width + x) * 3, (y * out.width + x) * 3 + 3)];
    // Top fill = the top strip's colour (blue), never the red lower half.
    assert.deepEqual(at(40, 0), [10, 20, 200]);
    // The photo sits at (10, 30) unchanged.
    assert.deepEqual(at(10, 30), [10, 20, 200]);
    assert.deepEqual(at(10, 429), [250, 0, 0]);
    // The side fill beside the red rows is the strip's own red; nothing below the photo.
    assert.deepEqual(at(0, 429), [250, 0, 0]);
    assert.deepEqual(at(74, 429), [250, 0, 0]);
  });

  it("adds grain at the measured strength, seeded", () => {
    const rgb = new Uint8Array(20 * 20 * 3).fill(128);
    const a = extendCanvas(rgb, 20, 20, { top: 20, left: 0, right: 0 }, { top: 3, left: 0, right: 0 }, 5);
    const b = extendCanvas(rgb, 20, 20, { top: 20, left: 0, right: 0 }, { top: 3, left: 0, right: 0 }, 5);
    assert.deepEqual(a.data, b.data);
    const fill = [...a.data.subarray(0, 20 * 20 * 3)];
    const mean = fill.reduce((s, v) => s + v, 0) / fill.length;
    const sd = Math.sqrt(fill.reduce((s, v) => s + (v - mean) ** 2, 0) / fill.length);
    assert.ok(sd > 1.5 && sd < 4.5, `grain ${sd}`);
  });
});

describe("O20 eyes measurable", () => {
  const base = { box: { x: 0, y: 0, width: 100, height: 120, score: 0.9 }, leftEye: { x: 30, y: 50 }, rightEye: { x: 70, y: 50 }, browY: 35, chinY: 115 };
  it("passes a confident face with both eyes", () => {
    assert.equal(eyesMeasurable(base).ok, true);
  });
  it("fails a low-confidence face (Enzo 46 was 0.18)", () => {
    assert.equal(eyesMeasurable({ ...base, box: { ...base.box, score: 0.18 } }).ok, false);
  });
  it("fails a profile where both eye centroids collapse together", () => {
    assert.equal(eyesMeasurable({ ...base, rightEye: { x: 36, y: 50 } }).ok, false);
  });
});

describe("measureHeadTop", () => {
  it("finds where the backdrop takes over above the brows", () => {
    // 100×200 RGB: grey backdrop, a dark head from row 80 to 160 in columns 30–70.
    const w = 100;
    const h = 200;
    const rgb = new Uint8Array(w * h * 3).fill(120);
    for (let y = 80; y < 160; y += 1) for (let x = 30; x < 70; x += 1) rgb.fill(20, (y * w + x) * 3, (y * w + x) * 3 + 3);
    assert.equal(measureHeadTop(rgb, w, h, 3, { eyeX: 50, browY: 110, chinY: 160, box: { width: 40 } }), 80);
  });

  it("refuses a measurement outside 0.25–1.0 × (chin − brow)", () => {
    const rgb = new Uint8Array(100 * 200 * 3).fill(120);
    assert.equal(measureHeadTop(rgb, 100, 200, 3, { eyeX: 50, browY: 110, chinY: 160, box: { width: 40 } }), null);
  });
});

describe("photo rules", () => {
  it("contrast with white: relative luminance above 0.30 is below 3:1", () => {
    assert.ok(Math.abs(relativeLuminance(255, 255, 255) - 1) < 1e-9);
    assert.equal(relativeLuminance(0, 0, 0), 0);
    for (const v of [100, 140, 150, 160, 200]) {
      const L = relativeLuminance(v, v, v);
      assert.equal(1.05 / (L + 0.05) < 3, L > 0.3);
    }
  });

  it("lowContrastShare counts the bright pixels in a rect", () => {
    const w = 10;
    const data = new Uint8Array(w * 10 * 3);
    data.fill(255, 0, 20 * 3); // rows 0–1 white
    assert.equal(lowContrastShare(data, w, 3, { left: 0, top: 0, width: 10, height: 10 }), 0.2);
    assert.equal(lowContrastShare(data, w, 3, { left: 0, top: 2, width: 10, height: 8 }), 0);
  });

  it("the text box is 0.188–0.512 H inside the side insets", () => {
    const r = textBoxRect();
    assert.equal(r.left, 76);
    assert.equal(r.width, 1080 - 152);
    assert.ok(Math.abs(r.top - 0.188 * 1920) < 1e-9);
    assert.ok(Math.abs(r.top + r.height - 0.512 * 1920) < 1e-9);
  });

  const good: CropPlan = { scale: 0.5, left: 0, top: 0, headTop: 0.54, eyes: 0.61, chin: 0.74, clamped: { x: false, y: false }, extend: NO_EXTENSION, faceWidthPx: 300 };

  it("passes a photo inside every rule", () => {
    assert.ok(judgePhoto({ contrastShare: 0.05, subjects: 1, plan: good }).every((r) => r.pass));
  });

  it("fails each rule on its own", () => {
    const failed = (input: Parameters<typeof judgePhoto>[0]) => judgePhoto(input).filter((r) => !r.pass).map((r) => r.rule);
    assert.deepEqual(failed({ contrastShare: 0.101, subjects: 1, plan: good }), ["contrast"]);
    assert.deepEqual(failed({ contrastShare: 0, subjects: 2, plan: good }), ["subject"]);
    assert.deepEqual(failed({ contrastShare: 0, subjects: 1, plan: { ...good, scale: 1.2 } }), ["scale"]);
    assert.deepEqual(failed({ contrastShare: 0, subjects: 1, plan: { ...good, headTop: 0.5 } }), ["face"]);
    assert.deepEqual(failed({ contrastShare: 0, subjects: 1, plan: { ...good, eyes: 0.66 } }), ["face"]);
    assert.deepEqual(failed({ contrastShare: 0, subjects: 1, plan: { ...good, chin: 0.78 } }), ["face"]);
    assert.deepEqual(failed({ contrastShare: 0, subjects: 1, plan: { ...good, faceWidthPx: 215 } }), ["face"]);
    assert.ok(judgePhoto({ contrastShare: 0, subjects: 1, plan: { ...good, faceWidthPx: 216 } }).every((r) => r.pass));
    assert.deepEqual(failed({ contrastShare: 0, subjects: 1, plan: good, eyes: { ok: false, why: "face confidence 0.18 < 0.5" } }), ["eyes"]);
    assert.deepEqual(failed({ contrastShare: 0, subjects: 0, plan: null }), ["subject", "face"]);
  });
});

describe("routing and names", () => {
  const helpers = { cycleKeyFor: () => "03/3/wc/2026-11-09", showWeekMonday: (d: string | null) => (d ? "2026-12-21" : null) };
  it("on sale → the cycle's Content; presale → Presale live; show week → 4 Show week", () => {
    assert.equal(cardFolderKey({ stage: "on-sale", today: "2026-11-09", eventDate: "2026-12-27", ...helpers }), "03/3/wc/2026-11-09/content");
    assert.equal(cardFolderKey({ stage: "presale", today: "2026-11-09", eventDate: "2026-12-27", ...helpers }), "03/2/presale-live");
    assert.equal(cardFolderKey({ stage: "on-sale", today: "2026-12-22", eventDate: "2026-12-27", ...helpers }), "03/4");
  });

  it("file names carry the format and the version", () => {
    assert.equal(cardFileName({ eventCode: "P26-BDAY", artistSlug: "enzo-siragusa", pick: 1, stage: "on-sale", format: "9x16" }), "P26-BDAY_enzo-siragusa_artist-card-1_on-sale_9x16.png");
    assert.equal(cardFileName({ eventCode: "P26-BDAY", artistSlug: "luke-dean", pick: 2, stage: "on-sale", format: "1x1", version: 3 }), "P26-BDAY_luke-dean_artist-card-2_on-sale_1x1_v3.png");
  });
});
