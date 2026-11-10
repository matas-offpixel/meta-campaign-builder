/**
 * O63's import half. The resolution rules stay in t1-video.ts; this only
 * reads them. Video import accepts a reel when its narrowest crop window
 * is at least 675 px wide. Stills are never upscaled.
 */

import { footageWindow, type VideoFormat } from "./t1-video-frame.ts";
import { orderArtistClips, T1V_LINES, T1V_SCALE } from "./t1-video.ts";

export { orderArtistClips };

const FORMATS = ["9:16", "4:5", "1:1"] as const satisfies readonly VideoFormat[];

/** The refusal line for a video whose narrowest crop window is under 675 px. Null when it can import. */
export function importQualityLine(source: { width: number; height: number }): string | null {
  let narrowest: { format: VideoFormat; width: number } | null = null;
  for (const format of FORMATS) {
    const width = footageWindow(source, format).width;
    if (!narrowest || width < narrowest.width) narrowest = { format, width };
  }
  if (!narrowest || narrowest.width + 1e-9 >= T1V_SCALE.minWindowPx) return null;
  return T1V_LINES.tooSmall(narrowest.format, narrowest.width);
}
