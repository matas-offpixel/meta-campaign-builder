// Caption placement at FACE_SAMPLING (jittered gaps of 0.3–0.4 s, seeded per clip) vs 5 fps, each judged
// against a 50 fps ground truth on the #1311 review's tracks. "Worse" = 5 fps places the caption clear of
// the face by the truth and FACE_SAMPLING doesn't. It must never happen, on the run rule or the share rule.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FACE_SAMPLE_FPS, FACE_SAMPLING, captionBoxesAt, placeFromStoredSamples } from "../caption-placement.ts";
import { faceSampleSeed, sampleTimes } from "../face-sampling.ts";
import { T1V_FACE, judgeFaceOverTime } from "../t1-face.ts";

const lines = ["THE NIGHT EVERYONE", "IS TALKING ABOUT"];
type Face = { left: number; top: number; width: number; height: number };
type Present = (t: number) => boolean;
const W_OUT = 10;
const at = (times: readonly number[], present: Present, face: Face) => times.map((t) => ({ t, faces: present(t) ? [face] : [] }));
const uniform = (fps: number) => Array.from({ length: Math.round(W_OUT * fps) }, (_, i) => i / fps);
const place = (times: readonly number[], fps: number, present: Present, face: Face) =>
  placeFromStoredSamples({ lines, baseScale: 1, kind: "caption", windowIn: 0, windowOut: W_OUT, samples: at(times, present, face), fps });
function truth(r: ReturnType<typeof place>, present: Present, face: Face): "refused" | "ok" | "run" | "share" {
  if (!r.ok) return "refused";
  const boxes = captionBoxesAt(lines, r.scale, r.centre);
  const s = at(uniform(50), present, face).filter((x) => x.t >= r.inS - 1e-6).map((x) => ({ tS: x.t - r.inS, faces: x.faces }));
  const v = judgeFaceOverTime(s, { always: boxes, claim: null }, { frameWidth: 1080, fps: 50 });
  if (v.ok) return "ok";
  return v.longestRunS > T1V_FACE.maxRunS + 1e-9 ? "run" : "share";
}

/** The review's tracks (its exact generators and seeds) plus single lingers of 0.40–0.60 s at fine phases. */
function trackSets(): [string, Present[]][] {
  const sets: [string, Present[]][] = [];
  sets.push(["phase-locked 0.2 / 0.3 s blips", [
    (t) => { const f = t % 1; return (f >= 0.15 && f < 0.35) || (f >= 0.65 && f < 0.85); },
    (t) => { const f = t % 0.5; return f >= 0.1 && f < 0.4; },
  ]]);
  const bob: Present[] = [];
  for (let bpm = 110; bpm <= 150; bpm += 1) { const p = 60 / bpm; for (let k = 0; k < 20; k += 1) bob.push((t) => ((t + (k * p) / 20) % p) < 0.2); }
  sets.push(["head-bob 110–150 BPM in 1 BPM steps, 0.2 s dip, 20 phases", bob]);
  let x = 12345;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const blips: Present[] = [];
  for (let n = 0; n < 1000; n += 1) {
    const b: [number, number][] = [];
    const count = 1 + Math.floor(rnd() * 8);
    for (let i = 0; i < count; i += 1) { const s = rnd() * W_OUT; b.push([s, s + 0.05 + rnd() * 0.4]); }
    blips.push((t) => b.some(([s, e]) => t >= s && t < e));
  }
  sets.push(["1,000 random tracks of 1–8 blips, 0.05–0.45 s", blips]);
  const lingers: Present[] = [];
  for (let n = 0; n < 1000; n += 1) { const s = rnd() * 9; const d = 0.1 + rnd() * 1.9; lingers.push((t) => t >= s && t < s + d); }
  sets.push(["1,000 random single lingers, 0.1–2 s", lingers]);
  const fine: Present[] = [];
  for (let d = 0.4; d <= 0.6 + 1e-9; d += 0.01) for (let k = 0; k < 50; k += 1) { const t0 = 1 + k * 0.01; const dd = d; fine.push((t) => t >= t0 - 1e-9 && t < t0 + dd - 1e-9); }
  sets.push(["single lingers 0.40–0.60 s in 0.01 s steps, 50 phases", fine]);
  const old: Present[] = [];
  for (const d of [0.2, 0.3, 0.45, 0.55, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.6]) for (let k = 0; k < 20; k += 1) { const t0 = 1 + k * 0.025; old.push((t) => t >= t0 - 1e-9 && t < t0 + d - 1e-9); }
  for (const share of [0.06, 0.08, 0.1, 0.12, 0.14]) for (let i = 0; i < 20; i += 1) {
    let y = (i + 1) * 9301 + 49297;
    const r2 = () => ((y = (y * 9301 + 49297) % 233280) / 233280);
    const b: number[] = [];
    for (let t = 0; t < W_OUT; t += 0.2) if (r2() < share) b.push(t);
    old.push((t) => b.some((s) => t >= s - 1e-9 && t < s + 0.2 - 1e-9));
  }
  sets.push(["the earlier 320 cases", old]);
  return sets;
}

