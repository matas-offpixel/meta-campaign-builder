import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { Piece } from "../artist-card.ts";
import { TOO_SMALL_FOR_916 } from "../import-quality.ts";
import { judgeFaceOverTime, planClipLayout, planVideoClaim, type VideoClaimPlan } from "../t1-video.ts";
import {
  SEAM_ZONES,
  TF_LINES,
  TRIPLE_FIT,
  clipKind,
  facesInPart,
  groupOf,
  importRefusal,
  offerTripleFit,
  partCropCandidates,
  partFaceBoxes,
  partOf,
  partPlacements,
  partScale,
  partWindow,
  seamChecks,
  tripleFitChannels,
  tripleFitLength,
  tripleFitSound,
  tripleFitTypeChecks,
  tripleFitUpscale,
} from "../triple-fit.ts";

const measure = (t: string, cap: number) => t.length * 0.35 * cap;
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const piece = (w: number, h: number, cap: number, label: string): Piece => ({ png: Buffer.alloc(0), width: w, height: h, capPx: cap, label });
const roll = planVideoClaim("Early bird, 1st & 2nd release sold out\n3rd release selling fast", measure) as VideoClaimPlan;
const pieces = (claim: VideoClaimPlan | null) => ({ lockup: piece(1290, 388, 0, "lockup"), name: piece(1000, 220, 220, "name"), date: piece(800, 60, 60, "date"), claim });
const LUKE_15 = { width: 1920, height: 1080 };
const LUKE_1 = { width: 956, height: 718 };

describe("H101 · O108 the triple-fit clip", () => {
  it("Luke 15 (1920 × 1080) and Luke 1 (956 × 718) are triple-fit clips; 640 × 360 (part window 607) keeps O93's refusal", () => {
    assert.deepEqual(clipKind(LUKE_15), { kind: "triple-fit", line: "Landscape — triple-fit only" });
    assert.deepEqual(clipKind(LUKE_1), { kind: "triple-fit", line: TF_LINES.landscape });
    assert.deepEqual(clipKind({ width: 640, height: 360 }), { kind: "too-small", line: TOO_SMALL_FOR_916 });
    assert.equal(importRefusal({ width: 640, height: 360 }), "Too small for 9:16");
    assert.equal(importRefusal(LUKE_15), null);
    assert.equal(importRefusal(LUKE_1), null);
  });

  it("a clip that makes its own 9:16 runs as itself; a portrait clip is never a triple-fit", () => {
    assert.equal(clipKind({ width: 3840, height: 2160 }).kind, "916");
    assert.equal(clipKind({ width: 1080, height: 1920 }).kind, "916");
    assert.equal(clipKind({ width: 360, height: 640 }).kind, "too-small");
  });

  it("the offer shows with 2 runnable 9:16 clips and not with 3; never for the promoter, a clip under 6 s, or twice", () => {
    const base = { source: LUKE_15, durationS: 20, owner: "artist" as const, alreadyMade: false };
    assert.equal(offerTripleFit({ ...base, runnable916: 2 }), true);
    assert.equal(offerTripleFit({ ...base, runnable916: 3 }), false);
    assert.equal(offerTripleFit({ ...base, runnable916: 0, owner: "promoter" }), false);
    assert.equal(offerTripleFit({ ...base, runnable916: 0, durationS: 5.9 }), false);
    assert.equal(offerTripleFit({ ...base, runnable916: 0, alreadyMade: true }), false);
    assert.equal(offerTripleFit({ ...base, runnable916: 0, source: { width: 3840, height: 2160 } }), false);
  });

  it("the groups: the clips that run, then \"Triple-fit only · {n}\", then \"Can't run\"; the tile lines", () => {
    assert.equal(groupOf({ width: 1080, height: 1920 }, false), "runs");
    assert.equal(groupOf(LUKE_1, false), "triple-fit only");
    assert.equal(groupOf(LUKE_1, true), "can't run");
    assert.equal(groupOf({ width: 640, height: 360 }, false), "can't run");
    assert.equal(TF_LINES.group(4), "Triple-fit only · 4");
    assert.equal(TF_LINES.tile(1), "Triple-fit · #1");
    assert.equal(TF_LINES.make, "Make a triple-fit");
  });
});

