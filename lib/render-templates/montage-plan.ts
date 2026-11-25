/**
 * lib/render-templates/montage-plan.ts — the 15 s montage, planned on the
 * track's kicks, and its cut sheet (spec, Montage per-recipe checklist).
 *
 *   - 15 s at 30 fps, 16 distinct clips, no repeats.
 *   - The window starts on a kick a whole number of beats before the drop,
 *     so the drop lands 3–5 s in (as near 4 s as the tempo allows) and on a
 *     kick.
 *   - Cuts land on kicks and accelerate into the break: before the drop the
 *     clips run a half, a quarter, an eighth and an eighth of the build;
 *     after it the rest share the kicks left, as evenly as they go.
 *   - A white flash on each kick from the drop on.
 *   - Text (teaser and announcement): the hook from frame 0; date and venue
 *     on the drop; the lineup one name per cut (announcement only); the
 *     logo and CTA at the close, from the last cut at least 2 s before the
 *     end. Every change is a cut, so it lands on a kick. No text: none.
 *   - The cut sheet: the beat grid, the drop and how it was picked, every cut
 *     and text change with its time and the kick it lands on, and how far off
 *     it is in frames. checkCutSheet fails any change more than one frame
 *     off a kick.
 *
 * Pure. Relative imports only (node:test).
 */

import type { BeatGrid } from "./beats.ts";
import type { MontageVariant } from "./file-name.ts";

export const MONTAGE = {
  fps: 30,
  durationS: 15,
  clips: 16,
  dropFrom: 3,
  dropTo: 5,
  dropAim: 4,
  /** The close (logo and CTA) starts on the last cut at least this long before the end. */
  closeAtLeastS: 2,
  /** A flash's frames: full white, then fading. */
  flashFrames: 3,
  /** Date and venue hold for this many cuts before the first name (announcement). */
  detailsCuts: 2,
} as const;

export type MontageClip = {
  id: string;
  /** For the cut sheet and the checks only: the file's own name. */
  name: string;
  owner: "artist" | "promoter";
  isHeadliner: boolean;
  /** The clip's marked moment (creative_lab_clips.in_s / out_s), seconds into the source. */
  inS: number;
  outS: number;
};

export type MontageText = {
  hook: string;
  date: string;
  venue: string;
  lineup: readonly string[];
  /** The claim's lines, read from the tiers (the CTA at the close). */
  cta: readonly string[];
};

export type Segment = { index: number; clipId: string; fromFrame: number; frames: number; sourceStartS: number; kickIndex: number };
export type TextKind = "hook" | "details" | "name" | "close";
export type TextBlock = { kind: TextKind; lines: string[]; fromFrame: number; toFrame: number };

export type CutSheetChange = {
  what: string;
  atS: number;
  frame: number;
  kickIndex: number;
  kickS: number;
  offFrames: number;
};

export type CutSheet = {
  fps: number;
  durationS: number;
  track: { name: string; bpm: number; periodS: number; windowStartS: number; kicksS: number[] };
  drop: { trackS: number; atS: number; kickIndex: number; source: "lab" | "operator"; how: string };
  cuts: CutSheetChange[];
  texts: Record<MontageVariant, CutSheetChange[]>;
  flashes: number[];
};

export type MontagePlan = {
  window: { startS: number; endS: number };
  dropAtS: number;
  /** Kick times inside the window, seconds from its start. */
  kicks: number[];
  dropKick: number;
  segments: Segment[];
  flashes: number[];
  texts: Record<MontageVariant, TextBlock[]>;
  sheet: CutSheet;
};

export type PlanRefusal = { refused: "drop_too_early" | "too_few_kicks" | "too_few_clips" | "repeat_clip" };

const HOW: Record<"lab" | "operator", string> = {
  lab: "the biggest rise in low-end energy after a build, past the first 20 seconds (CT4), moved onto its kick",
  operator: "set by hand on the Snippet tab, moved onto its kick",
};

const frameOf = (s: number, fps: number) => Math.round(s * fps);

/** The pre-drop cut beats: a half, a quarter, an eighth, an eighth of the build, strictly increasing. */
export function buildBeats(dropKick: number): number[] {
  const raw = [0, Math.round(dropKick / 2), Math.round((3 * dropKick) / 4), Math.round((7 * dropKick) / 8)];
  const out: number[] = [];
  for (const b of raw) if (b < dropKick && (out.length === 0 || b > out[out.length - 1]!)) out.push(b);
  return out;
}

/** n segments over the kicks [from, to) as evenly as they go: each start kick. */
export function spreadBeats(from: number, to: number, n: number): number[] {
  const span = to - from;
  if (n <= 0) return [];
  if (span < n) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(from + Math.floor((i * span) / n));
  return out;
}

/** Order the picks: headliners first, then the rest, each group as picked. */
export function orderClips(clips: readonly MontageClip[]): MontageClip[] {
  return [...clips.filter((c) => c.isHeadliner), ...clips.filter((c) => !c.isHeadliner)];
}

