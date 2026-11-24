/**
 * A press photo too large to judge whole. scripts/artist-card.mts decodes the photo several times over (faces, the
 * person mask, the cut-out's matte), and a 109 MP camera original runs it out of memory. A photo over
 * MAX_PHOTO_PIXELS is scaled to LARGE_PHOTO_SIDE on its long side first (EXIF orientation applied, JPEG q95).
 * Every press photo stored on 18 Nov 2026 is at most 60.2 MP, so none of them changes. Cards are drawn at 1080 wide.
 */

import sharp from "sharp";

export const MAX_PHOTO_PIXELS = 64_000_000;
export const LARGE_PHOTO_SIDE = 4800;

export function needsDownscale(width: number, height: number): boolean {
  return width * height > MAX_PHOTO_PIXELS;
}

export async function preparePhoto(bytes: Buffer): Promise<{ bytes: Buffer; note: string | null }> {
  const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  if (!meta.width || !meta.height || !needsDownscale(meta.width, meta.height)) return { bytes, note: null };
  const out = await sharp(bytes, { limitInputPixels: false })
    .rotate()
    .resize({ width: LARGE_PHOTO_SIDE, height: LARGE_PHOTO_SIDE, fit: "inside" })
    .jpeg({ quality: 95 })
    .toBuffer();
  const mp = ((meta.width * meta.height) / 1e6).toFixed(1);
  return { bytes: out, note: `photo ${meta.width} × ${meta.height} (${mp} MP) scaled to ${LARGE_PHOTO_SIDE} px on the long side before judging (over ${MAX_PHOTO_PIXELS / 1e6} MP)` };
}
