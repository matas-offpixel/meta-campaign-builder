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
  nets: { ssdMobilenetv1: { loadFromWeightMap(map: unknown): Promise<void> } };
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
    const manifest = JSON.parse(readFileSync(join(modelDir, "ssd_mobilenetv1_model-weights_manifest.json"), "utf8")) as { weights: unknown }[];
    const bytes = readFileSync(join(modelDir, "ssd_mobilenetv1_model.bin"));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await api.nets.ssdMobilenetv1.loadFromWeightMap(api.tf.io.decodeWeights(buffer, manifest[0]!.weights));
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