export function planMontage(input: {
  grid: BeatGrid;
  drop: { trackS: number; source: "lab" | "operator" };
  trackName: string;
  clips: readonly MontageClip[];
  text: MontageText;
}): MontagePlan | PlanRefusal {
  const { fps, durationS } = MONTAGE;
  if (input.clips.length < MONTAGE.clips) return { refused: "too_few_clips" };
  const ids = input.clips.map((c) => c.id);
  if (new Set(ids).size !== ids.length) return { refused: "repeat_clip" };
  const grid = input.grid;
  // The drop kick: the grid kick nearest the stored drop.
  let dropIdx = 0;
  for (let i = 1; i < grid.kicks.length; i += 1) {
    if (Math.abs(grid.kicks[i]! - input.drop.trackS) < Math.abs(grid.kicks[dropIdx]! - input.drop.trackS)) dropIdx = i;
  }
  const dropTrackS = grid.kicks[dropIdx]!;
  // Beats before the drop: as near 4 s as the tempo allows, inside 3–5 s.
  let n = Math.round(MONTAGE.dropAim / grid.periodS);
  const offset = (k: number) => (dropIdx - k >= 0 ? dropTrackS - grid.kicks[dropIdx - k]! : Infinity);
  while (n > 1 && offset(n) > MONTAGE.dropTo) n -= 1;
  while (offset(n) < MONTAGE.dropFrom && dropIdx - n - 1 >= 0) n += 1;
  if (dropIdx - n < 0 || offset(n) < MONTAGE.dropFrom || offset(n) > MONTAGE.dropTo) return { refused: "drop_too_early" };
  const startS = grid.kicks[dropIdx - n]!;
  const endS = startS + durationS;
  const kicks = grid.kicks.filter((k) => k >= startS - 1e-9 && k < endS).map((k) => Math.round((k - startS) * 10000) / 10000);
  const dropKick = n;
  const closeLatest = durationS - MONTAGE.closeAtLeastS;

  const pre = buildBeats(dropKick);
  const postCount = MONTAGE.clips - pre.length;
  // The post-drop clips share the kicks from the drop to the last kick in the window.
  const post = spreadBeats(dropKick, kicks.length, postCount);
  if (post.length !== postCount) return { refused: "too_few_kicks" };
  const starts = [...pre, ...post];
  const ordered = orderClips(input.clips).slice(0, MONTAGE.clips);
  const totalFrames = durationS * fps;
  const segments: Segment[] = starts.map((k, i) => {
    const fromFrame = frameOf(kicks[k]!, fps);
    const next = i + 1 < starts.length ? frameOf(kicks[starts[i + 1]!]!, fps) : totalFrames;
    const clip = ordered[i]!;
    return { index: i, clipId: clip.id, fromFrame, frames: next - fromFrame, sourceStartS: clip.inS, kickIndex: k };
  });
  const flashes = kicks.slice(dropKick).map((k) => frameOf(k, fps));

  // Text, on cuts only.
  const cutFrames = segments.map((s) => s.fromFrame);
  const dropSeg = segments.findIndex((s) => s.kickIndex === dropKick);
  let closeSeg = segments.length - 1;
  for (let i = segments.length - 1; i > dropSeg; i -= 1) {
    if (segments[i]!.fromFrame / fps <= closeLatest) {
      closeSeg = i;
      break;
    }
  }
  const block = (kind: TextKind, lines: readonly string[], fromSeg: number, toSeg: number): TextBlock => ({
    kind,
    lines: [...lines],
    fromFrame: cutFrames[fromSeg]!,
    toFrame: toSeg < segments.length ? cutFrames[toSeg]! : totalFrames,
  });
  const hook = block("hook", [input.text.hook], 0, dropSeg);
  const close = block("close", input.text.cta, closeSeg, segments.length);
  const teaser: TextBlock[] = [hook, block("details", [input.text.date, input.text.venue], dropSeg, closeSeg), close];
  const announcement: TextBlock[] = [hook];
  const nameFrom = Math.min(dropSeg + MONTAGE.detailsCuts, closeSeg);
  const names = input.text.lineup.slice(0, Math.max(0, closeSeg - nameFrom));
  announcement.push(block("details", [input.text.date, input.text.venue], dropSeg, names.length ? nameFrom : closeSeg));
  names.forEach((name, i) => announcement.push(block("name", [name], nameFrom + i, i === names.length - 1 ? closeSeg : nameFrom + i + 1)));
  announcement.push(close);
  const texts: Record<MontageVariant, TextBlock[]> = { "no-text": [], teaser, announcement };

  const change = (what: string, frame: number): CutSheetChange => {
    const atS = frame / fps;
    let ki = 0;
    for (let i = 1; i < kicks.length; i += 1) if (Math.abs(kicks[i]! - atS) < Math.abs(kicks[ki]! - atS)) ki = i;
    return { what, atS: Math.round(atS * 1000) / 1000, frame, kickIndex: ki, kickS: kicks[ki]!, offFrames: Math.round(Math.abs(atS - kicks[ki]!) * fps * 100) / 100 };
  };
  const textChanges = (blocks: readonly TextBlock[]) => blocks.map((b) => change(`${b.kind}: ${b.lines.join(" / ")}`, b.fromFrame));
  const sheet: CutSheet = {
    fps,
    durationS,
    track: { name: input.trackName, bpm: grid.bpm, periodS: Math.round(grid.periodS * 10000) / 10000, windowStartS: startS, kicksS: kicks },
    drop: { trackS: dropTrackS, atS: kicks[dropKick]!, kickIndex: dropKick, source: input.drop.source, how: HOW[input.drop.source] },
    cuts: segments.slice(1).map((s) => change(`cut ${s.index + 1}: ${ordered[s.index]!.name}`, s.fromFrame)),
    texts: { "no-text": [], teaser: textChanges(teaser), announcement: textChanges(announcement) },
    flashes,
  };
  return { window: { startS, endS }, dropAtS: kicks[dropKick]!, kicks, dropKick, segments, flashes, texts, sheet };
}

