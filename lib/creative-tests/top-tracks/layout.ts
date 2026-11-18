/**
 * Top tracks TK7–TK9 (docs/design-record/2026-11-18-creative-lab-top-tracks.html):
 * where the artist's head goes, the face test on every text piece, the two
 * bands and their contrast, and the end card's column. Pure: pixels and
 * boxes in, verdicts out. No imports from the Node side.
 */

import { TOP_TRACKS, TK_TYPE, type ListSide, type Measure, type PlacedLine, fitSteps, wrap } from "./reel.ts";

export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };

const W = TOP_TRACKS.width;
const H = TOP_TRACKS.height;

// ── TK7: the head on the side away from the list ────────────────────────────

export const TK7 = {
  /** The head's centre: 0.74 W with the list on the left, 0.26 W on the right, within 0.03 W. */
  headX: { left: 0.74, right: 0.26 },
  headTol: 0.03,
  /** Stills: the eyes at 0.40 H (band 0.36–0.46), the face box 0.18–0.30 W wide. */
  eyes: 0.4,
  eyesBand: [0.36, 0.46] as const,
  faceWidth: [0.18, 0.3] as const,
  /** O119: a still may extend sideways up to 0.12 W. */
  sideExtension: 0.12,
  /** The press shot's slow push, only when the photo has the pixels. */
  push: [1.0, 1.04] as const,
  /** O118: no text pixel inside the head box grown by 0.02 H. */
  grow: 0.02,
  /** O39 on clips: the head under text ≤ 10 % of the window, ≤ 0.5 s in a row. */
  clipShare: 0.1,
  clipRunS: 0.5,
  /** O93: every clip has a 9:16 window of at least 675 px. */
  minWindowPx: 675,
} as const;

export function headTargetX(list: ListSide): number {
  return TK7.headX[list] * W;
}

export function headOnTarget(headCentreX: number, list: ListSide): boolean {
  return Math.abs(headCentreX - headTargetX(list)) <= TK7.headTol * W + 1e-6;
}

export type StillPlacement = { scale: number; left: number; top: number; push: boolean };

export type StillRefusal = { refused: "cant_clear"; side: "left" | "right" } | { refused: "head_on_list" };

/**
 * A press shot placed for the template: the face box 0.18–0.30 W wide (as
 * near 0.24 W as the pixels allow, never upscaled), the eyes at 0.40 H (in
 * 0.36–0.46), the head's centre at the target x. The photo covers the frame,
 * extended sideways by at most 0.12 W (O119). The push runs only when the
 * photo still has the pixels at 1.04.
 */
export function placeStill(photo: Size, face: { box: Rect; eyesY: number }, list: ListSide): StillPlacement | StillRefusal {
  const maxScale = 1; // no upscaling
  const cover = Math.max(W / photo.width, H / photo.height);
  const wantFace = 0.24 * W;
  let scale = Math.max(cover, Math.min(maxScale, wantFace / face.box.width));
  const faceW = face.box.width * scale;
  if (faceW < TK7.faceWidth[0] * W - 1e-6 && scale >= maxScale - 1e-9 && cover > maxScale + 1e-9) return { refused: "head_on_list" };
  if (faceW > TK7.faceWidth[1] * W + 1e-6) scale = Math.max(cover, (TK7.faceWidth[1] * W) / face.box.width);
  const cx = (face.box.left + face.box.width / 2) * scale;
  const ey = face.eyesY * scale;
  let left = headTargetX(list) - cx;
  let top = TK7.eyes * H - ey;
  const ext = TK7.sideExtension * W;
  const minLeft = W - photo.width * scale - ext;
  const maxLeft = ext;
  let clamped: "left" | "right" | null = null;
  if (left > maxLeft) {
    left = maxLeft;
    clamped = "left";
  }
  if (left < minLeft) {
    left = minLeft;
    clamped = "right";
  }
  top = Math.min(0, Math.max(H - photo.height * scale, top));
  const headX = left + cx;
  if (!headOnTarget(headX, list)) return { refused: "cant_clear", side: clamped ?? (headX < headTargetX(list) ? "left" : "right") };
  const eyesAt = (top + ey) / H;
  if (eyesAt < TK7.eyesBand[0] - 1e-6 || eyesAt > TK7.eyesBand[1] + 1e-6) return { refused: "head_on_list" };
  const push = scale * TK7.push[1] <= maxScale + 1e-9;
  return { scale, left, top, push };
}

/** A clip's crop focus x (0–1 of the source) that puts the head's centre at the target, inside the source. */
export function clipFocusX(source: Size, headCentreX: number, list: ListSide): { cropFocusX: number; windowWidth: number; ok: boolean } {
  const winW = Math.min(source.width, source.height * (W / H));
  const target = TK7.headX[list];
  // The window's left edge puts the head at `target` of the window.
  const leftEdge = Math.min(source.width - winW, Math.max(0, headCentreX - target * winW));
  const headInWindow = (headCentreX - leftEdge) / winW;
  return { cropFocusX: (leftEdge + winW / 2) / source.width, windowWidth: winW, ok: winW >= TK7.minWindowPx && Math.abs(headInWindow - target) <= TK7.headTol + 1e-6 };
}

