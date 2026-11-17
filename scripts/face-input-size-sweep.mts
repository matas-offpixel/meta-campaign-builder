/**
 * Caption placement with the face detector's copy at 512 and 416 px against
 * today's 640 px, on real footage (Matas's part-2 ruling, 17 Nov 2026). Local
 * files only: nothing is read from or written to production.
 *
 *   node --experimental-strip-types scripts/face-input-size-sweep.mts \
 *     --out DIR [--backend wasm|cpu] [--window 20] [--per-file 10] FILE...
 *
 * For each file it takes up to --per-file windows of --window seconds, spread
 * through it (a file shorter than a window is one window). In each window it
 * picks the face check's own frames (the seeded plan, 640 px PNGs, as
 * production extracts them), detects at each size as detectFaces does (a
 * copy fit inside the size, boxes back to the frame's pixels, then the crop
 * transform to 1080 × 1920 output pixels), and places every test caption from
 * each size's samples.
 *
 * Outcomes against 640 px as the truth (the samples today's checks store):
 *   worse   — the smaller size places the caption where 640's samples fail it;
 *   refused — it refuses where 640 places;
 *   moved   — it places elsewhere, still clear by 640's samples;
 *   placed  — it places where 640 refused, clear by 640's samples;
 *   same    — the same place (scale, centre, in-point), or both refuse.
 * Per frame: faces 640 sees that the size misses (lost), and the other way (added).
 *
 * --backend wasm (default) runs face-api's node-wasm build in this process,
 * 25× faster here with the same boxes; --backend cpu runs detectFaces itself
 * (the production path), for a control on the same frames.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import sharp from "sharp";

import { FACE_SAMPLE_FPS, FACE_SAMPLING, captionBoxesAt, placeFromStoredSamples } from "../lib/creative-lab/caption-placement.ts";
import { extractFaceFrames } from "../lib/creative-lab/face-frames.ts";
import { faceSampleSeed, planFrames, sampleTimes } from "../lib/creative-lab/face-sampling.ts";
import { T1V_FACE, judgeFaceOverTime } from "../lib/creative-lab/t1-face.ts";
import { cropWindow } from "../src/remotion/caption-style/profile.ts";

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const v = argv[i + 1]!;
  argv.splice(i, 2);
  return v;
};
const OUT = flag("--out", "");
const BACKEND = flag("--backend", "wasm") as "wasm" | "cpu";
const WINDOW_S = Number(flag("--window", "20"));
const PER_FILE = Number(flag("--per-file", "10"));
const FILES = argv;
if (!OUT || !FILES.length) {
  console.error("usage: --out DIR [--backend wasm|cpu] [--window 20] [--per-file 10] FILE...");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const SIZES = [640, 512, 416] as const;
const CAPTIONS: { name: string; lines: string[]; baseScale: number; kind: "caption" | "quote" }[] = [
  { name: "2 lines", lines: ["THE NIGHT EVERYONE", "IS TALKING ABOUT"], baseScale: 1, kind: "caption" },
  { name: "1 line", lines: ["LUKE DEAN"], baseScale: 1, kind: "caption" },
  { name: "3 lines", lines: ["TICKETS ON SALE", "FRIDAY 10AM", "LINK IN BIO"], baseScale: 1, kind: "caption" },
  { name: "long", lines: ["ONE NIGHT ONLY AT THE", "WAREHOUSE WITH SPECIAL", "GUESTS ALL NIGHT LONG"], baseScale: 0.75, kind: "caption" },
  { name: "quote", lines: ["“THE BEST NIGHT", "I'VE HAD ALL YEAR”"], baseScale: 1, kind: "quote" },
];

const ffmpeg = require("ffmpeg-static") as string;
type Box = { x: number; y: number; width: number; height: number };
type Rect = { left: number; top: number; width: number; height: number };

function probe(file: string): { width: number; height: number; fps: number; durationS: number } {
  let err = "";
  try {
    execFileSync(ffmpeg, ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    err = String((e as { stderr?: Buffer }).stderr ?? "");
  }
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(err)!;
  const v = /Video: .*?, (\d{2,5})x(\d{2,5})[ ,].*?([\d.]+) fps/.exec(err)!;
  const rot = /rotate\s*:\s*(-?\d+)|displaymatrix: rotation of (-?[\d.]+)/.exec(err);
  let width = Number(v[1]);
  let height = Number(v[2]);
  if (rot && Math.abs(Number(rot[1] ?? rot[2])) % 180 === 90) [width, height] = [height, width];
  return { width, height, fps: Number(v[3]), durationS: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) };
}

// Detectors. wasm: face-api's node-wasm build in this process (no cpu tfjs is loaded here, so no shared engine).
let wasmApi: Promise<any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
async function detectWasm(frame: Buffer, side: number): Promise<Box[]> {
  wasmApi ??= (async () => {
    const api = require("@vladmandic/face-api/dist/face-api.node-wasm.js");
    await api.tf.setBackend("wasm");
    await api.tf.ready();
    const dir = join(require.resolve("@vladmandic/face-api/package.json"), "..", "model");
    const manifest = JSON.parse(readFileSync(join(dir, "ssd_mobilenetv1_model-weights_manifest.json"), "utf8"));
    const bytes = readFileSync(join(dir, "ssd_mobilenetv1_model.bin"));
    await api.nets.ssdMobilenetv1.loadFromWeightMap(api.tf.io.decodeWeights(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), manifest[0].weights));
    return api;
  })();
  const api = await wasmApi;
  const meta = await sharp(frame).metadata();
  const { data, info } = await sharp(frame).resize({ width: side, height: side, fit: "inside", withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const k = (meta.width ?? info.width) / info.width;
  const tensor = api.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3]);
  try {
    const found = await api.detectAllFaces(tensor, new api.SsdMobilenetv1Options({ minConfidence: 0.3 }));
    return found.map((d: { box: Box }) => ({ x: d.box.x * k, y: d.box.y * k, width: d.box.width * k, height: d.box.height * k }));
  } finally {
    tensor.dispose();
  }
}
async function detectCpu(frame: Buffer, side: number): Promise<Box[]> {
  const { detectFaces } = await import("../lib/creative-lab/face-detect.ts");
  return detectFaces(frame, { minConfidence: 0.3, longSide: side });
}
const detect = BACKEND === "cpu" ? detectCpu : detectWasm;

type WindowResult = { file: string; inS: number; outS: number; frameWidth: number; frames: { t: number; faces: Record<number, Box[]> }[] };

async function windowFrames(file: string, meta: ReturnType<typeof probe>, inS: number, outS: number, id: string): Promise<WindowResult> {
  const cache = join(OUT, `${id}.${BACKEND}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")) as WindowResult;
  const durationS = outS - inS;
  const plan = planFrames(sampleTimes(durationS, FACE_SAMPLING, faceSampleSeed({ id, cropFocusX: 0.5, cropFocusY: 0.5, inS, outS })), meta.fps, durationS);
  const dir = join(OUT, "frames", id);
  mkdirSync(dir, { recursive: true });
  const got = await extractFaceFrames({ ffmpeg, url: file, inS, outS, frames: plan.map((p) => p.frame), dir, side: 640, timeoutMs: 600_000, prefix: "p" });
  const frames: WindowResult["frames"] = [];
  const frameWidth = got.length ? (await sharp(readFileSync(join(dir, got[0]!.file))).metadata()).width ?? 640 : 640;
  for (const f of got) {
    const bytes = readFileSync(join(dir, f.file));
    const faces: Record<number, Box[]> = {};
    for (const side of SIZES) faces[side] = await detect(bytes, side);
    frames.push({ t: f.t, faces });
  }
  const out = { file, inS, outS, frameWidth, frames };
  writeFileSync(cache, JSON.stringify(out));
  return out;
}

/** Frame boxes (640 px frame pixels) to 1080 × 1920 output pixels, as ensureClipFaces does. */
function toOutput(boxes: Box[], meta: ReturnType<typeof probe>, frameWidth: number): Rect[] {
  const crop = cropWindow(meta.width, meta.height, 0.5);
  const k = 1080 / crop.width;
  const toSource = meta.width / frameWidth;
  return boxes.map((b) => ({ left: (b.x * toSource - crop.left) * k, top: (b.y * toSource - crop.top) * k, width: b.width * toSource * k, height: b.height * toSource * k }));
}

