/**
 * Face boxes for a still, for the artist card's face-aware crop and the Lab's caption face check.
 *
 * @vladmandic/face-api's Node build for the wasm backend (face-api.node-wasm.js) with the SSD MobileNet v1
 * weights that ship in the package. It runs on @tensorflow/tfjs with @tensorflow/tfjs-backend-wasm (SIMD),
 * about 30 times faster than the cpu backend: on Vercel 0.48 s a frame against 14.6 s, with the same boxes
 * (17 Nov 2026, clip #22). No native module, no canvas: sharp decodes the image to raw RGB and that goes in
 * as a tensor. The render tick is the only route that imports it. render-caption does not.
 *
 * tfjs keeps one engine on globalThis for the whole process, so the backend is set once, here, before
 * face-api runs, and every tfjs user in the process (the person segmenter, segment.ts) runs on it. If wasm
 * can't start, detection falls back to the cpu backend and says so in the log: the face check still finishes,
 * across ticks (face-check-slice.ts). faceBackend() reports which one is active.
 *
 * The detector runs on a copy at most 640 px on its long side; boxes come back in the source image's pixels.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export type FaceBox = { x: number; y: number; width: number; height: number; score: number };

/**
 * One face's geometry in source pixels, from the 68-point landmarks:
 * eyes = mean of points 36–47, brow = the highest eyebrow point (17–26),
 * chin = point 8. The top of the head is not a landmark: it is estimated as
 * brow − HEAD_ABOVE_BROW × (chin − brow): 0.6, calibrated by eye on Luke (cap),
 * Enzo and Reeshy (their hair tops sat 0.32–0.6 × (chin − brow) above the brow);
 * it errs high (safe) on hair.
 */
export type FaceGeometry = {
  box: FaceBox;
  eyeX: number;
  eyeY: number;
  /** Centroids of landmarks 36–41 and 42–47. */
  leftEye: { x: number; y: number };
  rightEye: { x: number; y: number };
  browY: number;
  chinY: number;
  headTopY: number;
};

export const HEAD_ABOVE_BROW = 0.6;

/** The minimal face-api surface used here. */
type FaceApi = {
  tf: {
    setBackend(name: string): Promise<boolean>;
    getBackend(): string;
    ready(): Promise<void>;
    env(): { getAsync(flag: string): Promise<unknown> };
    tensor3d(values: Uint8Array, shape: [number, number, number]): { dispose(): void };
    io: { decodeWeights(buffer: ArrayBuffer, specs: unknown): unknown };
  };
  nets: {
    ssdMobilenetv1: { loadFromWeightMap(map: unknown): Promise<void> };
    faceLandmark68Net: {
      loadFromWeightMap(map: unknown): Promise<void>;
      detectLandmarks(input: unknown): Promise<{ positions: { x: number; y: number }[] }>;
    };
  };
  SsdMobilenetv1Options: new (opts: { minConfidence: number; maxResults?: number }) => unknown;
  detectAllFaces(input: unknown, opts: unknown): Promise<{ score: number; box: { x: number; y: number; width: number; height: number } }[]>;
};

export const DETECT_LONG_SIDE = 640;
export const FACE_API_MAIN = "@vladmandic/face-api/dist/face-api.node-wasm.js";
/** The backend face detection runs on. */
export const FACE_BACKEND = "wasm";

/**
 * face-api's Node wasm build on disk. In the Vercel function the traced node_modules sit under the working
 * directory (next.config.ts outputFileTracingIncludes), and a bundled require.resolve or import.meta.url
 * can't be trusted to give a real path, so that copy wins. Local scripts and tests resolve it from this file.
 * Its own requires (@tensorflow/tfjs, @tensorflow/tfjs-backend-wasm) resolve next to it, so the function
 * loads only traced files (scripts/check-face-detect-bundle.mts proves that on the real build).
 */
export function faceApiMain(cwd: string = process.cwd(), exists: (path: string) => boolean = existsSync): string {
  const traced = join(cwd, "node_modules", FACE_API_MAIN);
  if (exists(traced)) return traced;
  return createRequire(import.meta.url).resolve(FACE_API_MAIN);
}

/** face-api's SSD and landmark weights, next to its dist folder. */
export function faceApiModelDir(main: string = faceApiMain()): string {
  return join(dirname(main), "..", "model");
}

