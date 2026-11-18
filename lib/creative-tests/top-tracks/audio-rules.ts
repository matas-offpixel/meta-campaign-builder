/**
 * Top tracks TK3, as issue 2 re-rules it for studio tracks
 * (docs/design-record/2026-11-18-creative-lab-top-tracks.html TK3, and
 * docs/design-record/2026-11-18-creative-lab-top-tracks-2.html TK12–TK17):
 * one snippet per track, shaped by the track. Pure: it reads studio.ts's
 * grid and drops (Beat This! and the Demucs bass stem) and analysis.ts's
 * pitch content, and returns the window, the drop it chose, the hook and
 * the row's words. Every string is a record's.
 *
 *   1. The grid (TK13): Beat This!'s downbeats; a bar runs downbeat to
 *      downbeat. Unsteady (16 bars around the drop off by more than 3 %) or
 *      no downbeats: the seconds cut, with its line.
 *   2. The window (TK3, standing): bars before the drop nearest 6 s within
 *      4–8 s, or from the hook's bar when that's earlier; bars after nearest
 *      8 s within 6–10 s; 10–20 s long, the order of adjustment, the refusals.
 *   3. Which drop (TK15 = TK3's choice on TK14's drops): the last drop in the
 *      last third that fits, else the latest earlier one.
 *   4. The hook (TK16): TK3's phrase finder on TK13's bars.
 *
 * VW14's kicks, its drops on a track and the bass-stem fallback are gone
 * from studio tracks (HK11). Live clips keep VW14–VW17 elsewhere.
 */

import { chromaOver, type TrackFeatures } from "./analysis.ts";
import { BEAT_UNREAD, findBassDrops, snapToDownbeat, studioGrid, type BassDrop, type StudioAnalysis, type StudioGrid } from "./studio.ts";

export const TK3 = {
  /** A snippet is 10–20 s. */
  minLength: 10,
  maxLength: 20,
  /** Before the drop: whole bars closest to 6 s, within 4–8 s. */
  before: { target: 6, min: 4, max: 8 },
  /** After the drop: whole bars closest to 8 s, within 6–10 s; 6 s is the floor. */
  after: { target: 8, min: 6, max: 10 },
  /** The last third starts at two thirds of the file's length. */
  lastThird: 2 / 3,
  /** The hook: phrases of 1, 2 or 4 bars, matching at 0.90 or more, in 3 places or more. */
  phraseBars: [1, 2, 4] as const,
  phraseMatch: 0.9,
  phraseMinPlaces: 3,
  /** Places starting within 8 bars after any drop are that drop's own loop. */
  dropLoopBars: 8,
  /** 20 s less the 6 s floor. */
  hookMaxBeforeS: 14,
  /** CT1's fades, and the join: each next snippet starts 0.75 s before the one before ends. */
  fadeIn: 0.25,
  fadeOut: 1.5,
  overlapS: 0.75,
  /** The end card covers the last snippet's last 3.0 s, or 2.5 s with no CTA. */
  endCardS: 3.0,
  endCardNoCtaS: 2.5,
} as const;

const EPS = 1e-6;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** "2:07". */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds + EPS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type { StudioGrid };

/** Uniform downbeats every `barS` from `first` to the end (tests and fixtures). */
export function uniformDownbeats(first: number, barS: number, durationS: number): number[] {
  const out: number[] = [];
  for (let k = 0; first + k * barS <= durationS + EPS; k += 1) out.push(r3(first + k * barS));
  return out;
}

// ── 2. The window ───────────────────────────────────────────────────────────

export type SnippetWindow = {
  startS: number;
  endS: number;
  lengthS: number;
  dropS: number;
  /** "bars" when cut on the grid; "seconds" with the no-beat line. */
  cut: "bars" | "seconds";
  /** The grid's median bar, for the line. */
  barS: number | null;
  barsBefore: number | null;
  barsAfter: number | null;
  /** The hook the start was taken from, when it was earlier than the no-hook start. */
  fromHook: boolean;
};

export type WindowRefusal = { refused: "over_20" } | { refused: "room"; side: "start" | "end" };

export type WindowInput = { dropS: number; durationS: number; grid: StudioGrid; hookS?: number | null };