describe("H102 · O109 / O110 layout and sound", () => {
  it("one window with the part's shape: 1920 × 1080 → 1822 × 1080 at 0.59×; 956 × 718 → 956 × 566 at 1.13×", () => {
    const a = partWindow(LUKE_15);
    assert.deepEqual([a.width, a.height, a.top], [1822, 1080, 0]);
    close(a.left, 49);
    close(partScale(a), 0.593, 1e-3);
    const b = partWindow(LUKE_1);
    assert.deepEqual([b.left, b.width, b.height], [0, 956, 566]);
    close(b.top, 76);
    close(partScale(b), 1.13, 1e-3);
    // crop_focus_x moves a 16:9 window across its 98 px of slack; crop_focus_y places a 4:3 window in its 152 px.
    assert.equal(partWindow(LUKE_15, 1).left, 98);
    assert.equal(partWindow(LUKE_1, 0.5, 1).top, 152);
  });

  it("parts at y 0 / 640 / 1280, 1080 × 640 each, the same window and start in all three; one part carries the sound", () => {
    const w = partWindow(LUKE_15);
    const parts = partPlacements(LUKE_15, w, false);
    assert.deepEqual(parts.map((p) => p.top), [0, 640, 1280]);
    assert.deepEqual(TRIPLE_FIT.part, { width: 1080, height: 640 });
    for (const p of parts) assert.deepEqual(p.video, parts[0]!.video);
    close(parts[0]!.video.width, 1920 * partScale(w));
    assert.deepEqual(parts.map((p) => p.muted), [true, false, true]);
    assert.deepEqual(partPlacements(LUKE_15, w, true).map((p) => p.muted), [true, true, true]);
  });

  it("the composition draws the three parts from one start frame, so every part shows the same source frame", () => {
    const src = readFileSync(join(process.cwd(), "src/remotion/compositions/TripleFitOnClip.tsx"), "utf8");
    assert.equal(src.match(/<OffthreadVideo /g)?.length, 1, "one video element, mapped over the three parts");
    assert.match(src, /parts\.map\(\(p\) =>/);
    assert.match(src, /startFrom=\{startFrom\}/);
    assert.doesNotMatch(src, /<Audio\b/, "no second soundtrack");
    const root = readFileSync(join(process.cwd(), "src/remotion/index.tsx"), "utf8");
    assert.match(root, /id="TripleFitOnClip"/);
  });

  it("upscale at most 1.6×: past it the draft is refused with O93's words", () => {
    assert.equal(tripleFitUpscale(LUKE_1).ok, true);
    const small = tripleFitUpscale({ width: 640, height: 360 });
    assert.equal(small.ok, false);
    assert.equal(small.ok ? null : small.line, TOO_SMALL_FOR_916);
    close(small.scale, 1080 / 607, 1e-9);
  });

  it("length is the stored window up to 30 s, at least 6 s", () => {
    assert.deepEqual(tripleFitLength(0, 24.9), { ok: true, seconds: 24.9 });
    assert.deepEqual(tripleFitLength(2, 50), { ok: true, seconds: 30 });
    assert.deepEqual(tripleFitLength(0, 5.9), { ok: false, line: TF_LINES.tooShort });
  });

  it("sound: the clip's own track once; a music match carries its flag; no track runs silent", () => {
    assert.deepEqual(tripleFitSound({ hasAudio: true }), { muted: false, flag: null });
    assert.deepEqual(tripleFitSound({ hasAudio: true, audioMatch: true }), { muted: false, flag: "Music match — mute or replace before launch" });
    assert.deepEqual(tripleFitSound({ hasAudio: false }), { muted: true, flag: null });
  });
});

describe("H103 · O111 type and the seams", () => {
  it("the seam clearances are y 616–664 and 1256–1304", () => {
    assert.deepEqual(SEAM_ZONES, [
      { seam: 640, top: 616, bottom: 664 },
      { seam: 1280, top: 1256, bottom: 1304 },
    ]);
  });

  it("T1 B passes the band check and the seam check; the top block sits on part 1, the date and claim on part 2", () => {
    const l = planClipLayout(pieces(roll), "9:16", "B");
    const checks = tripleFitTypeChecks(l);
    assert.ok(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok)));
    close(l.boxes.top.top + l.boxes.top.height, 603.4, 0.5);
    assert.equal(partOf(l.boxes.top), 1);
    assert.equal(partOf(l.boxes.date), 2);
    assert.equal(partOf(l.boxes.claim!), 2);
  });

  it("an A arrangement on a triple-fit is refused by the check", () => {
    const checks = tripleFitTypeChecks(planClipLayout(pieces(roll), "9:16", "A"));
    assert.deepEqual(checks, [{ slot: "arrangement", ok: false, why: TF_LINES.arrangementB }]);
  });

  it("ink in either seam's 24 px fails, naming the slot; ink just outside passes", () => {
    const checks = seamChecks([
      { slot: "A's date", box: { left: 400, top: 632, width: 300, height: 57 } },
      { slot: "low", box: { left: 400, top: 1250, width: 300, height: 10 } },
      { slot: "clear", box: { left: 400, top: 560, width: 300, height: 56 } },
      { slot: "clear 2", box: { left: 400, top: 664, width: 300, height: 40 } },
    ]);
    assert.deepEqual(checks.map((c) => [c.slot, c.ok]), [["A's date", false], ["low", false], ["clear", true], ["clear 2", true]]);
    assert.equal(checks[0]!.why, "ink 632–689 in the 640 seam's 24 px (616–664)");
  });
});

