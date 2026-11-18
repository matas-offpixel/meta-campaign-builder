// The gate for moving face detection to the wasm backend (Matas, 17 Nov 2026). On Vercel wasm took 0.48 s a
// frame against 14.6 s on cpu, and its one face frame matched (IoU 1.00). This checks more than one frame, on
// every CI run: the six photos face-api ships (MIT, already installed, so nothing of a client's is committed)
// as the face check sees frames (640 px), as shot and under club light — dark, coloured, far away. Each frame
// is detected with the production detectFaces on wasm, then on cpu (today's detector until this change), in
// the same process. Every face must match at IoU ≥ 0.95, and caption placement from the wasm samples must
// never land on a face that the cpu samples keep clear (0 worse), as #1324's sweep judged sizes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";

import sharp from "sharp";

import { FACE_SAMPLE_FPS, captionBoxesAt, placeFromStoredSamples } from "../caption-placement.ts";
import { detectFaces, faceApiTf, faceBackend, faceGeometry, type FaceBox } from "../face-detect.ts";
import { T1V_FACE, judgeFaceOverTime } from "../t1-face.ts";
import { cropWindow } from "../../../src/remotion/caption-style/profile.ts";

const DEMO = join(createRequire(import.meta.url).resolve("@vladmandic/face-api/package.json"), "..", "demo");
const PHOTOS = ["sample1.jpg", "sample2.jpg", "sample3.jpg", "sample4.jpg", "sample5.jpg", "sample6.jpg"];
const MIN_IOU = 0.95;

type Box = { x: number; y: number; width: number; height: number };
type Rect = { left: number; top: number; width: number; height: number };

/** One photo as the face check's frames: fit inside 640 px, as shot and under three kinds of club light. */
async function frames(photo: string): Promise<{ name: string; png: Buffer }[]> {
  const base = await sharp(readFileSync(join(DEMO, photo))).rotate().resize({ width: 640, height: 640, fit: "inside" }).removeAlpha().png().toBuffer();
  const { width = 640, height = 640 } = await sharp(base).metadata();
  const far = await sharp(base).resize({ width: Math.round(width * 0.45) }).toBuffer();
  return [
    { name: "as shot", png: base },
    { name: "dark stage", png: await sharp(base).modulate({ brightness: 0.35 }).png().toBuffer() },
    { name: "coloured light", png: await sharp(base).linear(0.8, 0).tint({ r: 255, g: 60, b: 210 }).png().toBuffer() },
    {
      name: "far away",
      png: await sharp({ create: { width, height, channels: 3, background: "#0b0b12" } })
        .composite([{ input: far, left: Math.round(width * 0.3), top: Math.round(height * 0.35) }])
        .png()
        .toBuffer(),
    },
  ];
}

function iou(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = x * y;
  return inter / (a.width * a.height + b.width * b.height - inter);
}
/** Each face against its best match on the other backend, both ways; 1 when neither found any. */
function agreement(a: readonly Box[], b: readonly Box[]): number {
  if (!a.length && !b.length) return 1;
  const best = (from: readonly Box[], to: readonly Box[]) => Math.min(...from.map((f) => Math.max(0, ...to.map((g) => iou(f, g)))));
  return Math.min(a.length ? best(a, b) : 0, b.length ? best(b, a) : 0);
}

const CAPTIONS: { name: string; lines: string[]; baseScale: number; kind: "caption" | "quote" }[] = [
  { name: "2 lines", lines: ["THE NIGHT EVERYONE", "IS TALKING ABOUT"], baseScale: 1, kind: "caption" },
  { name: "1 line", lines: ["LUKE DEAN"], baseScale: 1, kind: "caption" },
  { name: "3 lines", lines: ["TICKETS ON SALE", "FRIDAY 10AM", "LINK IN BIO"], baseScale: 1, kind: "caption" },
  { name: "long", lines: ["ONE NIGHT ONLY AT THE", "WAREHOUSE WITH SPECIAL", "GUESTS ALL NIGHT LONG"], baseScale: 0.75, kind: "caption" },
  { name: "quote", lines: ["“THE BEST NIGHT", "I'VE HAD ALL YEAR”"], baseScale: 1, kind: "quote" },
];

/** Frame boxes to 1080 × 1920 output pixels, as ensureClipFaces does (centre crop). */
function toOutput(boxes: readonly Box[], width: number, height: number): Rect[] {
  const crop = cropWindow(width, height, 0.5);
  const k = 1080 / crop.width;
  return boxes.map((b) => ({ left: (b.x - crop.left) * k, top: (b.y - crop.top) * k, width: b.width * k, height: b.height * k }));
}

function clearBy(samples: { t: number; faces: Rect[] }[], lines: string[], hit: { scale: number; centre: number; inS: number }): boolean {
  const slice = samples.filter((s) => s.t >= hit.inS - 1e-6).map((s) => ({ tS: s.t - hit.inS, faces: s.faces }));
  return judgeFaceOverTime(slice, { always: captionBoxesAt(lines, hit.scale, hit.centre), claim: null }, { frameWidth: 1080, fps: FACE_SAMPLE_FPS, coverInterval: FACE_SAMPLE_FPS < T1V_FACE.fps }).ok;
}

