// A face check across ticks (17 Nov 2026: Vercel took ~15 s a frame, so 87 frames can't fit one 600 s run).
// A slice checks frames to its time, saves the progress and parks the check with the lock held; the next tick
// resumes it from there on the same seeded plan, never from zero. Partial progress never reads as ready, a
// slice that checked nothing counts as a try, and a resumed check gives the frames one run would.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  FACE_CHECK_BUDGET_MS,
  FACE_CHECK_LOCK_MS,
  FACE_CHECK_MAX_ATTEMPTS,
  FACE_CHECK_SLICE_MS,
  FACE_CHECK_TIMED_OUT,
  FACE_DETECTOR,
  FACE_SAMPLE_FPS,
  FACE_SAMPLING,
  faceSampleState,
  readFaceSamples,
  type FaceCheckProgress,
} from "../caption-placement.ts";
import { claimFaceCheck, finishFaceCheck, parkFaceCheck } from "../face-check-lock.ts";
import { finishedSamples, newProgress, readProgress, runFaceCheckSlice } from "../face-check-slice.ts";
import { extractFaceFrames, pullFaceFrames, scanFrameTimes } from "../face-frames.ts";
import { FACE_MAX_GAP_S, faceSampleSeed, largestGap, planFrames, sampleTimes } from "../face-sampling.ts";
import type { ServiceRoleDb } from "../load.ts";
import { fakeDb } from "./fake-db.ts";

