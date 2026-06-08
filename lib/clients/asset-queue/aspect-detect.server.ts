import "server-only";

import sharp from "sharp";

import { snapRatio, type DetectedAspect } from "./aspect-detect";

/**
 * Probe image bytes via sharp. Videos defer to filename hints only.
 *
 * Server-only: `sharp` is a native node module (pulls in `child_process`)
 * and must never reach a client bundle. The browser-safe filename/merge
 * helpers stay in ./aspect-detect; this file isolates the node-only probe.
 */
export async function probeAspectFromBuffer(
  buffer: Buffer,
  mime: string,
): Promise<DetectedAspect> {
  if (!mime.startsWith("image/")) return "other";
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return "other";
    return snapRatio(meta.width, meta.height);
  } catch {
    return "other";
  }
}
