// Caption placement at 2 fps (coverInterval) vs 5 fps, each judged against a 50 fps ground truth.
// The fixtures are the #1311 review's: a face lingering 0.2–1.6 s at 20 phases across a 0.5 s step,
// and scattered 0.2 s blips covering 6–14 % of the window. "Worse" = 5 fps places the caption clear
// of the face by the truth and 2 fps doesn't. It must never happen.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captionBoxesAt, placeFromStoredSamples } from "../caption-placement.ts";
import { judgeFaceOverTime } from "../t1-face.ts";
const lines = ["THE NIGHT EVERYONE", "IS TALKING ABOUT"];
const W_OUT = 10;
type Face = { left: number; top: number; width: number; height: number };
const track = (fps: number, present: (t: number) => boolean, face: Face) => Array.from({ length: Math.round(W_OUT * fps) }, (_, i) => ({ t: i / fps, faces: present(i / fps) ? [face] : [] }));
function place(fps: number, present: (t: number) => boolean, face: Face) {
  return placeFromStoredSamples({ lines, baseScale: 1, kind: "caption", windowIn: 0, windowOut: W_OUT, samples: track(fps, present, face), fps });
}
/** Ground truth: the chosen box judged on a 50 fps track (point samples, 0.02 s each). */
function truthOk(r: ReturnType<typeof place>, present: (t: number) => boolean, face: Face): boolean | "refused" {
  if (!r.ok) return "refused";
  const boxes = captionBoxesAt(lines, r.scale, r.centre);
  const s = track(50, present, face).filter((x) => x.t >= r.inS - 1e-6).map((x) => ({ tS: x.t - r.inS, faces: x.faces }));
  return judgeFaceOverTime(s, { always: boxes, claim: null }, { frameWidth: 1080, fps: 50 }).ok;
}
describe("caption placement at FACE_SAMPLE_FPS never sits on a face where 5 fps wouldn't", () => {
it("no fixture places the caption worse at 2 fps than at 5 fps (50 fps truth)", () => {
  const empty = place(5, () => false, { left: 0, top: 0, width: 0, height: 0 });
  if (!empty.ok) throw new Error("no default");
  const top = Math.min(...captionBoxesAt(lines, empty.scale, empty.centre).map((b) => b.top));
  const face = { left: 440, top: top - 40, width: 200, height: 200 };
  const out: string[] = [];
  let worseTotal = 0;
  const tally = (label: string, cases: ((t: number) => boolean)[]) => {
    let worse = 0, safer = 0, same = 0, refused2 = 0;
    for (const present of cases) {
      const a = truthOk(place(5, present, face), present, face);
      const b = truthOk(place(2, present, face), present, face);
      if (b === "refused") refused2 += 1;
      if (a === true && b === false) worse += 1;
      else if (a === false && b !== false) safer += 1;
      else same += 1;
    }
    worseTotal += worse;
    out.push(`${label}: worse ${worse}, safer ${safer}, same ${same} (2 fps refused ${refused2})`);
  };
  for (const d of [0.2, 0.3, 0.45, 0.55, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.6]) {
    tally(`linger ${d.toFixed(2)} s ×20 phases`, Array.from({ length: 20 }, (_, k) => { const t0 = 1 + k * 0.025; return (t: number) => t >= t0 - 1e-9 && t < t0 + d - 1e-9; }));
  }
  for (const share of [0.06, 0.08, 0.1, 0.12, 0.14]) {
    tally(`scattered 0.2 s blips ~${share * 100}% ×20`, Array.from({ length: 20 }, (_, i) => {
      let x = (i + 1) * 9301 + 49297; const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
      const blips: number[] = []; for (let t = 0; t < W_OUT; t += 0.2) if (rnd() < share) blips.push(t);
      return (t: number) => blips.some((b) => t >= b - 1e-9 && t < b + 0.2 - 1e-9);
    }));
  }
  assert.equal(worseTotal, 0, out.join("\n"));
});

it("a lone 2 fps hit counts its full interval each side (1.0 s, fails); 5 fps is unchanged", () => {
  const box = { left: 0, top: 300, width: 1080, height: 200 };
  const face = { left: 340, top: 250, width: 400, height: 400 };
  const at = (hits: number[], fps: number) => Array.from({ length: 20 }, (_, i) => ({ tS: i / fps, faces: hits.includes(i) ? [face] : [] }));
  assert.equal(judgeFaceOverTime(at([5], 2), { always: [box], claim: null }, { fps: 2, coverInterval: true }).longestRunS, 1);
  assert.equal(judgeFaceOverTime(at([5], 2), { always: [box], claim: null }, { fps: 2, coverInterval: true }).ok, false);
  assert.equal(judgeFaceOverTime(at([5, 6], 5), { always: [box], claim: null }, { fps: 5 }).longestRunS, 0.4);
  assert.equal(judgeFaceOverTime(at([5, 6], 5), { always: [box], claim: null }, { fps: 5 }).ok, true);
});

it("every face that fails 5 fps on a run also hits a 2 fps sample (the grids share a start)", () => {
  for (let a = 0; a < 3; a += 0.01) {
    for (let d = 0.3; d <= 1.2; d += 0.01) {
      const in5 = Array.from({ length: 40 }, (_, i) => i / 5).filter((t) => t >= a - 1e-9 && t < a + d - 1e-9);
      let run = 0, longest = 0, prev = -1;
      for (const t of in5) { run = prev >= 0 && Math.abs(t - prev - 0.2) < 1e-6 ? run + 1 : 1; prev = t; longest = Math.max(longest, run); }
      if (longest / 5 <= 0.5 + 1e-9) continue;
      const caught = Array.from({ length: 16 }, (_, i) => i / 2).some((t) => t >= a - 1e-9 && t < a + d - 1e-9);
      assert.ok(caught, `face ${a.toFixed(2)}+${d.toFixed(2)} s fails 5 fps but no 2 fps sample sees it`);
    }
  }
});
});
