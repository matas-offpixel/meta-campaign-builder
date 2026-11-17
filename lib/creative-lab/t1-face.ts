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

/**
 * `heads` (O120): the artist's head on the sample, output px: the main face's whole box, or the person mask's
 * head when no face was found. Tested whole (not O56's upper 60 %), with the same padding and limits.
 */
export type FaceSample = { tS: number; faces: Rect[]; heads?: Rect[] };

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
 *
 * `coverInterval` (caption placement below 5 fps): a hit sample counts as
 * the full interval on each side, because the face may have been there for
 * up to that long unseen, so k consecutive hits are a run of (k + 1) / fps.
 * At 2 fps a lone hit is 1.0 s and fails the 0.5 s run limit. Sampled from
 * the same start, any face 5 fps would fail on a run (3 hits spanning a
 * 0.4 s stretch on its 0.2 s grid) covers a 2 fps sample, so this never
 * passes a run 5 fps fails.
 */
export function judgeFaceOverTime(samples: readonly FaceSample[], boxes: { always: readonly Rect[]; claim: Rect | null }, opts: { fps?: number; frameWidth?: number; coverInterval?: boolean } = {}): FaceVerdict {
  const fps = opts.fps ?? T1V_FACE.fps;
  const W = opts.frameWidth ?? 1080;
  const always = boxes.always.map((b) => pad(b, T1V_FACE.pad));
  const claim = boxes.claim ? pad(boxes.claim, T1V_FACE.pad) : null;
  let topHits = 0;
  let claimHits = 0;
  let claimSamples = 0;
  let run = 0;
  let longest = 0;
  const tested = (s: FaceSample): Rect[] => [...countedFaces(s.faces, W).map(upperFace), ...(s.heads ?? [])];
  for (const s of samples) {
    const faces = tested(s);
    const onClaim = !!claim && claimOn(s.tS);
    if (onClaim) claimSamples += 1;
    const hitTop = faces.some((f) => always.some((b) => touches(f, b)));
    const hitClaim = onClaim && faces.some((f) => touches(f, claim!));
    if (hitTop) topHits += 1;
    if (hitClaim) claimHits += 1;
    run = hitTop || hitClaim ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let topShare = samples.length ? topHits / samples.length : 0;
  const claimShare = claimSamples ? claimHits / claimSamples : 0;
  let longestRunS = longest / fps;
  if (opts.coverInterval && samples.length) {
    // Each sample's real neighbours (jittered or uniform): a run of hits reaches back to the sample before it and
    // on to the one after it; a sample's share weight is half the gap on each side. Uniform samples give
    // (k + 1) / fps and the plain share, as before.
    const t = samples.map((s) => s.tS);
    const gap = (i: number) => (i + 1 < t.length ? t[i + 1]! - t[i]! : i > 0 ? t[i]! - t[i - 1]! : 1 / fps);
    const before = (i: number) => (i > 0 ? t[i - 1]! : t[i]! - gap(i));
    const after = (i: number) => (i + 1 < t.length ? t[i + 1]! : t[i]! + gap(i));
    const hit = samples.map((s) => {
      const faces = tested(s);
      return faces.some((f) => always.some((b) => touches(f, b))) || (!!claim && claimOn(s.tS) && faces.some((f) => touches(f, claim)));
    });
    longestRunS = 0;
    let weightAll = 0;
    let weightHit = 0;
    for (let i = 0; i < hit.length; i += 1) {
      const w = (after(i) - before(i)) / 2;
      weightAll += w;
      if (hit[i]) weightHit += w;
      if (!hit[i] || (i > 0 && hit[i - 1])) continue;
      let j = i;
      while (j + 1 < hit.length && hit[j + 1]) j += 1;
      longestRunS = Math.max(longestRunS, after(j) - before(i));
    }
    topShare = weightAll > 0 ? weightHit / weightAll : 0;
  }
  const ok = topShare <= T1V_FACE.maxShare + 1e-9 && claimShare <= T1V_FACE.maxShare + 1e-9 && longestRunS <= T1V_FACE.maxRunS + 1e-9;
  const pct = Math.round(Math.max(topShare, claimShare) * 100);
  // O65: refused on the run alone, the line gives the run; otherwise the share.
  const shareOk = topShare <= T1V_FACE.maxShare + 1e-9 && claimShare <= T1V_FACE.maxShare + 1e-9;
  return { ok, topShare, claimShare, longestRunS, line: ok ? null : shareOk ? faceRunLine(longestRunS) : faceShareLine(pct, !!claim) };
}