/** Where the drop lands in the montage for this grid (the card's "drop at {s} s"), or null when it can't land 3–5 s in. */
export function dropOffsetS(grid: Pick<BeatGrid, "kicks" | "periodS">, dropTrackS: number): number | null {
  if (!grid.kicks.length) return null;
  let dropIdx = 0;
  for (let i = 1; i < grid.kicks.length; i += 1) if (Math.abs(grid.kicks[i]! - dropTrackS) < Math.abs(grid.kicks[dropIdx]! - dropTrackS)) dropIdx = i;
  const dropS = grid.kicks[dropIdx]!;
  const offset = (k: number) => (dropIdx - k >= 0 ? dropS - grid.kicks[dropIdx - k]! : Infinity);
  let n = Math.round(MONTAGE.dropAim / grid.periodS);
  while (n > 1 && offset(n) > MONTAGE.dropTo) n -= 1;
  while (offset(n) < MONTAGE.dropFrom && dropIdx - n - 1 >= 0) n += 1;
  const o = offset(n);
  return o >= MONTAGE.dropFrom && o <= MONTAGE.dropTo ? Math.round(o * 1000) / 1000 : null;
}

export function isRefusal(plan: MontagePlan | PlanRefusal): plan is PlanRefusal {
  return "refused" in plan;
}

/**
 * The cut-sheet check: every cut and text change within one frame of a kick,
 * and the drop 3–5 s in and on a kick. Returns what failed, or [].
 */
export function checkCutSheet(sheet: CutSheet, variant: MontageVariant): string[] {
  const failures: string[] = [];
  const within = (c: CutSheetChange) => Math.abs(c.frame / sheet.fps - c.kickS) <= 1 / sheet.fps + 1e-9;
  for (const c of sheet.cuts) if (!within(c)) failures.push(`${c.what} is ${c.offFrames} frames off kick ${c.kickIndex}`);
  for (const c of sheet.texts[variant]) if (!within(c)) failures.push(`${c.what} is ${c.offFrames} frames off kick ${c.kickIndex}`);
  if (sheet.drop.atS < MONTAGE.dropFrom || sheet.drop.atS > MONTAGE.dropTo) failures.push(`the drop is at ${sheet.drop.atS} s, outside 3–5 s`);
  if (Math.abs(sheet.drop.atS - sheet.track.kicksS[sheet.drop.kickIndex]!) > 1 / sheet.fps) failures.push("the drop is off its kick");
  return failures;
}

/** The cut sheet as text, filed beside the render. */
export function cutSheetText(sheet: CutSheet, variant: MontageVariant): string {
  const lines = [
    `Track: ${sheet.track.name} · ${sheet.track.bpm} BPM · window from ${sheet.track.windowStartS.toFixed(3)} s`,
    `Kicks (s): ${sheet.track.kicksS.map((k) => k.toFixed(3)).join(", ")}`,
    `Drop: ${sheet.drop.atS.toFixed(3)} s (track ${sheet.drop.trackS.toFixed(3)} s), kick ${sheet.drop.kickIndex}: ${sheet.drop.how}`,
    "Cuts:",
    ...sheet.cuts.map((c) => `  ${c.atS.toFixed(3)} s · frame ${c.frame} · kick ${c.kickIndex} (${c.kickS.toFixed(3)} s) · ${c.offFrames} frames off · ${c.what}`),
    `Text (${variant}):`,
    ...sheet.texts[variant].map((c) => `  ${c.atS.toFixed(3)} s · frame ${c.frame} · kick ${c.kickIndex} (${c.kickS.toFixed(3)} s) · ${c.offFrames} frames off · ${c.what}`),
    `Flashes (frames): ${sheet.flashes.join(", ")}`,
  ];
  return lines.join("\n") + "\n";
}