describe("H104 · O112 faces", () => {
  it("one window against the union of part 1's and part 2's type, in the part's own coordinates", () => {
    const l = planClipLayout(pieces(roll), "9:16", "B");
    const boxes = partFaceBoxes(l);
    // Part 1's top block 353–603; part 2's date and claim less 640.
    close(boxes.always[0]!.top, 353);
    close(boxes.always[1]!.top, l.boxes.date.top - 640);
    close(boxes.claim!.top + boxes.claim!.height, 1238 - 640);
    assert.equal(boxes.union.top, Math.min(353, l.boxes.date.top - 640));
    close(boxes.union.bottom, 603.4, 0.5);
  });

  it("a source face maps through the shared window: a face under the name in the part is refused once for the clip", () => {
    const w = partWindow(LUKE_15);
    const k = partScale(w);
    // A face at part (500, 400), 0.1 W wide → source px.
    const face = { left: 500 / k + w.left, top: 400 / k + w.top, width: 108 / k, height: 140 / k };
    const samples = facesInPart(Array.from({ length: 40 }, (_, i) => ({ tS: i / 5, faces: [face] })), w);
    close(samples[0]!.faces[0]!.left, 500, 1e-6);
    const l = planClipLayout(pieces(roll), "9:16", "B");
    const v = judgeFaceOverTime(samples, partFaceBoxes(l), { frameWidth: TRIPLE_FIT.part.width });
    assert.equal(v.ok, false);
    assert.match(v.line!, /^Face in the type/);
  });

  it("crop candidates run along the window's slack and are tried once", () => {
    const xs = partCropCandidates(LUKE_15, { x: 0.5, y: 0.5 });
    assert.ok(xs.every((c) => c.y === 0.5));
    assert.equal(new Set(xs.map((c) => c.x)).size, xs.length);
    const ys = partCropCandidates(LUKE_1, { x: 0.5, y: 0.5 });
    assert.ok(ys.every((c) => c.x === 0.5));
    // A source exactly the part's shape can't move: one candidate.
    assert.equal(partCropCandidates({ width: 1080, height: 640 }, { x: 0.5, y: 0.5 }).length, 1);
  });
});

describe("H105 · O113 rights", () => {
  it("a triple-fit's channels equal its clip's", () => {
    const channels = { rightsRef: "artist", artistChannels: true };
    assert.equal(tripleFitChannels(channels), channels);
  });
});
