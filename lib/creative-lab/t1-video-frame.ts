/**
 * The parts of T1 on a clip that the Remotion composition needs (O37, O41,
 * O42), with no imports, so the browser bundle carries nothing from the Node
 * side. t1-video.ts re-exports all of it.
 */

export type Size = { width: number; height: number };
export type Rect = { left: number; top: number; width: number; height: number };

export const T1V_TIMING = {
  /** The claim starts to fade in here, seconds from the clip's first frame. */
  claimInS: 1.5,
  /** Linear 0 → 100 % opacity over this. */
  fadeS: 0.25,
  /** The claim's minimum time on screen. */
  minOnS: 3.0,
} as const;

/** The claim's opacity (0–1) at t seconds: 0 before 1.5 s, linear to 1 at 1.75 s, then held to the last frame (no exit). */
export function claimOpacity(tS: number): number {
  const x = (tS - T1V_TIMING.claimInS) / T1V_TIMING.fadeS;
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

/** The claim is on screen (any opacity above 0) from 1.5 s. */
export const claimOn = (tS: number): boolean => tS > T1V_TIMING.claimInS;

export type VideoFormat = "9:16" | "4:5" | "1:1";

export const FORMAT_SIZE: Record<VideoFormat, Size> = { "9:16": { width: 1080, height: 1920 }, "4:5": { width: 1080, height: 1350 }, "1:1": { width: 1080, height: 1080 } };

/**
 * The source window shown in a format: the largest window of the format's
 * aspect inside the source (no pillarbox, no extension, no upscaling of the
 * window beyond the source; O42), its vertical centre at cropFocusY (0–1) and
 * horizontal centre at cropFocusX, clamped inside the source.
 */
export function footageWindow(source: Size, format: VideoFormat, cropFocusY = 0.5, cropFocusX = 0.5): Rect {
  const out = FORMAT_SIZE[format];
  const aspect = out.width / out.height;
  let w = source.width;
  let h = w / aspect;
  if (h > source.height) {
    h = source.height;
    w = h * aspect;
  }
  const left = Math.min(source.width - w, Math.max(0, cropFocusX * source.width - w / 2));
  const top = Math.min(source.height - h, Math.max(0, cropFocusY * source.height - h / 2));
  return { left, top, width: w, height: h };
}

export type ClipListing = { id: string; source: string; clipNo: number };

/**
 * O63, for the Clips section: within one artist's group, folder and press-kit
 * clips come before Instagram clips, each kind in its own clip order.
 * The Lab doesn't match duplicates.
 */
export function orderArtistClips<T extends ClipListing>(clips: readonly T[]): T[] {
  const rank = (source: string) => (source === "instagram" ? 1 : 0);
  return [...clips].sort((a, b) => rank(a.source) - rank(b.source) || a.clipNo - b.clipNo);
}

