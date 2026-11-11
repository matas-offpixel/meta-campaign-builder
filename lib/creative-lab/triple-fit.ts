/**
 * The triple-fit (overlay templates issue 16, O108–O116,
 * docs/design-record/2026-11-11-overlay-templates-16.html): one landscape
 * clip shown three times in one 9:16, each copy a third of the height, all
 * through the same window at the same timecode, with the clip's own sound
 * played once. T1 on a clip, arrangement B only, inside issue 15's band and
 * clear of the seams. Pure rules only. The composition is
 * src/remotion/compositions/TripleFitOnClip.tsx.
 *
 * The Lab's tiles, groups, offer and import are Cursor's files this round
 * (clips.tsx, surface.ts, selection.ts, import-quality.ts, clip-intake.ts,
 * render.ts): the functions here are ready for them to call.
 */

import type { Rect, Size } from "./artist-card.ts";
import { TOO_SMALL_FOR_916, tooSmallFor916 } from "./import-quality.ts";
import type { ClipLayout, FaceSample } from "./t1-video.ts";
import { bandChecks, t1BandSlots, type BandCheck, type BandSlot } from "./video-band.ts";
import { TRIPLE_FIT, partPlacements, partScale, partWindow, type PartPlacement, type PartWindow } from "./triple-fit-frame.ts";

export { TRIPLE_FIT, partPlacements, partScale, partWindow, type PartPlacement, type PartWindow };

export const TF_LINES = {
  /** O108: a triple-fit clip's one tile line. */
  landscape: "Landscape — triple-fit only",
  group: (n: number) => `Triple-fit only · ${n}`,
  make: "Make a triple-fit",
  /** O114: the made triple-fit's own tile. */
  tile: (n: number) => `Triple-fit · #${n}`,
  /** Under both floors: O93's words, unchanged. */
  tooSmall: TOO_SMALL_FOR_916,
  /** Invented here (O109 gives the 6 s rule, not its words), in T1's "Clip too short" form. */
  tooShort: "Clip too short for a triple-fit — needs 6 s",
  /** O111: A's date crosses the 640 seam. Invented words. */
  arrangementB: "A triple-fit takes T1 arrangement B only",
  /** O111: UGC captions and quote mode cross the 640 seam. Invented words. */
  noCaption: "A triple-fit takes T1, never a UGC caption or quote mode",
  /** O116: T2's lineup crosses the 640 seam. Invented words. */
  noPromoter: "Triple-fits aren't made from promoter clips yet",
  /** O110 / the existing clip flag, carried onto the triple-fit. */
  musicMatch: "Music match — mute or replace before launch",
} as const;

export type ClipKind = { kind: "916"; line: null } | { kind: "triple-fit"; line: typeof TF_LINES.landscape } | { kind: "too-small"; line: typeof TOO_SMALL_FOR_916 };

/**
 * O108: a clip that makes its own 9:16 runs as itself. One too small for it
 * whose part window is at least 675 px wide is a triple-fit clip. Under both
 * floors it keeps "Too small for 9:16". A portrait clip is never a triple-fit.
 */
export function clipKind(source: Size): ClipKind {
  if (!tooSmallFor916(source)) return { kind: "916", line: null };
  if (source.width > source.height && partWindow(source).width + 1e-9 >= TRIPLE_FIT.minWindowPx) return { kind: "triple-fit", line: TF_LINES.landscape };
  return { kind: "too-small", line: TOO_SMALL_FOR_916 };
}

/** O93 as O108 amends it: the import refuses only a clip under both floors, with O93's words. */
export function importRefusal(source: Size): string | null {
  return clipKind(source).kind === "too-small" ? TOO_SMALL_FOR_916 : null;
}

/**
 * O108: "Make a triple-fit" shows on a triple-fit clip's tile when its owner
 * has fewer than 3 clips that run in 9:16. Never for the promoter yet (O116),
 * never for a clip under 6 s (O109), never twice from one clip (O114).
 */
export function offerTripleFit(args: { source: Size; durationS: number; owner: "artist" | "promoter"; runnable916: number; alreadyMade: boolean }): boolean {
  if (args.owner !== "artist" || args.alreadyMade) return false;
  if (clipKind(args.source).kind !== "triple-fit") return false;
  if (args.durationS + 1e-9 < TRIPLE_FIT.minS) return false;
  return args.runnable916 < TRIPLE_FIT.offerBelow;
}

/** O108: the tile groups' order within an owner: the clips that can run, then "Triple-fit only · {n}", then "Can't run". */
export function groupOf(source: Size, refused: boolean): "runs" | "triple-fit only" | "can't run" {
  if (refused) return "can't run";
  const k = clipKind(source).kind;
  return k === "916" ? "runs" : k === "triple-fit" ? "triple-fit only" : "can't run";
}

/** O109: the render's length, the stored window up to 30 s, or the too-short line. */
export function tripleFitLength(inS: number, outS: number): { ok: true; seconds: number } | { ok: false; line: string } {
  const seconds = Math.min(TRIPLE_FIT.maxS, Math.max(0, outS - inS));
  return seconds + 1e-9 >= TRIPLE_FIT.minS ? { ok: true, seconds } : { ok: false, line: TF_LINES.tooShort };
}

