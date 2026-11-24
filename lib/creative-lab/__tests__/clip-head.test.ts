import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { CLIP_HEAD, HEAD_REFUSAL, framedLine, headFromMask, headOf, medianHeadX, natural916, planHeadCrop, squareTiles, toOutput } from "../clip-head.ts";
import { SELFIE_DIR, modelDir } from "../segment.ts";
import { judgeFaceOverTime } from "../t1-face.ts";
import { planClipLayout, clipBands, footageWindow, upscaleFactor, type VideoClaimPlan } from "../t1-video.ts";
import { bandAlphaAt } from "../overlay-gradient.ts";
import type { Piece } from "../artist-card.ts";

describe("O120 strings (overlay-templates issue 17), exact", () => {
  it("the render row and the refusal", () => {
    assert.equal(framedLine(97, "left"), "Framed on the artist: crop moved 97 px left");
    assert.equal(framedLine(12, "right"), "Framed on the artist: crop moved 12 px right");
    assert.equal(HEAD_REFUSAL, "The artist's head is where the text goes — choose another clip");
  });
});

describe("headFromMask: the largest person's top 0.18", () => {
  const grid = (w: number, h: number, rects: { x: number; y: number; w: number; h: number }[]) => {
    const a = new Float32Array(w * h);
    for (const r of rects) for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) a[y * w + x] = 1;
    return a;
  };
  it("takes the largest part and its top 0.18 of height, as wide as that part is there", () => {
    // A person 100 tall (head 30 wide on top of a 60-wide body) and a smaller one at the side.
    const a = grid(200, 200, [
      { x: 85, y: 50, w: 30, h: 25 },
      { x: 70, y: 75, w: 60, h: 75 },
      { x: 5, y: 120, w: 20, h: 40 },
    ]);
    const head = headFromMask(a, 200, 200)!;
    assert.deepEqual(head, { left: 85, top: 50, width: 30, height: 18 });
  });
  it("null when nothing reaches 1 % of the frame", () => {
    assert.equal(headFromMask(grid(100, 100, [{ x: 0, y: 0, w: 9, h: 9 }]), 100, 100), null);
    assert.equal(headFromMask(new Float32Array(100), 10, 10), null);
    assert.equal(CLIP_HEAD.maskTop, 0.18);
  });
});

describe("squareTiles: the segmenter reads squares at the frame's short side", () => {
  it("three down a 9:16, three across a 16:9, one for a square", () => {
    assert.deepEqual(squareTiles({ width: 1080, height: 1920 }), [
      { left: 0, top: 0, width: 1080, height: 1080 },
      { left: 0, top: 420, width: 1080, height: 1080 },
      { left: 0, top: 840, width: 1080, height: 1080 },
    ]);
    assert.equal(squareTiles({ width: 1920, height: 1080 }).length, 3);
    assert.deepEqual(squareTiles({ width: 640, height: 640 }), [{ left: 0, top: 0, width: 640, height: 640 }]);
  });
});

describe("the head on a sample and its median", () => {
  it("the widest face wins; the mask's head only when no face", () => {
    const face = { left: 10, top: 10, width: 50, height: 60 };
    const small = { left: 200, top: 10, width: 20, height: 20 };
    const mask = { left: 400, top: 0, width: 80, height: 40 };
    assert.deepEqual(headOf({ tS: 0, faces: [small, face], maskHead: mask }), face);
    assert.deepEqual(headOf({ tS: 0, faces: [], maskHead: mask }), mask);
    assert.equal(headOf({ tS: 0, faces: [] }), null);
  });
  it("the median: where the head spends the most time", () => {
    const at = (cx: number) => ({ tS: 0, faces: [], maskHead: { left: cx - 10, top: 0, width: 20, height: 20 } });
    assert.equal(medianHeadX([at(400), at(450), at(780), at(445), { tS: 0, faces: [] }]), (445 + 450) / 2);
    assert.equal(medianHeadX([at(400), at(780), at(445)]), 445);
    assert.equal(medianHeadX([{ tS: 0, faces: [] }]), null);
  });
});

