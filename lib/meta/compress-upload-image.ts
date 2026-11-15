import "server-only";

import sharp from "sharp";

import { MAX_IMAGE_BYTES } from "./upload.ts";

const QUALITY_START = 92;
const QUALITY_STEP = 10;
const QUALITY_FLOOR = 42;
const SCALE_STEP = 0.85;
/** Stop shrinking once the long edge would fall below this. */
const MIN_LONG_EDGE = 640;
const MAX_ATTEMPTS = 48;

export interface CompressedUploadImage {
  /** A standalone ArrayBuffer so `new File([bytes])` type-checks. */
  bytes: ArrayBuffer;
  /** JPEG byte length after compression. Always ≤ MAX_IMAGE_BYTES. */
  byteLength: number;
}

/**
 * Re-encode an oversized image to a JPEG at or under {@link MAX_IMAGE_BYTES}.
 * Quality starts at 92 and steps down. If quality alone cannot fit, dimensions
 * scale down with the original aspect ratio until the file fits or the long
 * edge hits {@link MIN_LONG_EDGE}.
 */
function copyToArrayBuffer(buf: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(buf.length);
  new Uint8Array(copy).set(buf);
  return copy;
}

export async function compressUploadImage(input: Uint8Array): Promise<CompressedUploadImage> {
  const source = Buffer.from(input);
  const meta = await sharp(source, { failOn: "none" }).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Could not read image dimensions for compression");
  }

  const sourceWidth = meta.width;
  const sourceHeight = meta.height;
  let scale = 1;
  let quality = QUALITY_START;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let pipeline = sharp(source, { failOn: "none" });
    if (scale < 1) {
      const width = Math.max(1, Math.round(sourceWidth * scale));
      pipeline = pipeline.resize({ width, withoutEnlargement: true });
    }
    const buf = await pipeline.jpeg({ quality }).toBuffer();
    if (buf.length <= MAX_IMAGE_BYTES) {
      return { bytes: copyToArrayBuffer(buf), byteLength: buf.length };
    }

    if (quality - QUALITY_STEP >= QUALITY_FLOOR) {
      quality -= QUALITY_STEP;
      continue;
    }

    const longEdge = Math.max(sourceWidth, sourceHeight) * scale;
    if (longEdge * SCALE_STEP < MIN_LONG_EDGE) {
      throw new Error(
        `Image is still ${(buf.length / 1024 / 1024).toFixed(1)} MB after compression (limit 30 MB).`,
      );
    }
    scale *= SCALE_STEP;
    quality = QUALITY_START;
  }

  throw new Error("Image compression did not converge");
}