describe("caption placement at FACE_SAMPLING never sits on a face where 5 fps wouldn't", () => {
  it("0 worse on every review track, on the run rule and the share rule (50 fps truth)", () => {
    const empty = place(uniform(5), 5, () => false, { left: 0, top: 0, width: 0, height: 0 });
    if (!empty.ok) throw new Error("no default spot");
    const top = Math.min(...captionBoxesAt(lines, empty.scale, empty.centre).map((b) => b.top));
    const face = { left: 440, top: top - 40, width: 200, height: 200 };
    const worse: string[] = [];
    for (const [label, cases] of trackSets()) {
      cases.forEach((present, i) => {
        const seed = faceSampleSeed({ id: `${label}#${i}`, cropFocusX: 0.5, cropFocusY: 0.5, inS: 0, outS: W_OUT });
        const a = truth(place(uniform(5), 5, present, face), present, face);
        const b = truth(place(sampleTimes(W_OUT, FACE_SAMPLING, seed), FACE_SAMPLE_FPS, present, face), present, face);
        if (a === "ok" && (b === "run" || b === "share")) worse.push(`${label} #${i} (${b})`);
      });
    }
    assert.deepEqual(worse.slice(0, 5), [], `${worse.length} worse`);
  });

  it("no gap between jittered samples is over 0.4 s, so every 0.4 s stretch holds a sample (the run proof)", () => {
    for (let seed = 1; seed <= 2_000; seed += 1) {
      const t = sampleTimes(30, FACE_SAMPLING, seed);
      assert.equal(t[0], 0);
      for (let i = 1; i < t.length; i += 1) assert.ok(t[i]! - t[i - 1]! <= 0.4 + 1e-9 && t[i]! - t[i - 1]! >= 0.3 - 1e-9);
      assert.ok(30 - t[t.length - 1]! <= 0.4 + 1e-9);
    }
  });

  it("the same clip, crop and window pick the same frames; a crop change picks new ones", () => {
    const clip = { id: "c1", cropFocusX: 0.5, cropFocusY: 0.5, inS: 0, outS: 30 };
    assert.deepEqual(sampleTimes(30, FACE_SAMPLING, faceSampleSeed(clip)), sampleTimes(30, FACE_SAMPLING, faceSampleSeed({ ...clip })));
    assert.notDeepEqual(sampleTimes(30, FACE_SAMPLING, faceSampleSeed(clip)), sampleTimes(30, FACE_SAMPLING, faceSampleSeed({ ...clip, cropFocusX: 0.4 })));
  });

  it("runs use the real gaps: k hits reach from the sample before to the sample after; uniform 5 fps is unchanged", () => {
    const box = { left: 0, top: 300, width: 1080, height: 200 };
    const face = { left: 340, top: 250, width: 400, height: 400 };
    const jittered = [0, 0.3, 0.65, 1.0, 1.4, 1.75].map((tS, i) => ({ tS, faces: i === 2 ? [face] : [] }));
    const lone = judgeFaceOverTime(jittered, { always: [box], claim: null }, { fps: FACE_SAMPLE_FPS, coverInterval: true });
    assert.ok(Math.abs(lone.longestRunS - (1.0 - 0.3)) < 1e-9);
    assert.equal(lone.ok, false);
    const five = Array.from({ length: 20 }, (_, i) => ({ tS: i / 5, faces: i === 5 || i === 6 ? [face] : [] }));
    assert.equal(judgeFaceOverTime(five, { always: [box], claim: null }, { fps: 5 }).longestRunS, 0.4);
    assert.equal(judgeFaceOverTime(five, { always: [box], claim: null }, { fps: 5 }).ok, true);
  });
});
