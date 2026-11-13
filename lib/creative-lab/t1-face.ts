/**
 * O39 / O56 / O64. The face judge, with no model and no image decoder, so a
 * caption render can run it without pulling face-api into the function.
 */

import { claimOn, type Rect } from "./t1-video-frame.ts";

export const T1V_FACE = {
  /** O64 (amends O56): a face counts only at this share of the output's W and wider (86 px on 1080, 58 px on a 720 source). */
  minWidth: 0.08,
  /** O56: only the upper part of its box is tested (brow to nose). */
  upper: 0.6,
  /** Samples a second. */
  fps: 5,
  /** At most this share of samples with the face in type (while that type is on screen). */
  maxShare: 0.1,
  /** Never longer than this in a row. */
  maxRunS: 0.5,
  /** Each type box padded this much, px of the format. */
  pad: 12,
  /** Faces under this share of the main face's width don't count (O19). */
  minFaceShare: 0.5,
} as const;

/** O71: with no claim, the share is over the clip's length. */
export const faceShareLine = (pct: number, claim = true): string =>
  `Face in the type for ${pct} % of ${claim ? "the claim's time" : "the clip"} — choose another crop or clip`;

export const faceRunLine = (t: number): string => `Face in the type for ${t.toFixed(1)} s at a time — choose another crop or clip`;

export type FaceSample = { tS: number; faces: Rect[] };

const pad = (r: Rect, p: number): Rect => ({ left: r.left - p, top: r.top - p, width: r.width + 2 * p, height: r.height + 2 * p });
const touches = (a: Rect, b: Rect) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** O56: the faces that count — at least 0.08 W wide, and at least half the widest such face. */
export function countedFaces(faces: readonly Rect[], frameWidth: number): Rect[] {
  const big = faces.filter((f) => f.width >= T1V_FACE.minWidth * frameWidth - 1e-9);
  if (!big.length) return [];
  const main = Math.max(...big.map((f) => f.width));
  return big.filter((f) => f.width >= T1V_FACE.minFaceShare * main - 1e-9);
}

/** O56: the part of a face box that's tested — its upper 60 %. */
export const upperFace = (f: Rect): Rect => ({ ...f, height: f.height * T1V_FACE.upper });

export type FaceVerdict = { ok: boolean; topShare: number; claimShare: number; longestRunS: number; line: string | null };

/**
 * O39 as amended by O56: the upper 60 % of each counted face against the
 * type that's on screen, each box padded 12 px: `always` (the top block, and
 * the date in B) from frame 0, `claim` after 1.5 s. Shares are over the
 * samples in which that type is on screen; a run counts consecutive samples
 * touching any on-screen type, each sample 1 / fps seconds.
 */
export function judgeFaceOverTime(samples: readonly FaceSample[], boxes: { always: readonly Rect[]; claim: Rect | null }, opts: { fps?: number; frameWidth?: number } = {}): FaceVerdict {
  const fps = opts.fps ?? T1V_FACE.fps;
  const W = opts.frameWidth ?? 1080;
  const always = boxes.always.map((b) => pad(b, T1V_FACE.pad));
  const claim = boxes.claim ? pad(boxes.claim, T1V_FACE.pad) : null;
  let topHits = 0;
  let claimHits = 0;
  let claimSamples = 0;
  let run = 0;
  let longest = 0;
  for (const s of samples) {
    const faces = countedFaces(s.faces, W).map(upperFace);
    const onClaim = !!claim && claimOn(s.tS);
    if (onClaim) claimSamples += 1;
    const hitTop = faces.some((f) => always.some((b) => touches(f, b)));
    const hitClaim = onClaim && faces.some((f) => touches(f, claim!));
    if (hitTop) topHits += 1;
    if (hitClaim) claimHits += 1;
    run = hitTop || hitClaim ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const topShare = samples.length ? topHits / samples.length : 0;
  const claimShare = claimSamples ? claimHits / claimSamples : 0;
  const longestRunS = longest / fps;
  const ok = topShare <= T1V_FACE.maxShare + 1e-9 && claimShare <= T1V_FACE.maxShare + 1e-9 && longestRunS <= T1V_FACE.maxRunS + 1e-9;
  const pct = Math.round(Math.max(topShare, claimShare) * 100);
  // O65: refused on the run alone, the line gives the run; otherwise the share.
  const shareOk = topShare <= T1V_FACE.maxShare + 1e-9 && claimShare <= T1V_FACE.maxShare + 1e-9;
  return { ok, topShare, claimShare, longestRunS, line: ok ? null : shareOk ? faceRunLine(longestRunS) : faceShareLine(pct, !!claim) };
}