describe("face detection on wasm matches the cpu backend (the switch's gate)", { timeout: 600_000 }, () => {
  it("detects on wasm with SIMD in production, and the same faces as cpu on every frame; placement 0 worse", async (t) => {
    assert.deepEqual(await faceBackend(), { backend: "wasm", simd: true, threads: false, fallback: null });
    const tf = (await faceApiTf()) as { getBackend(): string; setBackend(name: string): Promise<boolean> };
    const strip = (faces: FaceBox[]): Box[] => faces.map(({ x, y, width, height }) => ({ x, y, width, height }));
    const seen: { photo: string; name: string; png: Buffer; width: number; height: number; wasm: FaceBox[]; cpu?: FaceBox[] }[] = [];
    for (const photo of PHOTOS) {
      for (const f of await frames(photo)) {
        const { width = 0, height = 0 } = await sharp(f.png).metadata();
        seen.push({ photo, ...f, width, height, wasm: await detectFaces(f.png, { minConfidence: 0.3 }) });
      }
    }
    await tf.setBackend("cpu");
    try {
      for (const s of seen) s.cpu = await detectFaces(s.png, { minConfidence: 0.3 });
    } finally {
      await tf.setBackend("wasm");
    }
    assert.equal(tf.getBackend(), "wasm");

    let faces = 0;
    let worst = 1;
    for (const s of seen) {
      const label = `${s.photo} · ${s.name}`;
      assert.equal(s.wasm.length, s.cpu!.length, `${label}: ${s.wasm.length} faces on wasm, ${s.cpu!.length} on cpu`);
      const a = agreement(strip(s.wasm), strip(s.cpu!));
      assert.ok(a >= MIN_IOU, `${label}: IoU ${a.toFixed(4)} < ${MIN_IOU}`);
      for (let i = 0; i < s.wasm.length; i += 1) assert.ok(Math.abs(s.wasm[i]!.score - s.cpu![i]!.score) < 0.01, `${label}: scores ${s.wasm[i]!.score} vs ${s.cpu![i]!.score}`);
      faces += s.cpu!.length;
      worst = Math.min(worst, a);
    }
    // The photos are faces on purpose: most frames must have one, or the gate checks nothing.
    assert.ok(faces >= 40, `${faces} faces across ${seen.length} frames`);
    assert.ok(seen.filter((s) => s.cpu!.length).length >= seen.length - 4);

    // One window a photo: its frames in turn every 0.35 s for 8 s, with an empty dark frame every third
    // sample, so the face comes and goes. Each caption is placed from the wasm samples and judged on the cpu's.
    const tally = { same: 0, moved: 0, worse: 0, refused: 0, placed: 0 };
    for (const photo of PHOTOS) {
      const mine = seen.filter((s) => s.photo === photo);
      const samples = (backend: "wasm" | "cpu") =>
        Array.from({ length: 23 }, (_, i) => {
          const s = mine[i % mine.length]!;
          return { t: i * 0.35, faces: i % 3 === 2 ? [] : toOutput(strip(s[backend]!), s.width, s.height) };
        });
      const cpu = samples("cpu");
      const wasm = samples("wasm");
      for (const c of CAPTIONS) {
        const place = (s: typeof cpu) => placeFromStoredSamples({ lines: c.lines, baseScale: c.baseScale, kind: c.kind, windowIn: 0, windowOut: 8, samples: s, fps: FACE_SAMPLE_FPS });
        const pc = place(cpu);
        const pw = place(wasm);
        let outcome: keyof typeof tally;
        if (!pw.ok) outcome = pc.ok ? "refused" : "same";
        else if (!clearBy(cpu, c.lines, pw)) outcome = "worse";
        else if (!pc.ok) outcome = "placed";
        else outcome = pc.scale === pw.scale && pc.centre === pw.centre && pc.inS === pw.inS ? "same" : "moved";
        tally[outcome] += 1;
        assert.notEqual(outcome, "worse", `${photo} · ${c.name}: the wasm samples place the caption on a face the cpu samples keep clear`);
      }
    }
    t.diagnostic(`${seen.length} frames, ${faces} faces, lowest IoU ${worst.toFixed(5)}; placements ${JSON.stringify(tally)}`);
    assert.equal(tally.worse, 0);
  });

  it("finds the same eyes on wasm as on cpu (the landmark net runs on the same backend)", async () => {
    const tf = (await faceApiTf()) as { setBackend(name: string): Promise<boolean> };
    const img = readFileSync(join(DEMO, "sample1.jpg"));
    const boxes = (await detectFaces(img)).slice(0, 3);
    assert.ok(boxes.length >= 2);
    const wasm = await faceGeometry(img, boxes);
    await tf.setBackend("cpu");
    let cpu: Awaited<ReturnType<typeof faceGeometry>>;
    try {
      cpu = await faceGeometry(img, boxes);
    } finally {
      await tf.setBackend("wasm");
    }
    assert.equal(wasm.length, cpu.length);
    for (let i = 0; i < wasm.length; i += 1) {
      for (const key of ["eyeX", "eyeY", "browY", "chinY"] as const) assert.ok(Math.abs(wasm[i]![key] - cpu[i]![key]) < 1, `${key}: ${wasm[i]![key]} vs ${cpu[i]![key]}`);
    }
  });
});
