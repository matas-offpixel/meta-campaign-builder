/**
 * O63's import half. Video import accepts a reel when its narrowest crop
 * window is at least 675 px wide. Stills are never upscaled.
 *
 * The Clips section imports this from a client component. t1-video.ts reads
 * kit fonts through node:fs, so this file only imports the frame module.
 * The refusal line and the clip order match T1V_LINES, T1V_SCALE and
 * orderArtistClips; the import test checks that.
 */

import { footageWindow, type VideoFormat } from "./t1-video-frame.ts";

export type ClipListing = { source: string; clipNo: number };

/** Folder and press-kit before Instagram, then clip number. */
export function orderArtistClips<T extends ClipListing>(clips: readonly T[]): T[] {
  const rank = (source: string) => (source === "instagram" ? 1 : 0);
  return [...clips].sort((a, b) => rank(a.source) - rank(b.source) || a.clipNo - b.clipNo);
}

const FORMATS = ["9:16", "4:5", "1:1"] as const satisfies readonly VideoFormat[];
const MIN_WINDOW_PX = 675;
/** One part of a triple-fit is 1080×640. The 675 px floor is the 1.6× ceiling. */
const PART_ASPECT = 1080 / 640;

/** O93. An existing clip under this stays in the Lab and takes no template, round or render. */
export const TOO_SMALL_FOR_916 = "Too small for 9:16";

/** O108. A landscape whose own 9:16 is under 675 px, and whose part window is not. */
export const LANDSCAPE_TRIPLE_FIT_ONLY = "Landscape — triple-fit only";

/** O104. A 4:5 or 1:1 video row stays on the plan and does not launch. */
export const VIDEO_RUNS_AS_916_ONLY = "Video runs as 9:16 only";

/** The 9:16 crop window is under 675 px. Missing dimensions are not a refusal. */
export function tooSmallFor916(source: { width: number; height: number } | null | undefined): boolean {
  if (!source || !(source.width > 0) || !(source.height > 0)) return false;
  return footageWindow(source, "9:16").width + 1e-9 < MIN_WINDOW_PX;
}

/** The landscape window one triple-fit part is cut from. Width is the limit. */
export function partWindow(source: { width: number; height: number }): { width: number; height: number } {
  const width = Math.min(source.width, source.height * PART_ASPECT);
  return { width, height: width / PART_ASPECT };
}

/**
 * Too small for its own 9:16, and a part still clears 675 px.
 * A portrait (taller than it is wide) is never one. A landscape that
 * already makes 9:16 is not one either.
 */
export function tripleFitSource(source: { width: number; height: number } | null | undefined): boolean {
  if (!source || !(source.width > 0) || !(source.height > 0)) return false;
  if (source.height > source.width) return false;
  if (!tooSmallFor916(source)) return false;
  return partWindow(source).width + 1e-9 >= MIN_WINDOW_PX;
}

/** The refusal line for a video whose narrowest crop window is under 675 px. Null when it can import. */
export function importQualityLine(source: { width: number; height: number }): string | null {
  if (tripleFitSource(source)) return null;
  let narrowest: { format: VideoFormat; width: number } | null = null;
  for (const format of FORMATS) {
    const width = footageWindow(source, format).width;
    if (!narrowest || width < narrowest.width) narrowest = { format, width };
  }
  if (!narrowest || narrowest.width + 1e-9 >= MIN_WINDOW_PX) return null;
  return `Clip too small for ${narrowest.format} — ${Math.round(narrowest.width)} px wide in the crop, needs 675`;
}

/**
 * The line on an MML plan row. A video that cannot make 9:16 says so.
 * A 4:5 or 1:1 video that can still only runs as 9:16. Images say nothing.
 */
export function planVideoRowLine(asset: {
  mediaKind: string;
  width: number | null;
  height: number | null;
  bucket: string;
}): string | null {
  if (asset.mediaKind !== "video") return null;
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  if (width > 0 && height > 0 && tooSmallFor916({ width, height })) return TOO_SMALL_FOR_916;
  if (asset.bucket === "4:5" || asset.bucket === "1:1") return VIDEO_RUNS_AS_916_ONLY;
  return null;
}

/** A video creative whose draft holds a 4:5 or 1:1 asset cannot launch. */
export function videoDraftHold(creative: {
  mediaType: string;
  assetVariations: readonly { assets: readonly { aspectRatio: string }[] }[];
}): string | null {
  if (creative.mediaType !== "video") return null;
  const held = creative.assetVariations.some((variation) =>
    variation.assets.some((asset) => asset.aspectRatio === "4:5" || asset.aspectRatio === "1:1"),
  );
  return held ? VIDEO_RUNS_AS_916_ONLY : null;
}

/** PostgREST before migration 229 is applied. Callers retry without the column. */
export function missingTripleFitColumn(message: string): boolean {
  return /triple_fit_source_id/i.test(message) && /schema cache|does not exist|column/i.test(message);
}