/** The whole number of bars (downbeat steps) whose span is nearest `target` within [min, max]; ties go to fewer bars. */
function nearestBars(spans: readonly number[], span: { target: number; min: number; max: number }): number | null {
  let best: number | null = null;
  for (let n = 1; n <= spans.length; n += 1) {
    const s = spans[n - 1]!;
    if (s < span.min - EPS || s > span.max + EPS) continue;
    if (best === null || Math.abs(s - span.target) < Math.abs(spans[best - 1]! - span.target) - EPS) best = n;
  }
  return best;
}

/**
 * TK3's window around a drop on TK13's bars. With a hook marker the start
 * is the downbeat at or just before the hook's start, or the no-hook start
 * if that's earlier (a hook never shortens the lead-up). The end stays
 * inside the file, never under the 6 s floor. Under 10 s: bars are added
 * after, to 10 s after, then before, to 8 s before. Over 20 s: the end
 * comes in to its floor; still over is refused.
 */
export function snippetWindow(input: WindowInput): SnippetWindow | WindowRefusal {
  const { dropS, durationS, grid } = input;
  const hook = input.hookS != null && input.hookS < dropS - EPS ? input.hookS : null;
  if (grid.steady) {
    const db = grid.downbeats;
    // spansBefore[n-1] = drop − the n-th downbeat before it; spansAfter[m-1] = the m-th downbeat after it − drop.
    const before = db.filter((d) => d < dropS - EPS).reverse();
    const after = db.filter((d) => d > dropS + EPS && d <= durationS + EPS);
    const spansBefore = before.map((d) => dropS - d);
    const spansAfter = after.map((d) => d - dropS);
    const noHook = nearestBars(spansBefore, TK3.before);
    if (noHook === null) return { refused: "room", side: "start" };
    let n = noHook;
    let fromHook = false;
    if (hook !== null) {
      const at = spansBefore.findIndex((s) => dropS - s <= hook + 1e-3);
      const hookBars = at >= 0 ? at + 1 : null;
      if (hookBars === null) return { refused: "room", side: "start" };
      if (hookBars > n) {
        n = hookBars;
        fromHook = true;
      }
    }
    const floorIdx = spansAfter.findIndex((s) => s >= TK3.after.min - EPS);
    if (floorIdx < 0) return { refused: "room", side: "end" };
    const floor = floorIdx + 1;
    let m = nearestBars(spansAfter, TK3.after) ?? floor;
    const len = () => spansBefore[n - 1]! + spansAfter[m - 1]!;
    // Under 10 s: bars after, up to 10 s after, then before, up to 8 s before.
    while (len() < TK3.minLength - EPS && m < spansAfter.length && spansAfter[m]! <= TK3.after.max + EPS) m += 1;
    while (len() < TK3.minLength - EPS && n < spansBefore.length && spansBefore[n]! <= TK3.before.max + EPS) n += 1;
    // Over 20 s: the end comes in to its floor.
    while (len() > TK3.maxLength + EPS && m > floor) m -= 1;
    if (len() > TK3.maxLength + EPS) return { refused: "over_20" };
    const startS = dropS - spansBefore[n - 1]!;
    const endS = dropS + spansAfter[m - 1]!;
    return { startS: r3(startS), endS: r3(endS), lengthS: r3(endS - startS), dropS, cut: "bars", barS: grid.barS, barsBefore: n, barsAfter: m, fromHook };
  }
  // No steady beat: start 6.0 s before the drop (or at the hook), end 8.0 s after.
  let startS = dropS - TK3.before.target;
  let fromHook = false;
  if (hook !== null && hook < startS - EPS) {
    startS = hook;
    fromHook = true;
  }
  if (startS < -EPS) return { refused: "room", side: "start" };
  let endS = Math.min(dropS + TK3.after.target, durationS);
  if (endS - dropS < TK3.after.min - EPS) return { refused: "room", side: "end" };
  if (endS - startS < TK3.minLength - EPS) endS = Math.min(durationS, dropS + TK3.after.max, startS + TK3.minLength);
  if (endS - startS < TK3.minLength - EPS) startS = Math.max(0, dropS - TK3.before.max, endS - TK3.minLength);
  if (endS - startS > TK3.maxLength + EPS) endS = Math.max(dropS + TK3.after.min, startS + TK3.maxLength);
  if (endS - startS > TK3.maxLength + EPS) return { refused: "over_20" };
  return { startS: r3(startS), endS: r3(endS), lengthS: r3(endS - startS), dropS, cut: "seconds", barS: null, barsBefore: null, barsAfter: null, fromHook };
}