/** The head box grown by 0.02 H on every side (O118). */
export function grownHead(head: Rect): Rect {
  const g = TK7.grow * H;
  return { left: head.left - g, top: head.top - g, width: head.width + 2 * g, height: head.height + 2 * g };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The ink box of a placed line (cap top to baseline, its measured width). */
export function lineBox(l: PlacedLine): Rect {
  return { left: l.left, top: l.capTop, width: l.width, height: l.capPx };
}

/** O118 for stills: no text pixel (box) inside the grown head box, in any state. */
export function textClearOfHead(boxes: readonly Rect[], head: Rect): boolean {
  const g = grownHead(head);
  return boxes.every((b) => overlap(b, g) === 0);
}

/** O39 for clips: over the samples, the head's share under text stays ≤ 10 % of the window and never runs past 0.5 s. */
export function clipFaceOk(samples: readonly { tS: number; head: Rect | null }[], boxes: readonly Rect[]): boolean {
  let run = 0;
  let last: number | null = null;
  for (const s of samples) {
    const hit = s.head ? boxes.reduce((a, b) => a + overlap(b, s.head!), 0) / (W * H) : 0;
    if (hit > TK7.clipShare) return false;
    if (hit > 0) {
      run += last == null ? 0 : s.tS - last;
      if (run > TK7.clipRunS + 1e-9) return false;
    } else run = 0;
    last = s.tS;
  }
  return true;
}

/** Every text box sits inside O96's band (x 120–960, y 353–1238). */
export function insideBand(boxes: readonly Rect[]): boolean {
  const b = TOP_TRACKS.band;
  return boxes.every((r) => r.left >= b.left - 0.5 && r.left + r.width <= b.right + 0.5 && r.top >= b.top - 0.5 && r.top + r.height <= b.bottom + 0.5);
}

/** TK7: every montage clip's head on the same side (the side away from the list). */
export function montageOneSide(heads: readonly number[], list: ListSide): number | null {
  const bad = heads.findIndex((x) => (list === "left" ? x < W / 2 : x > W / 2));
  return bad >= 0 ? bad : null;
}

// ── TK8: bands and contrast ─────────────────────────────────────────────────

export const TK8 = {
  /** O25's top band: 20 % black, to 0.44 H. */
  top: { alpha: 0.2, toH: 0.44 },
  /** The side band: black at the list's outer edge falling to 0 at 0.60 W; steps 55 → 70 → 85 % (O57). */
  sideSteps: [0.55, 0.7, 0.85] as const,
  sideToW: 0.6,
  /** p95 (O40): playing ≥ 4.5:1, played ≥ 3:1; the accent misses at 3:1 → white. */
  playing: 4.5,
  played: 3,
  accent: 3,
} as const;

/** The side band's alpha at x (0..W), for a list on `side`, at step `step`. */
export function sideBandAlpha(x: number, side: ListSide, step: number): number {
  const a = TK8.sideSteps[Math.min(step, TK8.sideSteps.length - 1)]!;
  const d = side === "left" ? x / W : (W - x) / W;
  return d >= TK8.sideToW ? 0 : a * (1 - d / TK8.sideToW);
}

/** The top band's alpha at y. */
export function topBandAlpha(y: number): number {
  return y / H >= TK8.top.toH ? 0 : TK8.top.alpha * (1 - y / H / TK8.top.toH);
}

/** Combined band alpha (black) at a pixel: the two bands stacked. */
export function bandAlpha(x: number, y: number, side: ListSide, step: number): number {
  const s = sideBandAlpha(x, side, step);
  const t = topBandAlpha(y);
  return 1 - (1 - s) * (1 - t);
}

export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The p95 (brightest 5 %) background luminance under the given boxes, after the bands at `step`. RGB(A) frame. */
export function p95Luminance(frame: { data: Uint8Array; width: number; height: number; channels: number }, boxes: readonly Rect[], side: ListSide, step: number): number {
  const lums: number[] = [];
  const sx = frame.width / W;
  const sy = frame.height / H;
  for (const b of boxes) {
    for (let y = Math.max(0, Math.floor(b.top)); y < Math.min(H, Math.ceil(b.top + b.height)); y += 2) {
      for (let x = Math.max(0, Math.floor(b.left)); x < Math.min(W, Math.ceil(b.left + b.width)); x += 2) {
        const i = (Math.min(frame.height - 1, Math.floor(y * sy)) * frame.width + Math.min(frame.width - 1, Math.floor(x * sx))) * frame.channels;
        const k = 1 - bandAlpha(x, y, side, step);
        lums.push(relativeLuminance(frame.data[i]! * k, frame.data[i + 1]! * k, frame.data[i + 2]! * k));
      }
    }
  }
  if (!lums.length) return 0;
  lums.sort((a, b) => a - b);
  return lums[Math.min(lums.length - 1, Math.floor(0.95 * (lums.length - 1)))]!;
}

/** White text at opacity `level` over a background of luminance `bg`: its luminance as seen. */
export function blendedWhite(level: number, bg: number): number {
  return level * 1 + (1 - level) * bg;
}

export type ContrastVerdict = { step: number; accentWhite: boolean } | { refused: true };

/**
 * TK8: the side band steps 55 → 70 → 85 % until the playing state (white at
 * 100 %) reaches 4.5:1 and the played state (white at 70 %) 3:1 on every
 * sampled frame's p95. Then the accent: missing 3:1 at the step chosen sends
 * the marker and bar white. `p95ByStep[s]` is the worst sampled p95 at step s.
 */
export function judgeContrast(p95ByStep: readonly number[], accentLuminance: number): ContrastVerdict {
  for (let s = 0; s < TK8.sideSteps.length; s += 1) {
    const bg = p95ByStep[s] ?? 1;
    const playing = contrastRatio(1, bg) >= TK8.playing - 1e-9;
    const played = contrastRatio(blendedWhite(0.7, bg), bg) >= TK8.played - 1e-9;
    if (playing && played) return { step: s, accentWhite: contrastRatio(accentLuminance, bg) < TK8.accent - 1e-9 };
  }
  return { refused: true };
}

// ── TK9: the end card in the list's column ──────────────────────────────────

export const TK9 = {
  /** The kit's event lockup, top at 353, 0.22 W wide. */
  lockupWidth: 0.22,
  /** The artist's name, cap 0.05 H, O3's steps, at most 2 lines, never split inside a word. */
  nameCap: 0.05,
  nameSteps: [1, 0.85, 0.75] as const,
  /** Gaps (invented in the build): lockup → name and name → date, in caps of the name. */
  gapPerCap: 0.6,
  /** The claim's steps (O23): two lines at most. */
  claimSteps: [1, 0.85, 0.75] as const,
  claimCap: 0.034,
  dateCap: 0.022,
} as const;

export type EndCardLayout = { lockup: Rect; name: PlacedLine[]; date: PlacedLine | null; claim: PlacedLine[] };

/**
 * The date end in the list's column, top-down: the lockup from 353 (0.22 W),
 * the artist's name, T1's date line, and the approved live claim with its
 * last line on 1238. No claim: lockup, name and date. A claim that doesn't
 * fit the column at its last step refuses (CLAIM_DOESNT_FIT).
 */
export function layoutEndCard(input: { column: { left: number; right: number }; lockupAspect: number; name: string; date: string; claim: string | null; measure: Measure }): EndCardLayout | { refused: "claim" } | { refused: "name" } {
  const { column, measure } = input;
  const width = column.right - column.left;
  const band = TOP_TRACKS.band;
  const lockupW = TK9.lockupWidth * W;
  const lockup: Rect = { left: column.left, top: band.top, width: lockupW, height: lockupW / input.lockupAspect };
  const nameFit = fitSteps(input.name, TK9.nameCap * H, TK9.nameSteps, width, 2, measure);
  if (!nameFit) return { refused: "name" };
  const pitch = (c: number) => c * TK_TYPE.pitchPerCap;
  const nameTop = lockup.top + lockup.height + TK9.gapPerCap * nameFit.capPx;
  const name: PlacedLine[] = nameFit.lines.map((text, i) => ({ text, capPx: nameFit.capPx, capTop: nameTop + i * pitch(nameFit.capPx), left: column.left, width: measure(text, nameFit.capPx), role: "title" }));
  const dateCap = TK9.dateCap * H;
  const dateTop = name[name.length - 1]!.capTop + nameFit.capPx + TK9.gapPerCap * nameFit.capPx;
  const date: PlacedLine = { text: input.date, capPx: dateCap, capTop: dateTop, left: column.left, width: measure(input.date, dateCap), role: "title" };
  let claim: PlacedLine[] = [];
  if (input.claim) {
    const fit = fitSteps(input.claim, TK9.claimCap * H, TK9.claimSteps, width, 2, measure);
    if (!fit) return { refused: "claim" };
    const lastTop = band.bottom - fit.capPx;
    claim = fit.lines.map((text, i) => ({ text, capPx: fit.capPx, capTop: lastTop - (fit.lines.length - 1 - i) * pitch(fit.capPx), left: column.left, width: measure(text, fit.capPx), role: "title" }));
    if (claim[0]!.capTop < dateTop + dateCap + TK9.gapPerCap * nameFit.capPx - 1e-6) return { refused: "claim" };
  }
  return { lockup, name, date, claim };
}

export { wrap };
