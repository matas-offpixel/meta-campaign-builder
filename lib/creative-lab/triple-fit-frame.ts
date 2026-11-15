/**
 * The triple-fit's frame (overlay templates issue 16, O109, O110), with no
 * imports, so the Remotion composition and the node tests share it. The
 * rules are triple-fit.ts.
 */

type Size = { width: number; height: number };

export const TRIPLE_FIT = {
  /** Each part is 1080 × 640: exact thirds of the 9:16, no gaps, no dividers (O109). */
  part: { width: 1080, height: 640 },
  partTops: [0, 640, 1280],
  seams: [640, 1280],
  /** O111 (invented, O115): no type ink within 24 px of a seam. */
  seamClear: 24,
  /** The part's shape, 1.6875 : 1. */
  ratio: 1080 / 640,
  /** O63 / O93: at most 1.6× from the window, so the window is at least 675 px wide. */
  minWindowPx: 675,
  maxUpscale: 1.6,
  /** O109 (invented, O115): under 6 s it isn't offered; the stored window is at most 30 s. */
  minS: 6,
  maxS: 30,
  /** O108 (invented, O115): offered when the owner has fewer than 3 clips that run in 9:16. */
  offerBelow: 3,
  /** O110: the one track plays from part 2 (TF1's "♪ its one track"); parts 1 and 3 are muted. */
  audioPart: 1,
} as const;

export type PartWindow = { left: number; top: number; width: number; height: number };

/**
 * O109: the one window all three parts share. It has the part's shape and
 * is as wide as the source allows. A 16:9 source keeps its full height,
 * crop_focus_x moving the window across the slack (1920 × 1080 → 1822 ×
 * 1080); a 4:3 source keeps its full width, crop_focus_y placing it (956 ×
 * 718 → 956 × 566). Whole pixels, rounded down, as the record's figures.
 */
export function partWindow(source: Size, cropFocusX = 0.5, cropFocusY = 0.5): PartWindow {
  if (!(source.width > 0) || !(source.height > 0)) throw new Error(`source ${source.width}x${source.height} is too small to render`);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const fullHeight = source.height * TRIPLE_FIT.ratio <= source.width;
  const width = fullHeight ? Math.floor(source.height * TRIPLE_FIT.ratio) : source.width;
  const height = fullHeight ? source.height : Math.floor(source.width / TRIPLE_FIT.ratio);
  return { left: (source.width - width) * clamp(cropFocusX), top: (source.height - height) * clamp(cropFocusY), width, height };
}

/** O109: output px per source px, the same for all three parts. */
export const partScale = (window: PartWindow): number => TRIPLE_FIT.part.width / window.width;

export type PartPlacement = { part: 1 | 2 | 3; top: number; video: { left: number; top: number; width: number; height: number }; muted: boolean };

/**
 * O109 / O110: where the composition draws the footage in each part, in
 * output px inside that part's 1080 × 640 box. The three are identical but
 * for their box's top: one window, one start frame, so every part shows the
 * same source frame. One part carries the sound; with `muted` (no track, or
 * a muted clip) none does.
 */
export function partPlacements(source: Size, window: PartWindow, muted: boolean): PartPlacement[] {
  const k = partScale(window);
  return TRIPLE_FIT.partTops.map((top, i) => ({
    part: (i + 1) as 1 | 2 | 3,
    top,
    video: { left: -window.left * k, top: -window.top * k, width: source.width * k, height: source.height * k },
    muted: muted || i !== TRIPLE_FIT.audioPart,
  }));
}
