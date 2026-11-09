/**
 * Person segmentation for the artist card (O20 amended, O21): which pixels of
 * a press photo are the person — face, hair, hands, body.
 *
 * Model: MediaPipe Selfie Segmentation (general, 256×256), Apache-2.0, as
 * converted to a TF.js graph model by PINTO0309's model zoo and packaged in
 * @vladmandic/human-models 3.0.4 (MIT). The two files are vendored in
 * lib/creative-lab/models/selfie/ (see the README there for their sha256).
 * It runs on the tfjs bundled in @vladmandic/face-api (CPU backend, pure JS),
 * so no second tfjs and no network.
 *
 * The model sees a 256×256 copy. Its mask is then refined with a guided filter
 * (He, Sun & Tang) whose guide is the photo itself at a working size of at
 * most 2400 px on the long side, and resampled onto the source pixel grid, so
 * the mask follows the photo's own edges. Nothing is generated: the mask only
 * says which source pixels are kept.
 *
 * Script-side only; never imported by a route.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { faceApiTf } from "./face-detect.ts";

export const SELFIE_INPUT = 256;
export const WORKING_LONG_SIDE = 2400;
export const GUIDED = { radius: 8, eps: 1e-3 } as const;

export type PersonMask = {
  /** Source pixel grid (EXIF rotation applied). */
  width: number;
  height: number;
  /** Alpha 0–1 per source pixel, row-major. */
  alpha: Float32Array;
};

type Tf = {
  loadGraphModel(handler: unknown): Promise<{ predict(x: unknown): { data(): Promise<Float32Array>; dispose(): void } }>;
  io: { fromMemory(artifacts: unknown): unknown };
  tensor4d(values: Float32Array, shape: [number, number, number, number]): { dispose(): void };
};

let model: Promise<Awaited<ReturnType<Tf["loadGraphModel"]>>> | null = null;

function modelDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "models", "selfie");
}

async function selfie(): Promise<Awaited<ReturnType<Tf["loadGraphModel"]>>> {
  model ??= (async () => {
    const tf = (await faceApiTf()) as Tf;
    const json = JSON.parse(readFileSync(join(modelDir(), "selfie.json"), "utf8")) as { modelTopology: unknown; weightsManifest: { weights: unknown }[] };
    const bin = readFileSync(join(modelDir(), "selfie.bin"));
    const weightData = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
    return tf.loadGraphModel(tf.io.fromMemory({ modelTopology: json.modelTopology, weightSpecs: json.weightsManifest[0]!.weights, weightData }));
  })();
  return model;
}

/** Box mean over a (2r+1)² window with edge clamping, via an integral image. */
export function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      row += src[y * w + x]!;
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)]! + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      const sum = integral[(y1 + 1) * (w + 1) + (x1 + 1)]! - integral[y0 * (w + 1) + (x1 + 1)]! - integral[(y1 + 1) * (w + 1) + x0]! + integral[y0 * (w + 1) + x0]!;
      out[y * w + x] = sum / ((y1 - y0 + 1) * (x1 - x0 + 1));
    }
  }
  return out;
}

/** Guided filter of p by the grey guide I (both 0–1). */
export function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const Ip = new Float32Array(n);
  const II = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    Ip[i] = I[i]! * p[i]!;
    II[i] = I[i]! * I[i]!;
  }
  const mI = boxMean(I, w, h, r);
  const mp = boxMean(p, w, h, r);
  const mIp = boxMean(Ip, w, h, r);
  const mII = boxMean(II, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const cov = mIp[i]! - mI[i]! * mp[i]!;
    const variance = mII[i]! - mI[i]! * mI[i]!;
    a[i] = cov / (variance + eps);
    b[i] = mp[i]! - a[i]! * mI[i]!;
  }
  const ma = boxMean(a, w, h, r);
  const mb = boxMean(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i += 1) q[i] = Math.min(1, Math.max(0, ma[i]! * I[i]! + mb[i]!));
  return q;
}

/** The person mask for a photo, on its own pixel grid. */
export async function segmentPerson(image: Buffer): Promise<PersonMask> {
  const sharp = (await import("sharp")).default;
  const tf = (await faceApiTf()) as Tf;
  const net = await selfie();
  const rotated = await sharp(image).rotate().removeAlpha().toBuffer();
  const meta = await sharp(rotated).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;

  // 1. The model's 256×256 read.
  const small = await sharp(rotated).resize(SELFIE_INPUT, SELFIE_INPUT, { fit: "fill" }).raw().toBuffer();
  const input = new Float32Array(SELFIE_INPUT * SELFIE_INPUT * 3);
  for (let i = 0; i < input.length; i += 1) input[i] = small[i]! / 255;
  const x = tf.tensor4d(input, [1, SELFIE_INPUT, SELFIE_INPUT, 3]);
  const out = net.predict(x);
  const coarse = await out.data();
  x.dispose();
  out.dispose();

  // 2. Guided-filter refinement at the working size, guided by the photo.
  const k = Math.min(1, WORKING_LONG_SIDE / Math.max(W, H));
  const ww = Math.max(1, Math.round(W * k));
  const wh = Math.max(1, Math.round(H * k));
  const coarsePng = await sharp(Buffer.from(Uint8Array.from(coarse, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255))), { raw: { width: SELFIE_INPUT, height: SELFIE_INPUT, channels: 1 } })
    .resize(ww, wh, { fit: "fill", kernel: "cubic" })
    .extractChannel(0) // sharp widens a one-channel raw to three on resize
    .raw()
    .toBuffer();
  const guide = await sharp(rotated).resize(ww, wh, { fit: "fill" }).greyscale().raw().toBuffer();
  const I = Float32Array.from(guide, (v) => v / 255);
  const p = Float32Array.from(coarsePng, (v) => v / 255);
  const q = guidedFilter(I, p, ww, wh, GUIDED.radius, GUIDED.eps);

  // 3. Onto the source grid.
  const full = await sharp(Buffer.from(Uint8Array.from(q, (v) => Math.round(v * 255))), { raw: { width: ww, height: wh, channels: 1 } })
    .resize(W, H, { fit: "fill", kernel: "cubic" })
    .extractChannel(0)
    .raw()
    .toBuffer();
  return { width: W, height: H, alpha: Float32Array.from(full, (v) => v / 255) };
}

/** Any mask pixel above 0.5 inside a source-pixel rectangle. */
export function maskTouches(mask: PersonMask, rect: { left: number; top: number; width: number; height: number }, threshold = 0.5): number {
  let count = 0;
  const x0 = Math.max(0, Math.floor(rect.left));
  const y0 = Math.max(0, Math.floor(rect.top));
  const x1 = Math.min(mask.width, Math.ceil(rect.left + rect.width));
  const y1 = Math.min(mask.height, Math.ceil(rect.top + rect.height));
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (mask.alpha[y * mask.width + x]! > threshold) count += 1;
  return count;
}