function clearBy(samples: { t: number; faces: Rect[] }[], lines: string[], hit: { scale: number; centre: number; inS: number }, windowIn: number): boolean {
  const origin = hit.inS - windowIn;
  const slice = samples.filter((s) => s.t >= origin - 1e-6).map((s) => ({ tS: s.t - origin, faces: s.faces }));
  const boxes = captionBoxesAt(lines, hit.scale, hit.centre);
  return judgeFaceOverTime(slice, { always: boxes, claim: null }, { frameWidth: 1080, fps: FACE_SAMPLE_FPS, coverInterval: FACE_SAMPLE_FPS < T1V_FACE.fps }).ok;
}

const tally: Record<number, Record<string, number>> = {};
const frameTally: Record<number, { frames: number; lost: number; added: number; withFace640: number }> = {};
const worseCases: string[] = [];
for (const side of SIZES.slice(1)) {
  tally[side] = { same: 0, moved: 0, worse: 0, refused: 0, placed: 0 };
  frameTally[side] = { frames: 0, lost: 0, added: 0, withFace640: 0 };
}

for (const file of FILES) {
  const meta = probe(file);
  const count = meta.durationS <= WINDOW_S ? 1 : Math.min(PER_FILE, Math.floor(meta.durationS / WINDOW_S));
  const step = meta.durationS / count;
  for (let w = 0; w < count; w += 1) {
    const inS = count === 1 ? 0 : Math.round((w * step + (step - WINDOW_S) / 2) * 100) / 100;
    const outS = Math.min(meta.durationS, inS + WINDOW_S);
    const id = `${file.split("/").at(-1)!.replace(/[^A-Za-z0-9]+/g, "_")}@${inS}`;
    const res = await windowFrames(file, meta, inS, outS, id);
    const samples = (side: number) => res.frames.map((f) => ({ t: f.t, faces: toOutput(f.faces[side] ?? [], meta, res.frameWidth) }));
    const truth = samples(640);
    for (const side of SIZES.slice(1)) {
      for (const f of res.frames) {
        const a = (f.faces[640] ?? []).length;
        const b = (f.faces[side] ?? []).length;
        frameTally[side]!.frames += 1;
        if (a) frameTally[side]!.withFace640 += 1;
        if (a && !b) frameTally[side]!.lost += 1;
        if (b && !a) frameTally[side]!.added += 1;
      }
      const mine = samples(side);
      for (const c of CAPTIONS) {
        const place = (s: { t: number; faces: Rect[] }[]) => placeFromStoredSamples({ lines: c.lines, baseScale: c.baseScale, kind: c.kind, windowIn: inS, windowOut: outS, samples: s, fps: FACE_SAMPLE_FPS });
        const p640 = place(truth);
        const pS = place(mine);
        let outcome: string;
        if (!pS.ok) outcome = p640.ok ? "refused" : "same";
        else if (!clearBy(truth, c.lines, pS, inS)) outcome = "worse";
        else if (!p640.ok) outcome = "placed";
        else outcome = p640.scale === pS.scale && p640.centre === pS.centre && p640.inS === pS.inS ? "same" : "moved";
        tally[side]![outcome]! += 1;
        if (outcome === "worse") worseCases.push(`${side} px · ${id} · ${c.name}`);
      }
    }
    console.error(`${id}: ${res.frames.length} frames`);
  }
}

const summary = { backend: BACKEND, windowS: WINDOW_S, files: FILES.length, captions: CAPTIONS.map((c) => c.name), placement: tally, frames: frameTally, worseCases };
writeFileSync(join(OUT, `summary.${BACKEND}.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
