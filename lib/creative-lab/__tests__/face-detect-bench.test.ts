// The face check's timing samples (Matas, 17 Nov 2026): one frame a slice on every candidate backend and
// size, logged, never changing the real detection, never failing the check, and inside the slice's budget.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import sharp from "sharp";

import { FACE_CHECK_BUDGET_MS, FACE_CHECK_SLICE_MS, FACE_SAMPLING } from "../caption-placement.ts";
import { newProgress, runFaceCheckSlice } from "../face-check-slice.ts";
import { benchChildPath, benchFrame, benchLine, FACE_BENCH_CANDIDATES, minIou, TFJS_NODE_NOT_SHIPPED } from "../face-detect-bench.ts";
import { faceApiModelDir } from "../face-detect.ts";
import { planFrames, sampleTimes } from "../face-sampling.ts";

const grey = () => sharp({ create: { width: 640, height: 360, channels: 3, background: "#808080" } }).png().toBuffer();
const dir = () => mkdtempSync(join(tmpdir(), "face-bench-"));

describe("timing samples (face-detect-bench.ts)", () => {
  it("covers today's cpu 640 px as the baseline, cpu at 512 and 416, wasm and tfjs-node", () => {
    assert.deepEqual(FACE_BENCH_CANDIDATES.map((c) => `${c.backend}-${c.side}`), ["cpu-640", "cpu-512", "cpu-416", "wasm-640", "tfjs-node-640"]);
  });

  it("loads the wasm backend with SIMD in its own process and times a frame; tfjs-node logs as not loaded", async () => {
    const results = await benchFrame({
      frame: await grey(),
      dir: dir(),
      modelDir: faceApiModelDir(),
      deadline: Date.now() + 120_000,
      detectCpu: async () => [],
      candidates: FACE_BENCH_CANDIDATES.filter((c) => c.backend !== "cpu" || c.side === 640),
    });
    const wasm = results.find((r) => r.backend === "wasm")!;
    assert.equal(wasm.loaded, true, JSON.stringify(wasm));
    assert.equal(wasm.simd, true);
    assert.equal(typeof wasm.seconds, "number");
    assert.equal(wasm.faces, 0);
    const node = results.find((r) => r.backend === "tfjs-node")!;
    assert.equal(node.loaded, false);
    assert.equal(node.error, TFJS_NODE_NOT_SHIPPED);
    assert.match(benchLine(results, { slice: 1, t: 0 }), /tfjs-node 640 px: not loaded \(not shipped: 401 MB native library over the 250 MB cap\)/);
  });

  it("never throws: a child that can't start and a cpu run that fails are results, and the rest still run", async () => {
    const results = await benchFrame({
      frame: await grey(),
      dir: dir(),
      modelDir: faceApiModelDir(),
      deadline: Date.now() + 30_000,
      childPath: "/nowhere/face-bench-child.cjs",
      detectCpu: async (_frame, side) => {
        if (side === 512) throw new Error("boom");
        return [{ x: 10, y: 10, width: 50, height: 50 }];
      },
    });
    assert.equal(results.length, FACE_BENCH_CANDIDATES.length);
    assert.deepEqual(results.map((r) => r.loaded), [true, false, true, false, false]);
    assert.match(results[1]!.error!, /boom/);
    const line = benchLine(results, { slice: 2, t: 4.2 });
    assert.match(line, /^timing sample, slice 2, frame at 4\.20 s: cpu 640 px: [\d.]+ s, 1 faces, baseline · cpu 512 px: not loaded \(boom\)/);
    assert.match(line, /wasm 640 px: not loaded/);
    // A missing child script is its own error, not "not shipped".
    assert.match(line, /tfjs-node 640 px: not loaded \((?!not shipped)/);
  });

  it("prefers the traced child script under the working directory (the Vercel function)", () => {
    assert.equal(benchChildPath("/var/task", (p) => p === "/var/task/lib/creative-lab/face-bench-child.cjs"), "/var/task/lib/creative-lab/face-bench-child.cjs");
    assert.ok(benchChildPath("/nowhere", () => false).endsWith(join("lib", "creative-lab", "face-bench-child.cjs")));
  });

  it("scores agreement as each baseline face's best IoU", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    assert.equal(minIou([a], [a]), 1);
    assert.equal(minIou([a], []), 0);
    assert.equal(minIou([], []), null);
    assert.ok(Math.abs(minIou([a], [{ x: 5, y: 0, width: 10, height: 10 }])! - 1 / 3) < 1e-9);
  });
});

describe("timing samples inside a slice (face-check-slice.ts)", () => {
  const plan = planFrames(sampleTimes(30, FACE_SAMPLING, 7), 30, 30).map((p) => p.frame);
  const source = (perFrameS: number) => {
    let clock = 0;
    return {
      now: () => clock,
      advance: (ms: number) => void (clock += ms),
      extract: async (frames: readonly number[]) => frames.map((n) => ({ file: `f${n}`, t: n / 30 })),
      detect: async (file: string) => ((clock += perFrameS * 1000), Number(file.slice(1)) % 5 === 0 ? [{ left: 1, top: 2, width: 3, height: 4 }] : []),
      scan: async () => [],
    };
  };
  const slice = (src: ReturnType<typeof source>, bench?: Parameters<typeof runFaceCheckSlice>[0]["bench"], sliceEnd = FACE_CHECK_SLICE_MS) =>
    runFaceCheckSlice({ progress: newProgress(plan), durationS: 30, sliceEnd, deadline: FACE_CHECK_BUDGET_MS, estimateS: 15, extract: src.extract, detect: src.detect, scan: src.scan, now: src.now, ...(bench ? { bench } : {}) });

  it("runs once a slice, after its first real frame, and its time counts in the slice: fewer frames, never past the end", async () => {
    const plain = await slice(source(15));
    const src = source(15);
    const ran: string[] = [];
    const out = await slice(src, { frames: 3, overheadS: 30, run: async (file) => void (ran.push(file), src.advance(75_000)) });
    assert.deepEqual(ran, [`f${plan[0]}`]);
    assert.ok(out.progress.done < plain.progress.done, `${out.progress.done} vs ${plain.progress.done}`);
    assert.ok(src.now() <= FACE_CHECK_SLICE_MS + 15_000, String(src.now()));
  });

  it("never changes the samples: the frames checked carry the same faces with or without it", async () => {
    const plain = await slice(source(15), undefined, 1e12);
    const src = source(15);
    const sampled = await slice(src, { frames: 3, overheadS: 30, run: async () => void src.advance(75_000) }, 1e12);
    assert.deepEqual(sampled.progress.samples, plain.progress.samples);
    assert.equal(sampled.status, "done");
  });

  it("is skipped when the time left doesn't cover it, and a sample that throws doesn't fail the slice", async () => {
    let ran = 0;
    // 40 s left after the first frame; 3 frames at 15 s plus 30 s won't fit.
    const out = await slice(source(15), { frames: 3, overheadS: 30, run: async () => void (ran += 1) }, 55_000);
    assert.equal(ran, 0);
    assert.equal(out.status, "parked");
    const failing = await slice(source(15), { frames: 3, overheadS: 30, run: async () => { throw new Error("child crashed"); } });
    assert.equal(failing.status, "parked");
    assert.ok(failing.progress.done > 0);
  });
});
