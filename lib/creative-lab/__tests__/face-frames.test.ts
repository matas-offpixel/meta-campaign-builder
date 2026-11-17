// The face check's frames (design, 17 Nov): no gap between checked frames over 0.4 s, window start and end
// included, so the 0.5 s run rule holds. Picks never go past the window's last frame (review of 7d4cca1), a
// short return keeps what came back, and a gap left by a short or variable-frame-rate source is filled from the
// window's real frames. Where the source has no frame at all, the check still finishes and reports the gap.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { FACE_SAMPLING } from "../caption-placement.ts";
import { fillGaps, pairFrames, pullFaceFrames, showinfoTimes } from "../face-frames.ts";
import { FACE_MAX_GAP_S, faceSampleSeed, largestGap, planFrames, sampleTimes } from "../face-sampling.ts";

const RATES = [25, 30000 / 1001, 30, 60000 / 1001, 60];

describe("planFrames: no gap over 0.4 s, nothing past the last frame", () => {
  for (const fps of [25, 30, 60]) {
    it(`a last sample in the final half-frame at ${fps} fps picks frame ceil(D·fps) − 1, not ceil(D·fps)`, () => {
      const d = 10;
      // 0.35 s apart, the last 0.4 of a frame before the window end.
      const times = [0];
      for (let t = d - 0.4 / fps; t > 0.01; t -= 0.35) times.splice(1, 0, t);
      const plan = planFrames(times, fps, d);
      assert.equal(plan.at(-1)!.frame, Math.ceil(d * fps) - 1);
      assert.ok(largestGap(plan.map((p) => p.t), 0, d) <= FACE_MAX_GAP_S + 1e-9);
    });
  }

  it("a window ending mid-gap: the last pick is within 0.4 s of the window end", () => {
    // The scheme's next sample would fall past the end; the gap from the last one to the end is 0.45 s.
    const plan = planFrames([0, 0.35, 0.7], 30, 1.15);
    assert.ok(1.15 - plan.at(-1)!.t <= FACE_MAX_GAP_S + 1e-9, JSON.stringify(plan));
    assert.equal(plan.length, 4);
  });

  it("over 2,000 seeded windows of 5–30 s at 25, 29.97, 30, 59.94 and 60 fps: largest gap ≤ 0.4 s, at most one pick added", () => {
    for (const fps of RATES) {
      for (let i = 0; i < 2_000; i += 1) {
        const d = 5 + ((i * 7919) % 2_500) / 100;
        const times = sampleTimes(d, FACE_SAMPLING, faceSampleSeed({ id: `w${i}`, cropFocusX: 0.5, cropFocusY: 0.5, inS: 0, outS: d }));
        const plan = planFrames(times, fps, d);
        const label = `${fps.toFixed(2)} fps, ${d} s, seed w${i}`;
        assert.ok(largestGap(plan.map((p) => p.t), 0, d) <= FACE_MAX_GAP_S + 1e-9, label);
        assert.ok(plan.every((p, k) => p.frame <= Math.ceil(d * fps - 1e-9) - 1 && (k === 0 || p.frame > plan[k - 1]!.frame)), label);
        assert.ok(plan.length <= times.length + 1, label);
      }
    }
  });
});

describe("filling a gap from the window's real frames", () => {
  const every = (from: number, to: number, step: number) => {
    const out: { n: number; t: number }[] = [];
    for (let t = from; t <= to + 1e-9; t += step) out.push({ n: out.length, t: Math.round(t * 1000) / 1000 });
    return out;
  };

  it("adds the latest real frame within 0.4 s, until every gap is under it", () => {
    const real = every(0, 2, 0.1);
    const add = fillGaps([0, 1.0], real, 0, 2);
    const kept = [0, 1.0, ...add.map((a) => a.t)].sort((a, b) => a - b);
    assert.deepEqual(add.map((a) => a.t), [0.4, 0.8, 1.4, 1.8]);
    assert.ok(largestGap(kept, 0, 2) <= FACE_MAX_GAP_S + 1e-9);
  });

  it("a hole in the source: adds the first frame after it and leaves only the hole over 0.4 s", () => {
    const real = [...every(0, 0.5, 0.1), ...every(1.5, 2, 0.1)];
    const add = fillGaps([0], real, 0, 2);
    const kept = [0, ...add.map((a) => a.t)].sort((a, b) => a - b);
    assert.ok(Math.abs(largestGap(kept, 0, 2) - 1.0) < 1e-9);
    const gaps = kept.slice(1).map((t, i) => [kept[i]!, t] as const).filter(([a, b]) => b - a > FACE_MAX_GAP_S + 1e-9);
    assert.deepEqual(gaps, [[0.5, 1.5]]);
  });
});