export function isWindow(w: SnippetWindow | WindowRefusal): w is SnippetWindow {
  return !("refused" in w);
}

// ── 3. Which drop (TK15) ────────────────────────────────────────────────────

/** TK3's qualifying test: the window fits the file around the drop (the bars before it, the 6 s floor after it). */
export function qualifies(dropS: number, durationS: number, downbeats: readonly number[]): boolean {
  return isWindow(snippetWindow({ dropS, durationS, grid: studioGrid(downbeats, dropS) }));
}

export type DropChoice =
  | { kind: "last" | "earlier"; dropS: number; lastThirdFromS: number; candidates: readonly number[] }
  | { kind: "no_room"; side: "start" | "end"; lastThirdFromS: number; candidates: readonly number[] }
  | { kind: "none"; lastThirdFromS: number; candidates: readonly number[] };

/**
 * TK15: the last drop in the last third that fits the window, else the
 * latest earlier one. `fits` is the qualifying test: TK3's window by
 * default; the snippet static passes CT1's (TK17).
 */
export function chooseDrop(input: { drops: readonly number[]; durationS: number; downbeats: readonly number[]; fits?: (dropS: number) => boolean }): DropChoice {
  const lastThirdFromS = r3(input.durationS * TK3.lastThird);
  const candidates = [...input.drops].sort((a, b) => a - b);
  const fits = input.fits ?? ((t: number) => qualifies(t, input.durationS, input.downbeats));
  const ok = candidates.filter(fits);
  const late = ok.filter((t) => t >= lastThirdFromS - EPS);
  if (late.length) return { kind: "last", dropS: late[late.length - 1]!, lastThirdFromS, candidates };
  const early = ok.filter((t) => t < lastThirdFromS - EPS);
  if (early.length) return { kind: "earlier", dropS: early[early.length - 1]!, lastThirdFromS, candidates };
  if (!candidates.length) return { kind: "none", lastThirdFromS, candidates };
  const latest = candidates[candidates.length - 1]!;
  const w = snippetWindow({ dropS: latest, durationS: input.durationS, grid: studioGrid(input.downbeats, latest) });
  return { kind: "no_room", side: isWindow(w) ? "end" : w.refused === "room" ? w.side : "end", lastThirdFromS, candidates };
}

// ── 4. The hook (TK16) ──────────────────────────────────────────────────────

/** Pearson correlation of two chroma vectors (centred cosine): a flat chord loop doesn't match everything. */
export function chromaSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

export type Phrase = { bars: number; places: number[] };

/**
 * TK3's repeated phrase, on TK13's bars: a phrase is 1, 2 or 4 bars; two
 * places match when their bars' pitch content averages 0.90 similarity or
 * more. The phrase is the one with the most places (at least 3), the longer
 * on a tie, then the earlier. Places starting within 8 bars after any drop
 * don't count. `bars` is each bar's chroma, in order; `barTimes` the bars'
 * downbeats; `dropBarIndex` each drop's bar.
 */
export function findPhrase(bars: readonly ArrayLike<number>[], barTimes: readonly number[], dropBarIndex: readonly number[]): Phrase | null {
  const excluded = (i: number) => dropBarIndex.some((d) => i >= d && i < d + TK3.dropLoopBars);
  let best: { bars: number; places: number[] } | null = null;
  for (const len of TK3.phraseBars) {
    for (let i = 0; i + len <= bars.length; i += 1) {
      if (excluded(i)) continue;
      const places = [i];
      for (let j = i + len; j + len <= bars.length; j += 1) {
        if (j < places[places.length - 1]! + len) continue;
        if (excluded(j)) continue;
        let sim = 0;
        for (let k = 0; k < len; k += 1) sim += chromaSimilarity(bars[i + k]!, bars[j + k]!);
        if (sim / len >= TK3.phraseMatch - EPS) places.push(j);
      }
      if (places.length < TK3.phraseMinPlaces) continue;
      if (!best || places.length > best.places.length || (places.length === best.places.length && len > best.bars)) best = { bars: len, places };
    }
  }
  return best ? { bars: best.bars, places: best.places.map((p) => barTimes[p]!) } : null;
}

