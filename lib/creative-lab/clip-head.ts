/**
 * O120 (overlay-templates issue 17): on a clip, where the artist's head is,
 * and the 9:16 crop that centres it.
 *
 * The head on a sampled frame is the face box when a face is found;
 * otherwise the top 0.18 of the person mask's height (segment.ts
 * personHeadBox), so the back of a head counts. Over the render window the
 * crop goes to the head's median x ("where the head spends the most time"),
 * one crop per clip, no panning, and only when the median is more than
 * 0.05 W off centre. The window stays within O63: at least 675 px wide, so
 * never more than a 1.6× scale-up.
 *
 * Pure: no model, no image decoder. No `@/` imports (node --test).
 */

export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };

export const CLIP_HEAD = {
  /** The head is the top 0.18 of the person mask's height. */
  maskTop: 0.18,
  /** A mask pixel counts above this. */
  threshold: 0.5,
  /** The person is the largest connected part of the mask, and it must cover at least this share of the frame. */
  minPersonShare: 0.01,
  /** The crop moves only when the head's median is more than this share of W off centre. */
  moveAt: 0.05,
  /** O63: the 9:16 window is never narrower than this, in source px (1.6× at most). */
  minWindowPx: 675,
} as const;

/** O120's render-row line. */
export const framedLine = (px: number, side: "left" | "right"): string => `Framed on the artist: crop moved ${px} px ${side}`;

/** O120: the clip is refused for T1 when the head is under the type even with the claim moved up. */
export const HEAD_REFUSAL = "The artist's head is where the text goes — choose another clip";

/**
 * The person's head on a mask grid: the largest 4-connected part above the
 * threshold (smaller parts are other people or noise), then the top 0.18 of
 * its height, as wide as that part's pixels are in those rows. Null when no
 * part covers CLIP_HEAD.minPersonShare of the grid.
 */