/** O63: the scale from the window, refused past 1.6× with O93's words. */
export function tripleFitUpscale(source: Size, cropFocusX = 0.5, cropFocusY = 0.5): { ok: true; scale: number; window: PartWindow } | { ok: false; scale: number; window: PartWindow; line: string } {
  const window = partWindow(source, cropFocusX, cropFocusY);
  const scale = partScale(window);
  return scale <= TRIPLE_FIT.maxUpscale + 1e-9 ? { ok: true, scale, window } : { ok: false, scale, window, line: TOO_SMALL_FOR_916 };
}

/** O110: the clip's own track once; a music match carries its flag; no track runs silent. */
export function tripleFitSound(clip: { hasAudio: boolean; audioMatch?: boolean | null; audioStatus?: string | null }): { muted: boolean; flag: string | null } {
  const muted = !clip.hasAudio || clip.audioStatus === "muted";
  return { muted, flag: clip.audioMatch ? TF_LINES.musicMatch : null };
}

// ─── O111: type and the seams ───────────────────────────────────────────────

/** The two seam clearances, y 616–664 and 1256–1304. */
export const SEAM_ZONES: readonly { seam: number; top: number; bottom: number }[] = TRIPLE_FIT.seams.map((s) => ({ seam: s, top: s - TRIPLE_FIT.seamClear, bottom: s + TRIPLE_FIT.seamClear }));

/** O111: no type ink within 24 px of a seam. */
export function seamChecks(slots: readonly BandSlot[]): BandCheck[] {
  return slots.map(({ slot, box }) => {
    const hit = SEAM_ZONES.find((z) => box.top < z.bottom && box.top + box.height > z.top);
    return { slot, ok: !hit, why: hit ? `ink ${Math.round(box.top)}–${Math.round(box.top + box.height)} in the ${hit.seam} seam's ${TRIPLE_FIT.seamClear} px (${hit.top}–${hit.bottom})` : null };
  });
}

/**
 * H103: a triple-fit's type passes issue 15's band check (H94) and the seam
 * check. Arrangement A is refused outright: its date (632–689) crosses 640.
 */
export function tripleFitTypeChecks(layout: ClipLayout): BandCheck[] {
  if (layout.arrangement !== "B") return [{ slot: "arrangement", ok: false, why: TF_LINES.arrangementB }];
  const slots = t1BandSlots(layout);
  const band = bandChecks(slots);
  const seam = seamChecks(slots);
  return slots.map((s, i) => (band[i]!.ok ? seam[i]! : band[i]!));
}

/** O111: which part each slot sits on. The top block on part 1, the date and claim on part 2, nothing on part 3. */
export function partOf(box: Rect): 1 | 2 | 3 {
  const mid = box.top + box.height / 2;
  return mid < TRIPLE_FIT.seams[0] ? 1 : mid < TRIPLE_FIT.seams[1] ? 2 : 3;
}

// ─── O112: faces ────────────────────────────────────────────────────────────

const toPart = (r: Rect): Rect => ({ ...r, top: r.top - TRIPLE_FIT.partTops[partOf(r) - 1]! });

/**
 * O112: the type boxes in the part's own coordinates. The top block (part
 * 1) and the date (part 2) are on screen throughout; the claim (part 2)
 * from 1.5 s. One window, so one face test reads the union of the two sets.
 */
export function partFaceBoxes(layout: ClipLayout): { always: Rect[]; claim: Rect | null; union: { top: number; bottom: number } } {
  const always = [toPart(layout.boxes.top), toPart(layout.boxes.date)];
  const claim = layout.boxes.claim ? toPart(layout.boxes.claim) : null;
  const all = [...always, ...(claim ? [claim] : [])];
  return { always, claim, union: { top: Math.min(...all.map((r) => r.top)), bottom: Math.max(...all.map((r) => r.top + r.height)) } };
}

/** O112: source face boxes mapped into the part (1080 × 640) through the shared window. The floor is then 0.08 of the part's width. */
export function facesInPart(samples: readonly { tS: number; faces: readonly Rect[] }[], window: PartWindow): FaceSample[] {
  const k = partScale(window);
  return samples.map((s) => ({ tS: s.tS, faces: s.faces.map((f) => ({ left: (f.left - window.left) * k, top: (f.top - window.top) * k, width: f.width * k, height: f.height * k })) }));
}

/** O112: crop candidates (O56) along the window's slack, tried once for the clip; candidates giving the same window are tried once (O73). */
export function partCropCandidates(source: Size, own: { x: number; y: number }, steps: readonly number[] = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]): { x: number; y: number }[] {
  const w = partWindow(source);
  const alongX = w.height === source.height;
  const values = [alongX ? own.x : own.y, ...steps].map((v) => Math.round(v * 100) / 100);
  const seen = new Set<string>();
  const out: { x: number; y: number }[] = [];
  for (const v of values) {
    const c = alongX ? { x: v, y: own.y } : { x: own.x, y: v };
    const win = partWindow(source, c.x, c.y);
    const key = `${Math.round(win.left)}:${Math.round(win.top)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** O113: one clip, so its own rights decide the channels. */
export const tripleFitChannels = <T>(clipChannels: T): T => clipChannels;
