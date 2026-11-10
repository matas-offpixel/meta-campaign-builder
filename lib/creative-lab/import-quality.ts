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

/** O93. An existing clip under this stays in the Lab and takes no template, round or render. */
export const TOO_SMALL_FOR_916 = "Too small for 9:16";

/** The 9:16 crop window is under 675 px. Missing dimensions are not a refusal. */
export function tooSmallFor916(source: { width: number; height: number } | null | undefined): boolean {
  if (!source || !(source.width > 0) || !(source.height > 0)) return false;
  return footageWindow(source, "9:16").width + 1e-9 < MIN_WINDOW_PX;
}

/** The refusal line for a video whose narrowest crop window is under 675 px. Null when it can import. */
export function importQualityLine(source: { width: number; height: number }): string | null {
  let narrowest: { format: VideoFormat; width: number } | null = null;
  for (const format of FORMATS) {
    const width = footageWindow(source, format).width;
    if (!narrowest || width < narrowest.width) narrowest = { format, width };
  }
  if (!narrowest || narrowest.width + 1e-9 >= MIN_WINDOW_PX) return null;
  return `Clip too small for ${narrowest.format} — ${Math.round(narrowest.width)} px wide in the crop, needs 675`;
}