export type FaceBackendInfo = {
  /** tfjs's active backend: "wasm", or "cpu" after a fallback. */
  backend: string;
  simd: boolean | null;
  threads: boolean | null;
  /** Why wasm didn't start, when it didn't. */
  fallback: string | null;
};

let loaded: Promise<{ api: FaceApi; info: FaceBackendInfo }> | null = null;

/** The wasm backend, once per process. Throws when it doesn't end up active. */
async function startWasm(api: FaceApi): Promise<void> {
  const ok = await api.tf.setBackend(FACE_BACKEND);
  await api.tf.ready();
  if (!ok || api.tf.getBackend() !== FACE_BACKEND) throw new Error(`face-detect: the wasm backend didn't start (active: ${api.tf.getBackend()})`);
}

async function faceApi(): Promise<{ api: FaceApi; info: FaceBackendInfo }> {
  if (loaded) return loaded;
  loaded = (async () => {
    const main = faceApiMain();
    // webpackIgnore: the URL is computed at runtime, and a bundler that can't analyse it replaces the import
    // with a stub that throws "Cannot find module as expression is too dynamic" (production, 17 Nov 2026).
    // The file is CommonJS (its package has no "type"), so Node hands back module.exports as the default.
    // CI checks the built route: scripts/check-face-detect-bundle.mts.
    const mod = (await import(/* webpackIgnore: true */ pathToFileURL(main).href)) as { default?: FaceApi } & FaceApi;
    const api = mod.default ?? mod;
    let fallback: string | null = null;
    try {
      await startWasm(api);
    } catch (err) {
      fallback = (err instanceof Error ? err.message : String(err)).split("\n")[0]!.slice(0, 200);
      await api.tf.setBackend("cpu");
      await api.tf.ready();
      console.warn(`face-detect: detecting on the cpu backend, about 30 times slower: ${fallback}`);
    }
    const flag = async (name: string) => (api.tf.getBackend() === FACE_BACKEND ? Boolean(await api.tf.env().getAsync(name)) : null);
    const info: FaceBackendInfo = { backend: api.tf.getBackend(), simd: await flag("WASM_HAS_SIMD_SUPPORT"), threads: await flag("WASM_HAS_MULTITHREAD_SUPPORT"), fallback };
    const modelDir = faceApiModelDir(main);
    const weights = (name: string) => {
      const manifest = JSON.parse(readFileSync(join(modelDir, `${name}-weights_manifest.json`), "utf8")) as { weights: unknown }[];
      const bytes = readFileSync(join(modelDir, `${name}.bin`));
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return api.tf.io.decodeWeights(buffer, manifest[0]!.weights);
    };
    await api.nets.ssdMobilenetv1.loadFromWeightMap(weights("ssd_mobilenetv1_model"));
    await api.nets.faceLandmark68Net.loadFromWeightMap(weights("face_landmark_68_model"));
    return { api, info };
  })();
  // A failed load is not cached: the next call tries again.
  loaded.catch(() => {
    loaded = null;
  });
  return loaded;
}

/** Which backend detection runs on, loading the detector if it isn't yet. */
export async function faceBackend(): Promise<FaceBackendInfo> {
  return (await faceApi()).info;
}

/**
 * The tfjs instance face-api runs on, already on the detection backend. It includes the graph-model
 * converter, so the person segmenter (segment.ts) runs on it too: one tfjs, one backend.
 */
export async function faceApiTf(): Promise<unknown> {
  return (await faceApi()).api.tf;
}

/**
 * Every face in the image, largest first, in source pixels (EXIF rotation applied). `longSide` is the copy's
 * long side the detector sees (640 by default). SSD MobileNet v1 resizes whatever it is given to 512 × 512
 * inside face-api, so a smaller copy is no faster (Vercel, 17 Nov 2026) and placed captions worse.
 */
export async function detectFaces(image: Buffer, opts: { minConfidence?: number; longSide?: number } = {}): Promise<FaceBox[]> {
  const sharp = (await import("sharp")).default;
  const { api } = await faceApi();
  const rotated = sharp(image).rotate();
  const meta = await sharp(await rotated.clone().toBuffer()).metadata();
  const sourceW = meta.width ?? 0;
  const { data, info } = await rotated
    .resize({ width: opts.longSide ?? DETECT_LONG_SIDE, height: opts.longSide ?? DETECT_LONG_SIDE, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const scale = sourceW > 0 ? sourceW / info.width : 1;
  const tensor = api.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3]);
  try {
    const found = await api.detectAllFaces(tensor, new api.SsdMobilenetv1Options({ minConfidence: opts.minConfidence ?? 0.35 }));
    return found
      .map((d) => ({
        x: d.box.x * scale,
        y: d.box.y * scale,
        width: d.box.width * scale,
        height: d.box.height * scale,
        score: d.score,
      }))
      .sort((a, b) => b.width * b.height - a.width * a.height);
  } finally {
    tensor.dispose();
  }
}

