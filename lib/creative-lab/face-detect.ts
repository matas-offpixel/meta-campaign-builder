/**
 * Face boxes for a still, for the artist card's face-aware crop.
 *
 * Pure JS: @vladmandic/face-api's own bundle (tfjs inside, CPU backend) with
 * the SSD MobileNet v1 weights that ship in the package. No native module,
 * no canvas: sharp decodes the image to raw RGB and that goes in as a tensor.
 * Script-side only — it is never imported by a route.
 *
 * The detector runs on a copy at most 640 px on its long side; boxes come back
 * in the source image's pixels.
 */

import { readFileSync } from "node:fs";
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
  browY: number;
  chinY: number;
  headTopY: number;
};

export const HEAD_ABOVE_BROW = 0.6;

/** The minimal face-api surface used here. */
type FaceApi = {
  tf: {
    setBackend(name: string): Promise<boolean>;
    ready(): Promise<void>;
    setPlatform(name: string, platform: unknown): void;
    tensor3d(values: Uint8Array, shape: [number, number, number]): { dispose(): void };
    io: { decodeWeights(buffer: ArrayBuffer, specs: unknown): unknown };
  };
  env: { setEnv(env: unknown): void };
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

const DETECT_LONG_SIDE = 640;
let loaded: Promise<FaceApi> | null = null;

async function faceApi(): Promise<FaceApi> {
  if (loaded) return loaded;
  loaded = (async () => {
    const require = createRequire(import.meta.url);
    const main = require.resolve("@vladmandic/face-api/dist/face-api.esm.js");
    // The bundle is the browser build: when it sees Node it builds tfjs's Node
    // platform from a stubbed-out `util` and throws. So it loads with
    // process.versions.node hidden, and the platform is registered here from the
    // real util (fetch, TextEncoder and performance are Node globals).
    const versions = process.versions;
    Object.defineProperty(process, "versions", { value: { ...versions, node: undefined }, configurable: true, writable: true });
    let api: FaceApi;
    try {
      api = (await import(pathToFileURL(main).href)) as unknown as FaceApi;
    } finally {
      Object.defineProperty(process, "versions", { value: versions, configurable: true, writable: true });
    }
    const util = require("node:util") as typeof import("node:util");
    const encoder = new util.TextEncoder();
    api.tf.setPlatform("node", {
      fetch: (input: string, init?: RequestInit) => fetch(input, init),
      now: () => performance.now(),
      encode: (text: string) => encoder.encode(text),
      decode: (bytes: Uint8Array, encoding: string) => (bytes.length === 0 ? "" : new util.TextDecoder(encoding).decode(bytes)),
      isTypedArray: (a: unknown) => util.types.isFloat32Array(a) || util.types.isInt32Array(a) || util.types.isUint8Array(a) || util.types.isUint8ClampedArray(a),
      setTimeoutCustom: (fn: () => void, delay: number) => setTimeout(fn, delay),
    });
    // face-api's own environment: input is always a tensor, so its media
    // classes only need to exist for its instanceof checks.
    class Inert {}
    api.env.setEnv({
      Canvas: Inert,
      CanvasRenderingContext2D: Inert,
      Image: Inert,
      ImageData: Inert,
      Video: Inert,
      createCanvasElement: () => {
        throw new Error("face-detect: canvas is not available; pass a tensor");
      },
      createImageElement: () => {
        throw new Error("face-detect: images are not available; pass a tensor");
      },
      createVideoElement: () => {
        throw new Error("face-detect: video is not available; pass a tensor");
      },
      fetch: (input: string, init?: RequestInit) => fetch(input, init),
      readFile: async (path: string) => readFileSync(path),
    });
    await api.tf.setBackend("cpu");
    await api.tf.ready();
    const modelDir = join(dirname(main), "..", "model");
    const weights = (name: string) => {
      const manifest = JSON.parse(readFileSync(join(modelDir, `${name}-weights_manifest.json`), "utf8")) as { weights: unknown }[];
      const bytes = readFileSync(join(modelDir, `${name}.bin`));
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return api.tf.io.decodeWeights(buffer, manifest[0]!.weights);
    };
    await api.nets.ssdMobilenetv1.loadFromWeightMap(weights("ssd_mobilenetv1_model"));
    await api.nets.faceLandmark68Net.loadFromWeightMap(weights("face_landmark_68_model"));
    return api;
  })();
  return loaded;
}

/** Every face in the image, largest first, in source pixels (EXIF rotation applied). */
export async function detectFaces(image: Buffer, opts: { minConfidence?: number } = {}): Promise<FaceBox[]> {
  const sharp = (await import("sharp")).default;
  const api = await faceApi();
  const rotated = sharp(image).rotate();
  const meta = await sharp(await rotated.clone().toBuffer()).metadata();
  const sourceW = meta.width ?? 0;
  const { data, info } = await rotated
    .resize({ width: DETECT_LONG_SIDE, height: DETECT_LONG_SIDE, fit: "inside", withoutEnlargement: true })
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
  const api = await faceApi();
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
      const eyes = pts.slice(36, 48);
      const eyeX = eyes.reduce((sum, p) => sum + p.x, 0) / eyes.length;
      const eyeY = eyes.reduce((sum, p) => sum + p.y, 0) / eyes.length;
      const browY = Math.min(...pts.slice(17, 27).map((p) => p.y));
      const chinY = pts[8]!.y;
      out.push({ box, eyeX, eyeY, browY, chinY, headTopY: browY - HEAD_ABOVE_BROW * (chinY - browY) });
    } finally {
      tensor.dispose();
    }
  }
  return out;
}
