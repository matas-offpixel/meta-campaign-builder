// The face check's frame pull (review of 7d4cca1): a sample in the window's final half-frame must not ask
// ffmpeg for a frame that doesn't exist, and a short return (a variable-frame-rate clip) keeps the frames
// that came back with their own times instead of failing the check for good.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { FACE_SAMPLING } from "../caption-placement.ts";
import { extractFaceFrames, pairFrames, showinfoTimes } from "../face-frames.ts";
import { faceSampleSeed, sampleTimes, snapToFrames } from "../face-sampling.ts";

describe("snapToFrames clamps to the window's last frame", () => {
  for (const fps of [25, 30, 60]) {
    it(`a last sample in the final half-frame at ${fps} fps picks frame ceil(D·fps) − 1, not ceil(D·fps)`, () => {
      const d = 10;
      const lastFrame = Math.ceil(d * fps) - 1;
      const picks = snapToFrames([0, 5, d - 0.4 / fps], fps, d);
      assert.equal(picks.at(-1)!.frame, lastFrame);
      // Unclamped, the same time asks for the frame past the end.
      assert.equal(snapToFrames([d - 0.4 / fps], fps).at(-1)!.frame, lastFrame + 1);
    });
  }

  it("no pick is past the end over 2,000 seeded windows of 5–30 s at 25, 29.97, 30, 59.94 and 60 fps", () => {
    for (const fps of [25, 30000 / 1001, 30, 60000 / 1001, 60]) {
      for (let i = 0; i < 2_000; i += 1) {
        const d = 5 + ((i * 7919) % 2_500) / 100;
        const times = sampleTimes(d, FACE_SAMPLING, faceSampleSeed({ id: `w${i}`, cropFocusX: 0.5, cropFocusY: 0.5, inS: 0, outS: d }));
        const picks = snapToFrames(times, fps, d);
        assert.ok(picks.every((p) => p.frame <= Math.ceil(d * fps - 1e-9) - 1), `${fps} fps, ${d} s`);
        assert.equal(new Set(picks.map((p) => p.frame)).size, picks.length);
      }
    }
  });
});

describe("pairing the frames ffmpeg wrote with their times", () => {
  it("a short return keeps what came back, with ffmpeg's own times", () => {
    assert.deepEqual(pairFrames(["s0001.png", "s0002.png", "s0003.png"], [0, 0.4, 0.9], 5), [
      { file: "s0001.png", t: 0 },
      { file: "s0002.png", t: 0.4 },
      { file: "s0003.png", t: 0.9 },
    ]);
  });

  it("none, more than asked, or times that don't pair up is an error", () => {
    assert.throws(() => pairFrames([], [], 5), /0 of 5/);
    assert.throws(() => pairFrames(["a", "b"], [0, 1], 1), /2 frames for 1/);
    assert.throws(() => pairFrames(["a", "b"], [0], 2), /1 frame times for 2/);
  });

  it("reads pts_time from showinfo lines only", () => {
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

describe("extractFaceFrames with ffmpeg-static", { skip: ffmpeg ? false : "no ffmpeg-static binary" }, () => {
  const make = (dir: string, name: string, extra: string[]) => {
    const file = path.join(dir, name);
    execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", ...extra, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file]);
    return file;
  };
  const pull = async (dir: string, url: string, inS: number, outS: number, frames: number[]) => {
    const out = mkdtempSync(path.join(dir, "frames-"));
    return extractFaceFrames({ ffmpeg: ffmpeg!, url, inS, outS, frames, dir: out, side: 64, timeoutMs: 60_000 });
  };

  it("a window's last sample in its final half-frame comes back, clamped, at 25, 30 and 60 fps", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "face-frames-"));
    try {
      for (const fps of [25, 30, 60]) {
        const file = make(dir, `cfr-${fps}.mp4`, ["-f", "lavfi", "-i", `testsrc=size=64x64:rate=${fps}:duration=3`]);
        const d = 1;
        const picks = snapToFrames([0, 0.5, d - 0.4 / fps], fps, d);
        const got = await pull(dir, file, 1, 1 + d, picks.map((p) => p.frame));
        assert.equal(got.length, picks.length, `${fps} fps`);
        got.forEach((g, i) => assert.ok(Math.abs(g.t - picks[i]!.t) < 0.5 / fps, `${fps} fps: ${g.t} vs ${picks[i]!.t}`));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a variable-frame-rate clip returns fewer frames than its average rate implies; each keeps its real time", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "face-frames-"));
    try {
      mkdirSync(dir, { recursive: true });
      // 30 frames in the first second, then 10 a second for 1 s: 40 frames in 2 s, an average of 20 fps.
      const file = make(dir, "vfr.mp4", [
        "-f", "lavfi", "-i", "testsrc=size=64x64:rate=30",
        "-frames:v", "40",
        "-vf", "setpts='if(lt(N,30),N/30,1+(N-30)/10)/TB'",
        "-fps_mode", "vfr",
      ]);
      // The second half at the average rate (20 fps) asks for frames 0–19; it holds 10.
      const picks = snapToFrames([0, 0.3, 0.65, 0.95], 20, 1);
      const got = await pull(dir, file, 1, 2, picks.map((p) => p.frame));
      assert.ok(got.length >= 1 && got.length < picks.length, `${got.length} of ${picks.length}`);
      for (const g of got) assert.ok(Math.abs(g.t * 10 - Math.round(g.t * 10)) < 1e-3, `real time ${g.t} is on the 10 fps grid`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