const NOW = new Date("2026-11-17T17:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const window = { cropFocusX: 0.5, cropFocusY: 0.5, inS: 0, outS: 30 };
const base = { detector: FACE_DETECTOR, fps: FACE_SAMPLE_FPS, ...window };
const clip = (id: string, extra: Record<string, unknown> = {}) => ({ id, user_id: "op", crop_focus_x: 0.5, crop_focus_y: 0.5, in_s: 0, out_s: 30, face_samples: null, face_samples_at: null, ...extra });
const asDb = (fake: ReturnType<typeof fakeDb>) => fake as unknown as ServiceRoleDb;

/** P26-BDAY #22's shape: a 30 s window at 30 fps, the seeded plan (87 frames for its id on prod). */
function plan30(id = "5d7b2840") {
  const times = sampleTimes(30, FACE_SAMPLING, faceSampleSeed({ id, cropFocusX: 0.5, cropFocusY: 0.5, inS: 0, outS: 30 }));
  return planFrames(times, 30, 30).map((p) => p.frame);
}

/** A source at `fps` with frames up to `lastFrame`, and a clock that `perFrameS` of detection moves on. */
function fakeSource(opts: { fps: number; lastFrame: number; perFrameS: number; extractS?: number }) {
  let clock = 0;
  const calls: number[][] = [];
  return {
    now: () => clock,
    calls,
    advance: (ms: number) => void (clock += ms),
    extract: async (frames: readonly number[]) => {
      calls.push([...frames]);
      clock += (opts.extractS ?? 2) * 1000;
      return frames.filter((n) => n <= opts.lastFrame).map((n) => ({ file: `f${n}`, t: n / opts.fps }));
    },
    detect: async (file: string) => {
      clock += opts.perFrameS * 1000;
      const n = Number(file.slice(1));
      return n % 7 === 0 ? [{ left: n, top: 0, width: 10, height: 10 }] : [];
    },
    scan: async () => Array.from({ length: opts.lastFrame + 1 }, (_, n) => ({ n, t: n / opts.fps })),
  };
}

/** Run slices back to back, each `sliceMs` long on the fake clock, until done. */
async function runToEnd(progress: FaceCheckProgress, src: ReturnType<typeof fakeSource>, durationS: number, sliceMs = FACE_CHECK_SLICE_MS) {
  const slices: { done: number; status: string }[] = [];
  for (let i = 0; i < 100; i += 1) {
    const start = src.now();
    const out = await runFaceCheckSlice({
      progress, durationS, sliceEnd: start + sliceMs, deadline: start + FACE_CHECK_BUDGET_MS, estimateS: 15,
      extract: src.extract, detect: src.detect, scan: src.scan, now: src.now,
    });
    progress = out.progress;
    slices.push({ done: progress.done, status: out.status });
    if (out.status === "done") return { progress, slices };
    // A JSON round trip, as the row is stored.
    progress = readProgress(JSON.parse(JSON.stringify(progress)))!;
  }
  throw new Error("never finished");
}

describe("a face check in slices (runFaceCheckSlice)", () => {
  it("at 15 s a frame, a 450 s slice checks ~30 of ~87 frames and parks; three slices finish, no frame twice", async () => {
    const plan = plan30();
    assert.ok(plan.length >= 80 && plan.length <= 95, String(plan.length));
    const src = fakeSource({ fps: 30, lastFrame: 899, perFrameS: 15 });
    const { progress, slices } = await runToEnd(newProgress(plan), src, 30);
    assert.deepEqual(slices.map((s) => s.status), ["parked", "parked", "done"]);
    assert.ok(slices[0]!.done >= 28 && slices[0]!.done <= 31, JSON.stringify(slices));
    // Each frame of the plan was asked for once, in order: only the slice's own frames are extracted.
    assert.deepEqual(src.calls.flat(), plan);
    assert.equal(progress.checked, plan.length);
    assert.equal(progress.slices, 3);
    assert.equal(progress.samples.length, plan.length);
  });

  it("a resumed check gives the same samples as one long run, and the gap bound holds", async () => {
    for (const id of ["a", "b", "c", "5d7b2840", "e"]) {
      const plan = plan30(id);
      const one = await runToEnd(newProgress(plan), fakeSource({ fps: 30, lastFrame: 899, perFrameS: 15 }), 30, 1e9);
      const many = await runToEnd(newProgress(plan), fakeSource({ fps: 30, lastFrame: 899, perFrameS: 15 }), 30);
      assert.equal(one.slices.length, 1);
      assert.ok(many.slices.length >= 3);
      assert.deepEqual(finishedSamples(many.progress, 30).samples, finishedSamples(one.progress, 30).samples);
      const done = finishedSamples(many.progress, 30);
      assert.ok(done.largestGapS <= FACE_MAX_GAP_S + 1e-9, `${id}: ${done.largestGapS}`);
      assert.equal(done.hole, false);
    }
  });

  it("stops at the slice's end: no frame starts past it, and frames extracted but not reached are asked again", async () => {
    const plan = plan30();
    // The estimate says 15 s, the frames take 40 s: the batch is too big, the slice stops on time.
    const src = fakeSource({ fps: 30, lastFrame: 899, perFrameS: 40 });
    const out = await runFaceCheckSlice({
      progress: newProgress(plan), durationS: 30, sliceEnd: FACE_CHECK_SLICE_MS, deadline: FACE_CHECK_BUDGET_MS, estimateS: 15,
      extract: src.extract, detect: src.detect, scan: src.scan, now: src.now,
    });
    assert.equal(out.status, "parked");
    assert.equal(out.stopped, "time");
    assert.ok(src.now() < FACE_CHECK_SLICE_MS + 40_000, String(src.now()));
    assert.equal(out.progress.done, out.progress.samples.length);
    const next = fakeSource({ fps: 30, lastFrame: 899, perFrameS: 15 });
    await runFaceCheckSlice({
      progress: out.progress, durationS: 30, sliceEnd: FACE_CHECK_SLICE_MS, deadline: FACE_CHECK_BUDGET_MS, estimateS: 15,
      extract: next.extract, detect: next.detect, scan: next.scan, now: next.now,
    });
    assert.equal(next.calls[0]![0], plan[out.progress.done]);
  });

  it("sizes the next extract from the seconds a frame has taken, not the estimate", async () => {
    const plan = plan30();
    const src = fakeSource({ fps: 30, lastFrame: 899, perFrameS: 5, extractS: 0 });
    const out = await runFaceCheckSlice({
      progress: newProgress(plan), durationS: 30, sliceEnd: 100_000, deadline: FACE_CHECK_BUDGET_MS, estimateS: 50,
      extract: src.extract, detect: src.detect, scan: src.scan, now: src.now,
    });
    // 100 s at an estimated 50 s a frame: 2 frames first; then 5 s a frame for what's left.
    assert.equal(src.calls[0]!.length, 2);
    assert.ok(src.calls[1]!.length >= 17, JSON.stringify(src.calls.map((c) => c.length)));
    assert.equal(out.progress.done, 20);
  });

  it("a stalled ffmpeg run ends the slice and keeps what it checked", async () => {
    const plan = plan30();
    const src = fakeSource({ fps: 30, lastFrame: 899, perFrameS: 15 });
    let calls = 0;
    const out = await runFaceCheckSlice({
      progress: newProgress(plan), durationS: 30, sliceEnd: FACE_CHECK_SLICE_MS, deadline: FACE_CHECK_BUDGET_MS, estimateS: 15, maxBatch: 10,
      extract: async (frames) => {
        calls += 1;
        if (calls === 2) throw Object.assign(new Error("Command failed: ffmpeg"), { killed: true, signal: "SIGTERM" });
        return src.extract(frames);
      },
      detect: src.detect, scan: src.scan, now: src.now,
    });
    assert.deepEqual([out.status, out.stopped, out.madeProgress, out.progress.done], ["parked", "stall", true, 10]);
    // Any other error is the clip's failure, as before.
    await assert.rejects(runFaceCheckSlice({
      progress: newProgress(plan), durationS: 30, sliceEnd: FACE_CHECK_SLICE_MS, deadline: FACE_CHECK_BUDGET_MS, estimateS: 15,
      extract: async () => { throw new Error("Invalid data found when processing input"); },
      detect: src.detect, scan: src.scan, now: src.now,
    }), /Invalid data/);
  });

  it("a slice that runs out before its first frame checks nothing: no progress", async () => {
    const src = fakeSource({ fps: 30, lastFrame: 899, perFrameS: 15, extractS: 500 });
    const out = await runFaceCheckSlice({
      progress: newProgress(plan30()), durationS: 30, sliceEnd: FACE_CHECK_SLICE_MS, deadline: FACE_CHECK_BUDGET_MS, estimateS: 15,
      extract: src.extract, detect: src.detect, scan: src.scan, now: src.now,
    });
    assert.deepEqual([out.status, out.madeProgress, out.progress.done], ["parked", false, 0]);
  });

  it("a clip shorter than its window: the missing frames are tried once, a scan fills the gap, across slices", async () => {
    // 1 s of frames (30) in a 2 s window.
    const times = sampleTimes(2, FACE_SAMPLING, 11);
    const plan = planFrames(times, 30, 2).map((p) => p.frame);
    const src = fakeSource({ fps: 30, lastFrame: 29, perFrameS: 15 });
    const { progress } = await runToEnd(newProgress(plan), src, 2, 60_000);
    const done = finishedSamples(progress, 2);
    assert.equal(done.scanned, true);
    assert.equal(done.hole, false);
    assert.ok(done.largestGapS <= FACE_MAX_GAP_S + 1e-9, String(done.largestGapS));
    assert.ok(progress.frames.length >= progress.planned);
  });
});

describe("a face check across ticks (lock, park, resume)", () => {
  it("a parked check holds the lock: it reads as checking, Retry leaves it, another clip waits", async () => {
    const fake = fakeDb({ creative_lab_clips: [clip("c1"), clip("c2")] });
    const claim = await claimFaceCheck(asDb(fake), "c1", NOW);
    assert.ok(claim.ok);
    const progress = { ...newProgress(plan30()), done: 30, samples: [{ t: 0, faces: [] }] };
    assert.equal(await parkFaceCheck(asDb(fake), "c1", { stamp: claim.stamp, attempt: claim.attempt, since: claim.stamp }, base, progress, true, at(460_000)), true);
    const stored = readFaceSamples(fake.tables.creative_lab_clips[0]!.face_samples);
    assert.equal(stored?.running?.parked, true);
    assert.equal(stored?.running?.attempt, 0);
    assert.equal(stored?.running?.until, at(460_000 + FACE_CHECK_LOCK_MS).toISOString());
    // Partial samples are never ready, for every reader (they all go through faceSampleState).
    assert.equal(faceSampleState(stored, window), "checking");
    assert.equal(faceSampleState({ ...stored!, samples: progress.samples }, window), "checking");
    const { clearFaceSamples } = await import("../face-samples.ts");
    assert.equal(await clearFaceSamples(asDb(fake), "c1", "op", at(500_000)), "running");
    assert.deepEqual(await claimFaceCheck(asDb(fake), "c2", at(500_000)), { ok: false, reason: "busy" });
  });

  it("the next tick resumes a parked check with its progress, same since, try 1, and finishes it", async () => {
    const fake = fakeDb({ creative_lab_clips: [clip("c1")] });
    const first = await claimFaceCheck(asDb(fake), "c1", NOW);
    assert.ok(first.ok && first.progress === null);
    const src = fakeSource({ fps: 30, lastFrame: 899, perFrameS: 15 });
    const run = (progress: FaceCheckProgress) => {
      const start = src.now();
      return runFaceCheckSlice({ progress, durationS: 30, sliceEnd: start + FACE_CHECK_SLICE_MS, deadline: start + FACE_CHECK_BUDGET_MS, estimateS: 15, extract: src.extract, detect: src.detect, scan: src.scan, now: src.now });
    };
    const one = await run(newProgress(plan30()));
    await parkFaceCheck(asDb(fake), "c1", { stamp: first.stamp, attempt: first.attempt, since: first.stamp }, base, one.progress, one.madeProgress, at(460_000));
    // A slice is still running from the next tick's view only until it parks: now it's resumable at once.
    const second = await claimFaceCheck(asDb(fake), "c1", at(480_000));
    assert.ok(second.ok);
    assert.equal(second.attempt, 1);
    assert.equal(second.progress?.done, one.progress.done);
    assert.deepEqual(second.progress?.frames, plan30());
    const running = readFaceSamples(fake.tables.creative_lab_clips[0]!.face_samples)!.running!;
    assert.equal(running.since, NOW.toISOString());
    assert.equal(running.parked, undefined);
    // While that slice runs, the clip is locked to everyone else.
    assert.deepEqual(await claimFaceCheck(asDb(fake), "c1", at(540_000)), { ok: false, reason: "locked" });
    const two = await run(second.progress!);
    await parkFaceCheck(asDb(fake), "c1", { stamp: second.stamp, attempt: second.attempt, since: running.since }, base, two.progress, two.madeProgress, at(940_000));
    const third = await claimFaceCheck(asDb(fake), "c1", at(960_000));
    assert.ok(third.ok);
    const last = await run(third.progress!);
    assert.equal(last.status, "done");
    const done = finishedSamples(last.progress, 30);
    assert.equal(await finishFaceCheck(asDb(fake), "c1", third, { ...base, samples: done.samples }, at(1_400_000)), true);
    const stored = readFaceSamples(fake.tables.creative_lab_clips[0]!.face_samples);
    assert.equal(stored?.running, undefined);
    assert.equal(stored?.samples?.length, plan30().length);
    assert.equal(faceSampleState(stored, window), "ready");
  });

  it("counts slices that made no progress as tries: two in a row fail the clip", async () => {
    const fake = fakeDb({ creative_lab_clips: [clip("c1")] });
    const progress = { ...newProgress(plan30()), done: 40 };
    let claim = await claimFaceCheck(asDb(fake), "c1", NOW);
    assert.ok(claim.ok && claim.attempt === 1);
    await parkFaceCheck(asDb(fake), "c1", { stamp: claim.stamp, attempt: claim.attempt, since: claim.stamp }, base, progress, true, at(1_000));
    // Progress made: the next claim is try 1 again. Then a slice that checks nothing keeps its try counted.
    claim = await claimFaceCheck(asDb(fake), "c1", at(2_000));
    assert.ok(claim.ok && claim.attempt === 1);
    await parkFaceCheck(asDb(fake), "c1", { stamp: claim.stamp, attempt: claim.attempt, since: NOW.toISOString() }, base, progress, false, at(3_000));
    claim = await claimFaceCheck(asDb(fake), "c1", at(4_000));
    assert.ok(claim.ok && claim.attempt === 2);
    await parkFaceCheck(asDb(fake), "c1", { stamp: claim.stamp, attempt: claim.attempt, since: NOW.toISOString() }, base, progress, false, at(5_000));
    const out = await claimFaceCheck(asDb(fake), "c1", at(6_000));
    assert.deepEqual(out, { ok: false, reason: "timed_out" });
    const stored = readFaceSamples(fake.tables.creative_lab_clips[0]!.face_samples);
    assert.equal(stored?.error, `${FACE_CHECK_TIMED_OUT} (${FACE_CHECK_MAX_ATTEMPTS} tries without progress, 40 of ${plan30().length} frames)`);
    assert.equal(faceSampleState(stored, window), "failed");
  });

  it("a slice killed after progress is a try; a second killed slice in a row fails the clip; progress is kept until then", async () => {
    const fake = fakeDb({ creative_lab_clips: [clip("c1")] });
    let claim = await claimFaceCheck(asDb(fake), "c1", NOW);
    assert.ok(claim.ok);
    await parkFaceCheck(asDb(fake), "c1", { stamp: claim.stamp, attempt: claim.attempt, since: claim.stamp }, base, { ...newProgress(plan30()), done: 30 }, true, at(460_000));
    claim = await claimFaceCheck(asDb(fake), "c1", at(480_000)); // this slice is killed: it never parks
    assert.ok(claim.ok && claim.attempt === 1);
    claim = await claimFaceCheck(asDb(fake), "c1", at(480_000 + FACE_CHECK_LOCK_MS + 1));
    assert.ok(claim.ok && claim.attempt === 2 && claim.progress?.done === 30);
    assert.deepEqual(await claimFaceCheck(asDb(fake), "c1", at(480_000 + 2 * FACE_CHECK_LOCK_MS + 2)), { ok: false, reason: "timed_out" });
  });

  it("a crop change while parked starts the new crop's plan from zero", async () => {
    const fake = fakeDb({ creative_lab_clips: [clip("c1")] });
    const claim = await claimFaceCheck(asDb(fake), "c1", NOW);
    assert.ok(claim.ok);
    await parkFaceCheck(asDb(fake), "c1", { stamp: claim.stamp, attempt: claim.attempt, since: claim.stamp }, base, { ...newProgress(plan30()), done: 30 }, true, at(1_000));
    fake.tables.creative_lab_clips[0]!.crop_focus_x = 0.3;
    const next = await claimFaceCheck(asDb(fake), "c1", at(2_000));
    assert.ok(next.ok);
    assert.deepEqual([next.attempt, next.progress], [1, null]);
  });

  it("a park or finish under a lost claim writes nothing", async () => {
    const fake = fakeDb({ creative_lab_clips: [clip("c1")] });
    const claim = await claimFaceCheck(asDb(fake), "c1", NOW);
    assert.ok(claim.ok);
    fake.tables.creative_lab_clips[0]!.face_samples_at = "2026-11-17T18:00:00.000Z";
    const before = structuredClone(fake.tables.creative_lab_clips[0]);
    assert.equal(await parkFaceCheck(asDb(fake), "c1", { stamp: claim.stamp, attempt: 1, since: claim.stamp }, base, newProgress([1]), true, at(1_000)), false);
    assert.equal(await finishFaceCheck(asDb(fake), "c1", claim, { ...base, samples: [{ t: 0, faces: [] }] }, at(1_000)), false);
    assert.deepEqual(fake.tables.creative_lab_clips[0], before);
  });

  it("the render tick resumes the parked check before starting another clip's, and passes its progress", async () => {
    const { runRenderTick } = await import("../render-queue.ts");
    const fake = fakeDb({
      creative_lab_clips: [clip("c1"), clip("c2")],
      creative_lab_renders: [
        { id: "r2", status: "queued", created_at: "2026-11-17T01", caption_id: "cap", clip_id: "c2", user_id: "op" },
        { id: "r1", status: "queued", created_at: "2026-11-17T02", caption_id: "cap", clip_id: "c1", user_id: "op" },
      ],
      creative_lab_captions: [{ id: "cap", event_id: "evt" }],
      creative_lab_round_ads: [],
      creative_lab_rounds: [],
    });
    const claim = await claimFaceCheck(asDb(fake), "c1", NOW);
    assert.ok(claim.ok);
    await parkFaceCheck(asDb(fake), "c1", { stamp: claim.stamp, attempt: claim.attempt, since: claim.stamp }, base, { ...newProgress(plan30()), done: 30 }, true, at(460_000));
    const seen: { id: string; done: number | undefined }[] = [];
    const result = await runRenderTick(asDb(fake), {
      now: at(480_000), archivedEventIds: new Set(), render: async () => {},
      detect: async (_db, id, c) => (seen.push({ id, done: c.progress?.done }), "checking" as const),
    });
    assert.deepEqual(seen, [{ id: "c1", done: 30 }]);
    assert.equal(result.claimed, 0);
  });
});

// The real binary, when ffmpeg-static has one for this platform (CI and the scripts).
const ffmpeg = (() => {
  try {
    const resolved = createRequire(import.meta.url)("ffmpeg-static") as string | null;
    return resolved && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
})();

describe("slices on real ffmpeg give the times of one full pull", { skip: ffmpeg ? false : "no ffmpeg-static binary" }, () => {
  const make = (dir: string, name: string, extra: string[]) => {
    const file = path.join(dir, name);
    execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", ...extra, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file]);
    return file;
  };
  const within = async (body: (dir: string) => Promise<void>) => {
    const dir = mkdtempSync(path.join(tmpdir(), "face-slices-"));
    try {
      await body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  /** Slices of about four frames each (a fake clock that only detection moves), with the real extract and scan. */
  const sliced = async (dir: string, url: string, inS: number, outS: number, times: number[], sourceFps: number) => {
    const durationS = outS - inS;
    let progress = newProgress(planFrames(times, sourceFps, durationS).map((p) => p.frame));
    let clock = 0;
    let batch = 0;
    const work = mkdtempSync(path.join(dir, "s-"));
    for (let i = 0; i < 200; i += 1) {
      const out = await runFaceCheckSlice({
        progress, durationS, sliceEnd: clock + 4_000, deadline: clock + 600_000, estimateS: 1, maxBatch: 3, now: () => clock,
        extract: (frames) => extractFaceFrames({ ffmpeg: ffmpeg!, url, inS, outS, frames, dir: work, side: 64, timeoutMs: 60_000, prefix: `x${batch++}_` }),
        scan: () => scanFrameTimes({ ffmpeg: ffmpeg!, url, inS, outS, timeoutMs: 60_000 }),
        detect: async () => ((clock += 1_000), []),
      });
      progress = readProgress(JSON.parse(JSON.stringify(out.progress)))!;
      if (out.status === "done") return { progress, slices: progress.slices, done: finishedSamples(progress, durationS) };
    }
    throw new Error("never finished");
  };
  const full = (dir: string, url: string, inS: number, outS: number, times: number[], sourceFps: number) =>
    pullFaceFrames({ ffmpeg: ffmpeg!, url, inS, outS, times, sourceFps, dir: mkdtempSync(path.join(dir, "f-")), side: 64, deadline: Date.now() + 60_000 });
  const same = (a: number[], b: number[]) => {
    assert.equal(a.length, b.length, `${a.length} vs ${b.length}`);
    a.forEach((t, i) => assert.ok(Math.abs(t - b[i]!) < 1e-4, `${i}: ${t} vs ${b[i]}`));
  };

  it("a constant-rate clip at 25, 30 and 60 fps, seeked in: the same frame times, in several slices", () =>
    within(async (dir) => {
      for (const fps of [25, 30, 60]) {
        const file = make(dir, `cfr-${fps}.mp4`, ["-f", "lavfi", "-i", `testsrc=size=64x64:rate=${fps}:duration=6`]);
        const times = sampleTimes(4, FACE_SAMPLING, 7 + fps);
        const one = await full(dir, file, 1, 5, times, fps);
        const many = await sliced(dir, file, 1, 5, times, fps);
        assert.ok(many.slices > 2, `${fps} fps: ${many.slices} slices`);
        same(many.done.samples.map((s) => s.t), one.frames.map((f) => f.t));
        assert.ok(many.done.largestGapS <= FACE_MAX_GAP_S + 1e-3, `${fps} fps: ${many.done.largestGapS}`);
      }
    }));

  it("a clip shorter than its window and a variable-rate one: the same frames, gaps filled across slices", () =>
    within(async (dir) => {
      const short = make(dir, "short.mp4", ["-f", "lavfi", "-i", "testsrc=size=64x64:rate=30:duration=1"]);
      const shortTimes = sampleTimes(2, FACE_SAMPLING, 11);
      const a1 = await full(dir, short, 0, 2, shortTimes, 30);
      const a2 = await sliced(dir, short, 0, 2, shortTimes, 30);
      same(a2.done.samples.map((s) => s.t), a1.frames.map((f) => f.t));
      assert.equal(a2.done.scanned, true);
      assert.ok(Math.abs(a2.done.largestGapS - a1.largestGapS) < 1e-4);
      const vfr = make(dir, "vfr.mp4", [
        "-f", "lavfi", "-i", "testsrc=size=64x64:rate=30", "-frames:v", "40",
        "-vf", "setpts='if(lt(N,30),N/30,1+(N-30)/10)/TB'", "-fps_mode", "vfr",
      ]);
      const vfrTimes = sampleTimes(2, FACE_SAMPLING, 5);
      const b1 = await full(dir, vfr, 0, 2, vfrTimes, 20);
      const b2 = await sliced(dir, vfr, 0, 2, vfrTimes, 20);
      same(b2.done.samples.map((s) => s.t), b1.frames.map((f) => f.t));
      assert.equal(b2.done.hole, false);
      assert.ok(b2.done.largestGapS <= FACE_MAX_GAP_S + 1e-3, String(b2.done.largestGapS));
    }));
});

describe("the budget numbers", () => {
  it("a slice stops well inside the ffmpeg budget, which is inside the function's 800 s; the lock outlives both", () => {
    assert.ok(FACE_CHECK_SLICE_MS + 60_000 < FACE_CHECK_BUDGET_MS);
    assert.ok(FACE_CHECK_BUDGET_MS < 800_000 && FACE_CHECK_LOCK_MS > 800_000);
    assert.equal(largestGap([], 0, 1), 1);
  });
});