describe("pairing the frames ffmpeg wrote with their times", () => {
  it("a short return keeps what came back, with ffmpeg's own times; none is an empty pull", () => {
    assert.deepEqual(pairFrames(["s0001.png", "s0002.png"], [0, 0.4], 5), [
      { file: "s0001.png", t: 0 },
      { file: "s0002.png", t: 0.4 },
    ]);
    assert.deepEqual(pairFrames([], [], 5), []);
  });

  it("more than asked, or times that don't pair up, is an error", () => {
    assert.throws(() => pairFrames(["a", "b"], [0, 1], 1), /2 frames for 1/);
    assert.throws(() => pairFrames(["a", "b"], [0], 2), /1 frame times for 2/);
  });

  it("reads pts_time from showinfo frame lines only", () => {
    const stderr = [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':",
      "[Parsed_showinfo_1 @ 0x6000] n:   0 pts:      0 pts_time:0       duration:  512 fmt:yuv420p",
      "[Parsed_showinfo_1 @ 0x6000] n:   1 pts:  76800 pts_time:5       duration:  512 fmt:yuv420p",
      "[Parsed_showinfo_1 @ 0x6000] color_range:tv color_space:bt709",
      "[Parsed_showinfo_1 @ 0x6000] n:   2 pts: 153088 pts_time:9.96667 duration:  512 fmt:yuv420p",
    ].join("\n");
    assert.deepEqual(showinfoTimes(stderr), [0, 5, 9.96667]);
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

describe("pullFaceFrames with ffmpeg-static", { skip: ffmpeg ? false : "no ffmpeg-static binary" }, () => {
  const make = (dir: string, name: string, extra: string[]) => {
    const file = path.join(dir, name);
    execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", ...extra, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file]);
    return file;
  };
  const pull = (dir: string, url: string, inS: number, outS: number, times: number[], sourceFps: number) =>
    pullFaceFrames({ ffmpeg: ffmpeg!, url, inS, outS, times, sourceFps, dir: mkdtempSync(path.join(dir, "f-")), side: 64, deadline: Date.now() + 60_000 });
  const within = async (body: (dir: string) => Promise<void>) => {
    const dir = mkdtempSync(path.join(tmpdir(), "face-frames-"));
    try {
      await body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("a window whose last sample is in its final half-frame, at 25, 30 and 60 fps: every frame comes back, gap ≤ 0.4 s", () =>
    within(async (dir) => {
      for (const fps of [25, 30, 60]) {
        const file = make(dir, `cfr-${fps}.mp4`, ["-f", "lavfi", "-i", `testsrc=size=64x64:rate=${fps}:duration=3`]);
        const got = await pull(dir, file, 1, 2, [0, 0.35, 0.7, 1 - 0.4 / fps], fps);
        assert.equal(got.frames.length, got.requested, `${fps} fps`);
        assert.equal(got.scanned, false, `${fps} fps`);
        assert.ok(got.largestGapS <= FACE_MAX_GAP_S + 1e-3, `${fps} fps: ${got.largestGapS}`);
      }
    }));

  it("a clip shorter than its window: the frames it has, gap ≤ 0.4 s to its last frame, and the check finishes", () =>
    within(async (dir) => {
      const file = make(dir, "short.mp4", ["-f", "lavfi", "-i", "testsrc=size=64x64:rate=30:duration=1"]);
      const got = await pull(dir, file, 0, 2, sampleTimes(2, FACE_SAMPLING, 11), 30);
      assert.ok(got.frames.length > 0 && got.frames.length < got.requested);
      assert.equal(got.scanned, true);
      assert.equal(got.hole, false);
      assert.ok(got.largestGapS <= FACE_MAX_GAP_S + 1e-3, String(got.largestGapS));
    }));

  it("a variable-frame-rate clip with fewer frames than its average rate implies: gaps are filled to ≤ 0.4 s", () =>
    within(async (dir) => {
      // 30 frames a second for 1 s, then 10 a second for 1 s: 40 frames in 2 s, an average of 20 fps.
      const file = make(dir, "vfr.mp4", [
        "-f", "lavfi", "-i", "testsrc=size=64x64:rate=30", "-frames:v", "40",
        "-vf", "setpts='if(lt(N,30),N/30,1+(N-30)/10)/TB'", "-fps_mode", "vfr",
      ]);
      const got = await pull(dir, file, 0, 2, sampleTimes(2, FACE_SAMPLING, 5), 20);
      assert.equal(got.hole, false);
      assert.ok(got.largestGapS <= FACE_MAX_GAP_S + 1e-3, String(got.largestGapS));
      for (const f of got.frames.filter((x) => x.t > 1.05)) assert.ok(Math.abs(f.t * 10 - Math.round(f.t * 10)) < 1e-3, `real time ${f.t}`);
    }));

  it("a variable-frame-rate clip with a stretch of missing frames: finishes, reports the hole, every other gap ≤ 0.4 s", () =>
    within(async (dir) => {
      // 30 frames at 30 fps (0–0.967 s), none until 1.6 s, then 30 more at 30 fps (1.6–2.567 s).
      const file = make(dir, "hole.mp4", [
        "-f", "lavfi", "-i", "testsrc=size=64x64:rate=30", "-frames:v", "60",
        "-vf", "setpts='if(lt(N,30),N/30,1.6+(N-30)/30)/TB'", "-fps_mode", "vfr",
      ]);
      const got = await pull(dir, file, 0, 2.6, sampleTimes(2.6, FACE_SAMPLING, 3), 60 / 2.6);
      assert.equal(got.hole, true);
      assert.ok(Math.abs(got.largestGapS - (1.6 - 29 / 30)) < 0.01, String(got.largestGapS));
      const t = got.frames.map((f) => f.t);
      const long = t.slice(1).map((b, i) => [t[i]!, b] as const).filter(([a, b]) => b - a > FACE_MAX_GAP_S + 1e-3);
      assert.equal(long.length, 1);
      assert.ok(Math.abs(long[0]![0] - 29 / 30) < 0.01 && Math.abs(long[0]![1] - 1.6) < 0.01, JSON.stringify(long));
    }));
});
