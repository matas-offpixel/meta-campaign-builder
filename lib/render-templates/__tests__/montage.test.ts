import assert from "node:assert/strict";
import { test } from "node:test";

import { beatGrid } from "../beats.ts";
import { MONTAGE, checkCutSheet, cutSheetText, dropOffsetS, isRefusal, planMontage, type MontageClip, type MontagePlan } from "../montage-plan.ts";
import { fixtureTrack } from "./fixture-track.ts";

const clips = (n = 16): MontageClip[] => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, name: `clip ${i + 1}.mp4`, owner: "artist", isHeadliner: i < 4, inS: 1, outS: 9 }));
const TEXT = { hook: "PUZZLE 4TH BIRTHDAY", date: "SUNDAY 27TH DECEMBER", venue: "CIRCUIT & ENGINE ROOMS", lineup: ["ENZO SIRAGUSA", "LUKE DEAN", "ROSSI.", "SEB ZITO", "ARCHIE HAMILTON", "JOSH BAKER"], cta: ["3RD RELEASE LIVE"] };
const FRAME = 1 / MONTAGE.fps;

function plan(bpm: number): { plan: MontagePlan; truth: number[]; windowStart: number } {
  const t = fixtureTrack({ bpm, dropS: 34 });
  // The stored drop is a little off the kick, as CT4's 50 ms frames leave it.
  const grid = beatGrid(t.pcm, t.dropS + 0.03);
  const p = planMontage({ grid, drop: { trackS: t.dropS + 0.03, source: "lab" }, trackName: "Fixture", clips: clips(), text: TEXT });
  assert.ok(!isRefusal(p));
  return { plan: p, truth: t.kicksS, windowStart: p.window.startS };
}

for (const bpm of [120, 124, 126, 128, 132, 140]) {
  test(`fixture track at ${bpm} BPM: the beat grid finds every kick within one frame`, () => {
    const t = fixtureTrack({ bpm, dropS: 34 });
    const grid = beatGrid(t.pcm, t.dropS + 0.03);
    for (const k of grid.kicks) {
      const nearest = t.kicksS.reduce((a, b) => (Math.abs(b - k) < Math.abs(a - k) ? b : a));
      assert.ok(Math.abs(nearest - k) <= FRAME, `kick ${k} is ${Math.abs(nearest - k)} s off`);
    }
  });

  test(`cut sheet at ${bpm} BPM: every cut and text change lands on a real kick within one frame; the drop 3–5 s in`, () => {
    const { plan: p, truth, windowStart } = plan(bpm);
    const realKicks = truth.map((k) => k - windowStart).filter((k) => k >= -FRAME && k < MONTAGE.durationS);
    const onKick = (frame: number) => realKicks.some((k) => Math.abs(frame / MONTAGE.fps - k) <= FRAME + 1e-9);
    for (const c of p.sheet.cuts) assert.ok(onKick(c.frame), `${c.what} at frame ${c.frame}`);
    for (const v of ["teaser", "announcement"] as const) for (const c of p.sheet.texts[v]) assert.ok(onKick(c.frame), `${v} ${c.what} at frame ${c.frame}`);
    assert.ok(p.dropAtS >= 3 && p.dropAtS <= 5, `drop at ${p.dropAtS}`);
    assert.deepEqual(checkCutSheet(p.sheet, "announcement"), []);
    assert.deepEqual(checkCutSheet(p.sheet, "teaser"), []);
  });
}

test("16 distinct clips, the build accelerating into the drop, a flash on every kick from the drop", () => {
  const { plan: p } = plan(126);
  assert.equal(p.segments.length, 16);
  assert.equal(new Set(p.segments.map((s) => s.clipId)).size, 16);
  const pre = p.segments.filter((s) => s.kickIndex < p.dropKick).map((s) => s.frames);
  for (let i = 1; i < pre.length; i += 1) assert.ok(pre[i]! <= pre[i - 1]!, "each cut before the drop is no longer than the last");
  assert.equal(p.segments.reduce((s, x) => s + x.frames, 0), MONTAGE.fps * MONTAGE.durationS);
  assert.deepEqual(p.flashes, p.kicks.slice(p.dropKick).map((k) => Math.round(k * MONTAGE.fps)));
});