const LANDMARK_INPUT = 256;

/**
 * Landmarks for each face box: the source is cropped around the box (with a
 * 30 % margin) at full resolution, resized to 256 px and run through the
 * 68-point net, so a small face in a big photo still gets a sharp read.
 */
export async function faceGeometry(image: Buffer, boxes: readonly FaceBox[]): Promise<FaceGeometry[]> {
  const sharp = (await import("sharp")).default;
  const { api } = await faceApi();
  const rotated = await sharp(image).rotate().toBuffer();
  const meta = await sharp(rotated).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const out: FaceGeometry[] = [];
  for (const box of boxes) {
    const side = Math.max(box.width, box.height) * 1.3;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const left = Math.max(0, Math.round(cx - side / 2));
    const top = Math.max(0, Math.round(cy - side / 2));
    const width = Math.min(W - left, Math.round(side));
    const height = Math.min(H - top, Math.round(side));
    if (width < 8 || height < 8) continue;
    const { data, info } = await sharp(rotated)
      .extract({ left, top, width, height })
      .resize(LANDMARK_INPUT, LANDMARK_INPUT, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const tensor = api.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3]);
    try {
      const marks = await api.nets.faceLandmark68Net.detectLandmarks(tensor);
      const pts = marks.positions.map((p) => ({ x: left + (p.x * width) / LANDMARK_INPUT, y: top + (p.y * height) / LANDMARK_INPUT }));
      if (pts.length < 68) continue;
      const centroid = (list: { x: number; y: number }[]) => ({ x: list.reduce((sum, p) => sum + p.x, 0) / list.length, y: list.reduce((sum, p) => sum + p.y, 0) / list.length });
      const leftEye = centroid(pts.slice(36, 42));
      const rightEye = centroid(pts.slice(42, 48));
      const eyeX = (leftEye.x + rightEye.x) / 2;
      const eyeY = (leftEye.y + rightEye.y) / 2;
      const browY = Math.min(...pts.slice(17, 27).map((p) => p.y));
      const chinY = pts[8]!.y;
      out.push({ box, eyeX, eyeY, leftEye, rightEye, browY, chinY, headTopY: browY - HEAD_ABOVE_BROW * (chinY - browY) });
    } finally {
      tensor.dispose();
    }
  }
  return out;
}

/** Detector confidence a face needs before its landmarks count (O20 rule 7). */
export const EYES_MIN_SCORE = 0.5;

/**
 * O20 rule 7: the eyes are measurable when the face was found with
 * confidence ≥ 0.5 and both eye centroids sit inside its box, at least
 * 0.25 box widths apart, below the brows and above the chin.
 */
export function eyesMeasurable(g: Pick<FaceGeometry, "box" | "leftEye" | "rightEye" | "browY" | "chinY">): { ok: boolean; why: string } {
  const inBox = (p: { x: number; y: number }) => p.x >= g.box.x && p.x <= g.box.x + g.box.width && p.y >= g.box.y && p.y <= g.box.y + g.box.height;
  const apart = Math.abs(g.rightEye.x - g.leftEye.x) / g.box.width;
  const eyeY = (g.leftEye.y + g.rightEye.y) / 2;
  if (g.box.score < EYES_MIN_SCORE) return { ok: false, why: `face confidence ${g.box.score.toFixed(2)} < ${EYES_MIN_SCORE}` };
  if (!inBox(g.leftEye) || !inBox(g.rightEye)) return { ok: false, why: "an eye falls outside the face box" };
  if (apart < 0.25) return { ok: false, why: `eyes ${apart.toFixed(2)} box widths apart (< 0.25): one eye not seen` };
  if (!(eyeY > g.browY && eyeY < g.chinY)) return { ok: false, why: "eyes not between brows and chin" };
  return { ok: true, why: `confidence ${g.box.score.toFixed(2)}, eyes ${apart.toFixed(2)} box widths apart` };
}