export function headFromMask(alpha: ArrayLike<number>, width: number, height: number, threshold: number = CLIP_HEAD.threshold): Rect | null {
  const n = width * height;
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let best: { id: number; size: number; top: number; bottom: number } | null = null;
  let id = 0;
  for (let start = 0; start < n; start += 1) {
    if (label[start]! >= 0 || !(alpha[start]! > threshold)) continue;
    let sp = 0;
    stack[sp++] = start;
    label[start] = id;
    let size = 0;
    let top = height;
    let bottom = -1;
    while (sp > 0) {
      const i = stack[--sp]!;
      size += 1;
      const y = (i / width) | 0;
      const x = i - y * width;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      const push = (j: number) => {
        if (label[j]! < 0 && alpha[j]! > threshold) {
          label[j] = id;
          stack[sp++] = j;
        }
      };
      if (x > 0) push(i - 1);
      if (x < width - 1) push(i + 1);
      if (y > 0) push(i - width);
      if (y < height - 1) push(i + width);
    }
    if (!best || size > best.size) best = { id, size, top, bottom };
    id += 1;
  }
  if (!best || best.size < CLIP_HEAD.minPersonShare * n) return null;
  const rows = Math.max(1, Math.round((best.bottom - best.top + 1) * CLIP_HEAD.maskTop));
  let minX = width;
  let maxX = -1;
  for (let y = best.top; y < best.top + rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (label[y * width + x] === best.id) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  return { left: minX, top: best.top, width: maxX - minX + 1, height: rows };
}

/**
 * Overlapping squares that cover a frame, each as wide as the frame's short
 * side: three down a portrait frame (top, middle, bottom), three across a
 * landscape one, one for a square. The segmenter is trained on people at
 * selfie scale, and a squashed 9:16 frame loses a performer seen from behind
 * (clip 34, 17 Nov); a square at the frame's width finds him.
 */
export function squareTiles(size: Size): Rect[] {
  const side = Math.min(size.width, size.height);
  const spare = Math.max(size.width, size.height) - side;
  const offsets = spare <= 0 ? [0] : [...new Set([0, Math.round(spare / 2), spare])];
  return offsets.map((o) => (size.height >= size.width ? { left: 0, top: o, width: side, height: side } : { left: o, top: 0, width: side, height: side }));
}

/** A sample's faces (source px) and, when no face was found, the mask's head (source px). */
export type HeadSample = { tS: number; faces: readonly Rect[]; maskHead?: Rect | null };

/**
 * O120: the head on one sample. The widest face when there is one (the face
 * check's main face), else the mask's head, else none.
 */
export function headOf(sample: HeadSample): Rect | null {
  if (sample.faces.length) return sample.faces.reduce((a, b) => (b.width > a.width ? b : a));
  return sample.maskHead ?? null;
}

/** The median of the heads' centre x over the samples that have one; null when none do. */
export function medianHeadX(samples: readonly HeadSample[]): number | null {
  const xs = samples
    .map(headOf)
    .filter((h): h is Rect => !!h)
    .map((h) => h.left + h.width / 2)
    .sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
}

export type HeadCrop = {
  /** The window's horizontal centre, 0–1 of the source width (crop_focus_x). */
  cropFocusX: number;
  /** The window's width in source px: narrower than the natural 9:16 only when the head is near a side. */
  cropWidth: number;
  /** The window in source px. */
  window: Rect;
  /** Output px the head moved towards the centre; 0 when the crop didn't move. */
  movedPx: number;
  side: "left" | "right" | null;
  /** The render row's line, or null when the crop didn't move. */
  line: string | null;
  /** Where the head lands, 0–1 of the output width. */
  headAt: number | null;
};

/** The largest 9:16 window inside the source (O42), before any narrowing. */
export function natural916(source: Size): Size {
  let w = source.width;
  let h = (w * 16) / 9;
  if (h > source.height) {
    h = source.height;
    w = (h * 9) / 16;
  }
  return { width: w, height: h };
}

/**
 * O120: the 9:16 window for a clip. `from` is the window the clip has now
 * (its crop focus x and y); the head's median x is read in it. Within 0.05 W
 * of centre the window stays. Otherwise the window centres on the head at
 * its natural width when that fits the source, or narrows (never under
 * 675 px) to the widest window centred on the head that does; past that it
 * sits against the source's edge and the head lands as near the centre as
 * the footage allows.
 */
export function planHeadCrop(source: Size, headX: number | null, from: { cropFocusX: number; cropFocusY: number }, outWidth = 1080): HeadCrop {
  const nat = natural916(source);
  const place = (w: number, cx: number): Rect => {
    const h = (w * 16) / 9;
    const left = Math.min(source.width - w, Math.max(0, cx - w / 2));
    const top = Math.min(source.height - h, Math.max(0, from.cropFocusY * source.height - h / 2));
    return { left, top, width: w, height: h };
  };
  const start = place(nat.width, from.cropFocusX * source.width);
  const at = (win: Rect) => (headX == null ? null : (headX - win.left) / win.width);
  const stay: HeadCrop = { cropFocusX: (start.left + start.width / 2) / source.width, cropWidth: start.width, window: start, movedPx: 0, side: null, line: null, headAt: at(start) };
  if (headX == null) return stay;
  const off = (headX - (start.left + start.width / 2)) / start.width;
  if (Math.abs(off) <= CLIP_HEAD.moveAt + 1e-9) return stay;
  const room = 2 * Math.min(headX, source.width - headX);
  const w = Math.min(nat.width, Math.max(CLIP_HEAD.minWindowPx, room));
  const win = place(w, headX);
  const before = (headX - start.left) * (outWidth / start.width);
  const after = (headX - win.left) * (outWidth / win.width);
  const movedPx = Math.round(Math.abs(after - before));
  const side = off < 0 ? "left" : "right";
  return { cropFocusX: (win.left + win.width / 2) / source.width, cropWidth: win.width, window: win, movedPx, side, line: movedPx > 0 ? framedLine(movedPx, side) : null, headAt: at(win) };
}

/** A source-px rectangle as output px of a window. */
export function toOutput(r: Rect, win: Rect, outWidth = 1080): Rect {
  const k = outWidth / win.width;
  return { left: (r.left - win.left) * k, top: (r.top - win.top) * k, width: r.width * k, height: r.height * k };
}