describe("planHeadCrop (O120 with O63)", () => {
  const src = { width: 1080, height: 1920 };
  it("AF-C: the head at 0.41 W moves the crop 97 px left; the window narrows to 886 px (1.22×)", () => {
    const c = planHeadCrop(src, 0.41 * 1080, { cropFocusX: 0.5, cropFocusY: 0.5 });
    assert.equal(c.movedPx, 97);
    assert.equal(c.side, "left");
    assert.equal(c.line, "Framed on the artist: crop moved 97 px left");
    assert.ok(Math.abs(c.cropWidth - 885.6) < 1e-6);
    assert.ok(Math.abs(c.headAt! - 0.5) < 1e-9);
    assert.equal((1080 / c.cropWidth).toFixed(2), "1.22");
    // The window the composition draws is this one.
    const w = footageWindow(src, "9:16", 0.5, c.cropFocusX, c.cropWidth);
    assert.ok(Math.abs(w.left - c.window.left) < 1e-6 && Math.abs(w.width - c.window.width) < 1e-6 && Math.abs(w.top - c.window.top) < 1e-6);
    assert.equal(upscaleFactor(src, "9:16", 0.5, c.cropFocusX, c.cropWidth).toFixed(2), "1.22");
  });
  it("within 0.05 W of centre it stays", () => {
    const c = planHeadCrop(src, 0.5 * 1080 + 0.05 * 1080, { cropFocusX: 0.5, cropFocusY: 0.5 });
    assert.equal(c.movedPx, 0);
    assert.equal(c.line, null);
    assert.equal(c.cropWidth, 1080);
    assert.equal(planHeadCrop(src, null, { cropFocusX: 0.5, cropFocusY: 0.5 }).line, null);
  });
  it("near a side: never under 675 px (1.6×); the head lands as near the centre as the footage allows", () => {
    const c = planHeadCrop(src, 100, { cropFocusX: 0.5, cropFocusY: 0.5 });
    assert.equal(c.cropWidth, CLIP_HEAD.minWindowPx);
    assert.equal(c.window.left, 0);
    assert.ok(c.headAt! < 0.5);
    assert.equal(c.side, "left");
    assert.ok(1080 / c.cropWidth <= 1.6 + 1e-9);
  });
  it("a landscape source slides its 9:16 sideways without narrowing", () => {
    const land = { width: 3840, height: 2160 };
    const nat = natural916(land);
    const c = planHeadCrop(land, 1200, { cropFocusX: 0.5, cropFocusY: 0.5 });
    assert.ok(Math.abs(c.cropWidth - nat.width) < 1e-9);
    assert.ok(Math.abs(c.headAt! - 0.5) < 1e-9);
    assert.equal(c.side, "left");
  });
  it("toOutput maps source px into the window's output", () => {
    assert.deepEqual(toOutput({ left: 540, top: 960, width: 108, height: 108 }, { left: 0, top: 0, width: 1080, height: 1920 }), { left: 540, top: 960, width: 108, height: 108 });
  });
});

describe("the claim moves up under the date (O120, AF-C)", () => {
  const piece = (w: number, h: number, label: string): Piece => ({ png: Buffer.alloc(0), width: w, height: h, capPx: h, label });
  const date = piece(700, 60, "date");
  const claim: VideoClaimPlan = {
    step: 1,
    lines: [
      { text: "EARLY BIRD SOLD OUT", approvedText: "Early bird sold out", color: "red", capPx: 48, capTop: 1238 - 77 - 22 - 48, widthPx: 600 },
      { text: "SELLING FAST", approvedText: "Selling fast", color: "white", capPx: 77, capTop: 1238 - 77, widthPx: 700 },
    ],
    dropped: [],
    blockTop: 1238 - 77 - 22 - 48,
    bottom: 1238,
    widest: 700,
  };
  const input = { lockup: piece(270, 80, "lockup"), name: piece(800, 134, "name"), date, claim };
  it("A on its baseline, then A with the claim one date pitch under the date line", () => {
    const base = planClipLayout(input, "9:16", "A");
    const up = planClipLayout(input, "9:16", "A", { claimUp: true });
    assert.equal(base.claimUp, false);
    assert.equal(up.claimUp, true);
    const dateCap = date.capPx * up.pieces.date.at.scale;
    const dateBaseline = up.pieces.date.at.top + dateCap;
    assert.ok(Math.abs(up.boxes.claim!.top - (dateBaseline + dateCap)) < 1e-6);
    assert.ok(Math.abs(up.boxes.claim!.top / 1920 - 0.388) < 0.002, `${up.boxes.claim!.top / 1920}`);
    assert.ok(Math.abs(up.boxes.claim!.height - base.boxes.claim!.height) < 1e-6);
    // The top band runs to the claim's last baseline; nothing is left at the bottom, so no bottom band.
    const bands = clipBands(up);
    for (const y of [1500, 1800, 1919]) assert.equal(bandAlphaAt(bands.bands[1]!, y, 1920), 0);
    assert.ok(bandAlphaAt(bands.bands[0]!, Math.round(up.boxes.claim!.top + up.boxes.claim!.height), 1920) > 0.19);
    // B never takes the move: its date sits on the claim.
    assert.equal(planClipLayout(input, "9:16", "B", { claimUp: true }).claimUp, false);
  });
  it("the head (no face) on the claim fails O39 on its baseline and passes with the claim up", () => {
    const head = toOutput({ left: 0.5 * 1080 - 105, top: 0.537 * 1920, width: 210, height: 0.14 * 1920 }, { left: 0, top: 0, width: 1080, height: 1920 });
    const samples = [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25].map((tS) => ({ tS, faces: [], heads: [head] }));
    const base = planClipLayout(input, "9:16", "A");
    const up = planClipLayout(input, "9:16", "A", { claimUp: true });
    assert.equal(judgeFaceOverTime(samples, { always: [base.boxes.top], claim: base.boxes.claim }).ok, false);
    assert.equal(judgeFaceOverTime(samples, { always: [up.boxes.top], claim: up.boxes.claim }).ok, true);
    // Without heads, the face judge alone sees nothing: the back of a head passed O39 before issue 17.
    assert.equal(judgeFaceOverTime(samples.map((s) => ({ tS: s.tS, faces: [] })), { always: [base.boxes.top], claim: base.boxes.claim }).ok, true);
  });
});

describe("the person-outline model loads the way face-api does (#1304)", () => {
  it("the traced copy under the working directory wins; else this file's folder", () => {
    const seen: string[] = [];
    assert.equal(modelDir("/var/task", (p) => (seen.push(p), true)), join("/var/task", SELFIE_DIR));
    assert.equal(seen[0], join("/var/task", SELFIE_DIR, "selfie.json"));
    assert.match(modelDir("/nowhere", () => false), /lib[/\\]creative-lab[/\\]models[/\\]selfie$/);
  });
});