test("text: hook from frame 0, date and venue on the drop, one name per cut, logo and CTA at the close; No text has none", () => {
  const { plan: p } = plan(126);
  const a = p.texts.announcement;
  assert.equal(a[0]!.kind, "hook");
  assert.equal(a[0]!.fromFrame, 0);
  const details = a.find((b) => b.kind === "details")!;
  assert.equal(details.fromFrame, Math.round(p.dropAtS * MONTAGE.fps));
  const names = a.filter((b) => b.kind === "name");
  assert.deepEqual(names.map((b) => b.lines[0]), TEXT.lineup);
  const cutFrames = new Set(p.segments.map((s) => s.fromFrame));
  for (const b of a) assert.ok(cutFrames.has(b.fromFrame), `${b.kind} starts on a cut`);
  const close = a.at(-1)!;
  assert.equal(close.kind, "close");
  assert.ok(close.fromFrame / MONTAGE.fps <= MONTAGE.durationS - 2);
  assert.equal(p.texts["no-text"].length, 0);
  assert.equal(p.texts.teaser.some((b) => b.kind === "name"), false, "the teaser keeps the lineup back");
});

test("the check fails a cut or a text change moved off its kick by more than a frame", () => {
  const { plan: p } = plan(126);
  const moved = structuredClone(p.sheet);
  moved.cuts[3]!.frame += 2;
  assert.equal(checkCutSheet(moved, "no-text").length, 1);
  const text = structuredClone(p.sheet);
  text.texts.announcement[2]!.frame -= 3;
  assert.equal(checkCutSheet(text, "announcement").length, 1);
  assert.deepEqual(checkCutSheet(text, "teaser"), []);
});

test("the cut sheet ships the grid, the drop and how it was picked, and every change with its kick", () => {
  const { plan: p } = plan(126);
  const s = cutSheetText(p.sheet, "announcement");
  assert.match(s, /^Track: Fixture · 12\d\.\d+ BPM/);
  assert.match(s, /Drop: [34]\.\d{3} s .*kick 8: the biggest rise in low-end energy/);
  assert.equal((s.match(/^  .* frames off · cut /gm) ?? []).length, 15);
  const at = dropOffsetS({ kicks: p.sheet.track.kicksS.map((k) => k + p.window.startS), periodS: p.sheet.track.periodS }, p.sheet.drop.trackS)!;
  assert.ok(Math.abs(at - p.dropAtS) < 0.001, `the card's drop at ${at} s is the plan's ${p.dropAtS} s`);
});

test("refusals: fewer than 16 clips, a repeat, a drop too early to land 3 s in", () => {
  const t = fixtureTrack({ bpm: 126, dropS: 34 });
  const grid = beatGrid(t.pcm, t.dropS);
  assert.deepEqual(planMontage({ grid, drop: { trackS: t.dropS, source: "lab" }, trackName: "x", clips: clips(15), text: TEXT }), { refused: "too_few_clips" });
  const dup = clips();
  dup[5] = { ...dup[5]!, id: "c1" };
  assert.deepEqual(planMontage({ grid, drop: { trackS: t.dropS, source: "lab" }, trackName: "x", clips: dup, text: TEXT }), { refused: "repeat_clip" });
  const early = fixtureTrack({ bpm: 126, dropS: 1.2, firstKickS: 0.1 });
  const g2 = beatGrid(early.pcm, early.dropS);
  assert.deepEqual(planMontage({ grid: g2, drop: { trackS: early.dropS, source: "lab" }, trackName: "x", clips: clips(), text: TEXT }), { refused: "drop_too_early" });
});