export type HookResult =
  | { kind: "hook"; hookS: number; phrase: Phrase }
  | { kind: "too_far"; hookS: number; phrase: Phrase }
  | { kind: "none" };

/** The HOOK marker: the start of the phrase's last place that ends at or before the chosen drop; more than 14 s back is left off. */
export function hookFromPhrase(phrase: Phrase | null, dropS: number, downbeats: readonly number[]): HookResult {
  if (!phrase) return { kind: "none" };
  const end = (p: number) => {
    const i = downbeats.findIndex((d) => Math.abs(d - p) < 1e-3);
    return i >= 0 && i + phrase.bars < downbeats.length ? downbeats[i + phrase.bars]! : Infinity;
  };
  const before = phrase.places.filter((p) => end(p) <= dropS + EPS);
  if (!before.length) return { kind: "none" };
  const hookS = before[before.length - 1]!;
  if (dropS - hookS > TK3.hookMaxBeforeS + EPS) return { kind: "too_far", hookS, phrase };
  return { kind: "hook", hookS, phrase };
}

/** TK16: the hook on TK13's bars; with no steady grid there is no phrase. Read from the master's mids, not a stem. */
export function findHook(f: Pick<TrackFeatures, "chroma" | "hopS" | "durationS">, dropS: number, grid: StudioGrid, dropTimes: readonly number[]): HookResult {
  if (!grid.steady) return { kind: "none" };
  const db = grid.downbeats.filter((d) => d <= f.durationS + EPS);
  const times = db.slice(0, -1);
  const bars = times.map((t, i) => chromaOver(f, t, db[i + 1]!));
  const barOf = (t: number) => {
    let k = 0;
    for (let i = 0; i < times.length; i += 1) if (times[i]! <= t + EPS) k = i;
    return k;
  };
  return hookFromPhrase(findPhrase(bars, times, dropTimes.map(barOf)), dropS, db);
}

// ── Words (TK3, TK10, TK14, TK18) ───────────────────────────────────────────

export const NO_STEADY_BEAT = "No steady beat found — cut on seconds, not bars.";
export const NO_PHRASE = "No repeated phrase found";

export function dropRowText(choice: Extract<DropChoice, { dropS: number }>): string {
  return choice.kind === "earlier" ? `Drop ${mmss(choice.dropS)} · an earlier drop (no later drop fits)` : `Drop ${mmss(choice.dropS)} · the last drop`;
}

export function hookMarker(hookS: number): string {
  return `HOOK · ${mmss(hookS)}`;
}

export function hookTooFar(hookS: number): string {
  return `Hook ${mmss(hookS)} is too far before the drop — left off.`;
}

export function hookSetBy(firstName: string): string {
  return `Hook set by ${firstName}`;
}

export function dropSetBy(firstName: string): string {
  return `Drop set by ${firstName}`;
}

export function over20Refusal(title: string): string {
  return `${title}: from the hook to 6 s after the drop is over 20 s — move the hook marker.`;
}

export function roomRefusal(title: string, side: "start" | "end"): string {
  return `${title}: the drop is too close to the ${side} of the file — move the marker or pick another track.`;
}

export function noDropRefusal(title: string): string {
  return `${title}: no drop found — drag the drop marker to it.`;
}

/** TK10: "{start}–{end} · {length} s · {bars} bars" (a seconds cut has no bars). */
export function spanLine(w: Pick<SnippetWindow, "startS" | "endS" | "lengthS" | "cut" | "barsBefore" | "barsAfter">): string {
  const len = (Math.round(w.lengthS * 10) / 10).toFixed(1);
  const bars = w.cut === "bars" ? ` · ${(w.barsBefore ?? 0) + (w.barsAfter ?? 0)} bars` : "";
  return `${mmss(w.startS)}–${mmss(w.endS)} · ${len} s${bars}`;
}

// ── One track, end to end ───────────────────────────────────────────────────

export type TrackPlan =
  | {
      ok: true;
      choice: Extract<DropChoice, { dropS: number }>;
      window: SnippetWindow;
      hook: HookResult;
      grid: StudioGrid;
      drops: BassDrop[];
      lines: string[];
    }
  | { ok: false; refusal: string; choice: DropChoice; drops: BassDrop[]; lines: string[] };

export type OperatorMarks = {
  /** A drop the operator set ("Drop set by {first name}"), kept over the Lab's choice; it snaps to the nearest downbeat (TK14). */
  dropS?: number | null;
  dropSetBy?: string | null;
  /** A hook the operator placed or cleared ("Hook set by {first name}"). undefined: the Lab's hook. null: cleared. */
  hookS?: number | null;
  hookSetBy?: string | null;
};

/**
 * TK3 for one studio track: the grid and drops from the analysis (TK13,
 * TK14), the drop (the operator's, or TK15's choice), the hook (the
 * operator's, or TK16's), the window and the row's lines. `analysis` null
 * is TK18's failure: "Couldn't read this track's beat — drag the drop
 * marker to it.", and the seconds cut for an operator's drop.
 */
export function planTrack(input: { title: string; features: Pick<TrackFeatures, "chroma" | "hopS" | "durationS">; analysis: StudioAnalysis | null; marks?: OperatorMarks }): TrackPlan {
  const { title, features } = input;
  const durationS = features.durationS;
  const marks = input.marks ?? {};
  const downbeats = input.analysis?.downbeats ?? [];
  const drops = input.analysis ? findBassDrops(input.analysis).drops : [];
  const lab = chooseDrop({ drops: drops.map((d) => d.tS), durationS, downbeats });
  let choice: DropChoice = lab;
  if (marks.dropS != null) {
    const snapped = downbeats.length ? snapToDownbeat(marks.dropS, downbeats) : marks.dropS;
    choice = { kind: "last", dropS: snapped, lastThirdFromS: lab.lastThirdFromS, candidates: lab.candidates };
  }
  if (!("dropS" in choice)) {
    const refusal = !input.analysis ? BEAT_UNREAD : choice.kind === "none" ? noDropRefusal(title) : roomRefusal(title, choice.side);
    return { ok: false, refusal, choice, drops, lines: [refusal] };
  }
  const dropS = choice.dropS;
  const grid = studioGrid(downbeats, dropS);
  let hook: HookResult;
  if (marks.hookS === null) hook = { kind: "none" };
  else if (marks.hookS !== undefined) hook = { kind: "hook", hookS: marks.hookS, phrase: { bars: 0, places: [marks.hookS] } };
  else hook = findHook(features, dropS, grid, drops.map((d) => d.tS));
  const hookS = hook.kind === "hook" ? hook.hookS : null;
  const w = snippetWindow({ dropS, durationS, grid, hookS });
  const lines: string[] = [];
  if (!input.analysis) lines.push(BEAT_UNREAD);
  lines.push(marks.dropS != null && marks.dropSetBy ? `Drop ${mmss(dropS)} · ${dropSetBy(marks.dropSetBy)}` : dropRowText(choice));
  if (hook.kind === "hook") lines.push(marks.hookS != null && marks.hookSetBy ? `${hookMarker(hook.hookS)} · ${hookSetBy(marks.hookSetBy)}` : hookMarker(hook.hookS));
  else if (hook.kind === "too_far") lines.push(hookTooFar(hook.hookS));
  else if (marks.hookS === null && marks.hookSetBy) lines.push(hookSetBy(marks.hookSetBy));
  else lines.push(NO_PHRASE);
  if (!grid.steady) lines.push(NO_STEADY_BEAT);
  if (!isWindow(w)) {
    const refusal = w.refused === "over_20" ? over20Refusal(title) : roomRefusal(title, w.side);
    return { ok: false, refusal, choice, drops, lines: [...lines, refusal] };
  }
  lines.push(spanLine(w));
  return { ok: true, choice, window: w, hook, grid, drops, lines };
}
