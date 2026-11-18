/**
 * Top tracks TK3 (docs/design-record/2026-11-18-creative-lab-top-tracks.html):
 * one snippet per track, shaped by the track. Pure: it reads analysis.ts's
 * kicks, drops and pitch content and returns the window, the drop it chose,
 * the hook and the row's words. Every string is the record's.
 *
 * The order of the record is kept:
 *
 *   1. The bar grid from the kicks in the 8 s before a drop (the median gap
 *      is a beat, 4 beats a bar, the drop on a downbeat); gaps varying by more
 *      than 3 % cut on seconds instead.
 *   2. The window: bars before the drop closest to 6 s (4–8 s), or from the
 *      hook's bar when that's earlier; bars after closest to 8 s (6–10 s);
 *      10–20 s long, with the record's order of adjustment and its refusal.
 *   3. Which drop: every VW14 drop; one qualifies when the window fits the
 *      file around it (the bars before, the 6 s floor after); the last
 *      qualifying drop in the last third wins, else the last before it (an
 *      earlier drop, not an error). With none, the bass-stem ranking's top 2
 *      (bass-stem.ts), the later that qualifies, the last third first.
 *   4. The hook: the last place the track's repeated phrase plays before the
 *      chosen drop, found on the bar grid; left off when more than 14 s back.
 */

import { chromaOver, type FoundDrop, type TrackFeatures } from "./analysis.ts";

export const TK3 = {
  /** A snippet is 10–20 s. */
  minLength: 10,
  maxLength: 20,
  /** Before the drop: whole bars closest to 6 s, within 4–8 s. */
  before: { target: 6, min: 4, max: 8 },
  /** After the drop: whole bars closest to 8 s, within 6–10 s; 6 s is the floor. */
  after: { target: 8, min: 6, max: 10 },
  /** The beat is read from the kicks in the 8 s before the drop. */
  gridWindowS: 8,
  beatsPerBar: 4,
  /** Gaps varying by more than this cut on seconds. */
  steadiness: 0.03,
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

// ── 1. The bar grid ─────────────────────────────────────────────────────────

export type BarGrid =
  | { steady: true; beatS: number; barS: number; gaps: number }
  | { steady: false; beatS: number | null; spread: number | null; gaps: number };

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
}

/**
 * TK3: a beat is the median gap between kicks in the 8 s before the drop; a
 * bar is 4 beats. "Vary by more than 3 %" is read as: the middle 80 % of the
 * gaps (10th to 90th percentile) aren't all within ±3 % of the median. Fewer
 * than 4 gaps is no steady beat.
 */
export function barGrid(kicks: readonly number[], dropS: number): BarGrid {
  const k = kicks.filter((t) => t >= dropS - TK3.gridWindowS - EPS && t < dropS - EPS);
  const gaps = k.slice(1).map((t, i) => t - k[i]!);
  if (gaps.length < 4) return { steady: false, beatS: null, spread: null, gaps: gaps.length };
  const sorted = [...gaps].sort((a, b) => a - b);
  const beat = quantile(sorted, 0.5);
  const lo = quantile(sorted, 0.1);
  const hi = quantile(sorted, 0.9);
  const spread = beat > 0 ? Math.max(beat - lo, hi - beat) / beat : Infinity;
  if (!(beat > 0) || spread > TK3.steadiness + EPS) return { steady: false, beatS: beat > 0 ? r3(beat) : null, spread: Number.isFinite(spread) ? Math.round(spread * 1000) / 1000 : null, gaps: gaps.length };
  return { steady: true, beatS: beat, barS: beat * TK3.beatsPerBar, gaps: gaps.length };
}

/** Whole bars whose length is closest to `target`, within [min, max]; ties go to fewer bars. Null when no whole number fits. */
export function barsNear(barS: number, span: { target: number; min: number; max: number }): number | null {
  let best: number | null = null;
  for (let n = 1; n * barS <= span.max + EPS; n += 1) {
    if (n * barS < span.min - EPS) continue;
    if (best === null || Math.abs(n * barS - span.target) < Math.abs(best * barS - span.target) - EPS) best = n;
  }
  return best;
}

/** The fewest whole bars reaching `floor` seconds. */
function barsAtLeast(barS: number, floor: number): number {
  return Math.max(1, Math.ceil(floor / barS - EPS));
}

// ── 2. The window ───────────────────────────────────────────────────────────

export type SnippetWindow = {
  startS: number;
  endS: number;
  lengthS: number;
  dropS: number;
  /** "bars" when cut on the grid; "seconds" with the no-beat line. */
  cut: "bars" | "seconds";
  barS: number | null;
  barsBefore: number | null;
  barsAfter: number | null;
  /** The hook the start was taken from, when it was earlier than the no-hook start. */
  fromHook: boolean;
};

export type WindowRefusal = { refused: "over_20" } | { refused: "room"; side: "start" | "end" };

export type WindowInput = { dropS: number; durationS: number; grid: BarGrid; hookS?: number | null };

/**
 * TK3's window around a drop. With a hook marker the start is the bar at or
 * just before the hook's start, or the no-hook start if that's earlier (a
 * hook never shortens the lead-up). The end stays inside the file, never
 * under the 6 s floor. Under 10 s: bars are added after, to 10 s after,
 * then before, to 8 s before. Over 20 s: the end comes in to its floor;
 * still over is refused.
 */
export function snippetWindow(input: WindowInput): SnippetWindow | WindowRefusal {
  const { dropS, durationS, grid } = input;
  const hook = input.hookS != null && input.hookS < dropS - EPS ? input.hookS : null;
  if (grid.steady) {
    const bar = grid.barS;
    const noHook = barsNear(bar, TK3.before);
    if (noHook === null) return { refused: "room", side: "start" };
    let before = noHook;
    let fromHook = false;
    if (hook !== null) {
      const hookBars = Math.ceil((dropS - hook) / bar - EPS);
      if (hookBars > before) {
        before = hookBars;
        fromHook = true;
      }
    }
    const floor = barsAtLeast(bar, TK3.after.min);
    const room = Math.floor((durationS - dropS) / bar + EPS);
    let after = Math.min(barsNear(bar, TK3.after) ?? floor, room);
    if (after < floor) return { refused: "room", side: "end" };
    if (dropS - before * bar < -EPS) return { refused: "room", side: "start" };
    // Under 10 s: whole bars after the drop, up to 10 s, then before it, up to 8 s.
    while ((before + after) * bar < TK3.minLength - EPS && (after + 1) * bar <= TK3.after.max + EPS && after + 1 <= room) after += 1;
    while ((before + after) * bar < TK3.minLength - EPS && (before + 1) * bar <= TK3.before.max + EPS && dropS - (before + 1) * bar >= -EPS) before += 1;
    // Over 20 s: the end comes in to its 6 s floor, in bars.
    while ((before + after) * bar > TK3.maxLength + EPS && after > floor) after -= 1;
    if ((before + after) * bar > TK3.maxLength + EPS) return { refused: "over_20" };
    const startS = dropS - before * bar;
    const endS = dropS + after * bar;
    return { startS: r3(startS), endS: r3(endS), lengthS: r3(endS - startS), dropS, cut: "bars", barS: bar, barsBefore: before, barsAfter: after, fromHook };
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

// ── 3. Which drop ───────────────────────────────────────────────────────────

/** A drop qualifies when TK3's window fits the file around it: the bars before it and the 6 s floor after it. */
export function qualifies(dropS: number, durationS: number, kicks: readonly number[]): boolean {
  return isWindow(snippetWindow({ dropS, durationS, grid: barGrid(kicks, dropS) }));
}

export type DropChoice =
  | { kind: "last" | "earlier" | "bass_stem"; dropS: number; lastThirdFromS: number; candidates: readonly number[] }
  | { kind: "no_room"; side: "start" | "end"; lastThirdFromS: number; candidates: readonly number[] }
  | { kind: "none"; lastThirdFromS: number; candidates: readonly number[] };

function pickLatest(times: readonly number[], durationS: number, kicks: readonly number[]): { dropS: number; inLastThird: boolean } | null {
  const from = durationS * TK3.lastThird;
  const ok = times.filter((t) => qualifies(t, durationS, kicks)).sort((a, b) => a - b);
  const late = ok.filter((t) => t >= from - EPS);
  if (late.length) return { dropS: late[late.length - 1]!, inLastThird: true };
  const early = ok.filter((t) => t < from - EPS);
  if (early.length) return { dropS: early[early.length - 1]!, inLastThird: false };
  return null;
}

/**
 * TK3's choice. `bassStemTop2` is the bass-stem ranking's two best times
 * (bass-stem.ts), consulted only when VW14 finds no qualifying drop; null
 * when that ranking isn't available (the fallback can't run).
 */
export function chooseDrop(input: { drops: readonly Pick<FoundDrop, "tS">[]; durationS: number; kicks: readonly number[]; bassStemTop2?: readonly number[] | null }): DropChoice {
  const lastThirdFromS = r3(input.durationS * TK3.lastThird);
  const vw14 = input.drops.map((d) => d.tS);
  const own = pickLatest(vw14, input.durationS, input.kicks);
  if (own) return { kind: own.inLastThird ? "last" : "earlier", dropS: own.dropS, lastThirdFromS, candidates: vw14 };
  const stem = (input.bassStemTop2 ?? []).slice(0, 2);
  const fromStem = pickLatest(stem, input.durationS, input.kicks);
  if (fromStem) return { kind: "bass_stem", dropS: fromStem.dropS, lastThirdFromS, candidates: vw14 };
  const any = [...vw14, ...stem];
  if (!any.length) return { kind: "none", lastThirdFromS, candidates: vw14 };
  // Found, but nothing fits: the room line names the side the latest drop runs out of.
  const latest = Math.max(...any);
  const w = snippetWindow({ dropS: latest, durationS: input.durationS, grid: barGrid(input.kicks, latest) });
  return { kind: "no_room", side: isWindow(w) ? "end" : w.refused === "room" ? w.side : "end", lastThirdFromS, candidates: vw14 };
}

// ── 4. The hook ─────────────────────────────────────────────────────────────

/** Bar starts across the whole file on the chosen drop's grid (the drop on a downbeat). */
export function barStarts(dropS: number, barS: number, durationS: number): number[] {
  const out: number[] = [];
  const first = dropS - Math.floor(dropS / barS + EPS) * barS;
  for (let t = first; t + barS <= durationS + EPS; t += barS) out.push(r3(t));
  return out;
}

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
 * TK3's repeated phrase: a phrase is 1, 2 or 4 bars; two places match when
 * their bars' pitch content averages 0.90 similarity or more. The phrase is
 * the one with the most places (at least 3), the longer on a tie, then the
 * earlier. Places starting within 8 bars after any drop don't count.
 * `bars` is each bar's chroma, in order; `barTimes` their start times.
 */
export function findPhrase(bars: readonly ArrayLike<number>[], barTimes: readonly number[], barS: number, dropTimes: readonly number[]): Phrase | null {
  const excluded = (t: number) => dropTimes.some((d) => t >= d - EPS && t < d + TK3.dropLoopBars * barS - EPS);
  let best: { bars: number; places: number[] } | null = null;
  for (const len of TK3.phraseBars) {
    for (let i = 0; i + len <= bars.length; i += 1) {
      if (excluded(barTimes[i]!)) continue;
      const places = [i];
      for (let j = i + len; j + len <= bars.length; j += 1) {
        if (j < places[places.length - 1]! + len) continue;
        if (excluded(barTimes[j]!)) continue;
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
export function hookFromPhrase(phrase: Phrase | null, dropS: number, barS: number): HookResult {
  if (!phrase) return { kind: "none" };
  const before = phrase.places.filter((p) => p + phrase.bars * barS <= dropS + EPS);
  if (!before.length) return { kind: "none" };
  const hookS = before[before.length - 1]!;
  if (dropS - hookS > TK3.hookMaxBeforeS + EPS) return { kind: "too_far", hookS, phrase };
  return { kind: "hook", hookS, phrase };
}

/** The hook from the file: needs a steady grid (the phrase is found on bars); without one there is no phrase. */
export function findHook(f: Pick<TrackFeatures, "chroma" | "hopS" | "durationS">, dropS: number, grid: BarGrid, dropTimes: readonly number[]): HookResult {
  if (!grid.steady) return { kind: "none" };
  const times = barStarts(dropS, grid.barS, f.durationS);
  const bars = times.map((t) => chromaOver(f, t, t + grid.barS));
  return hookFromPhrase(findPhrase(bars, times, grid.barS, dropTimes), dropS, grid.barS);
}

// ── Words (TK3, TK10) ───────────────────────────────────────────────────────

export const NO_STEADY_BEAT = "No steady beat found — cut on seconds, not bars.";
export const NO_PHRASE = "No repeated phrase found";
export const FOUND_ON_BASS_STEM = " · found on the bass stem";

export function dropRowText(choice: Extract<DropChoice, { dropS: number }>): string {
  const base = choice.kind === "earlier" ? `Drop ${mmss(choice.dropS)} · an earlier drop (no later drop fits)` : `Drop ${mmss(choice.dropS)} · the last drop`;
  if (choice.kind !== "bass_stem") return base;
  // The bass-stem pick reads as the choice above would: the last third first.
  const inLast = choice.dropS >= choice.lastThirdFromS - EPS;
  return `${inLast ? `Drop ${mmss(choice.dropS)} · the last drop` : `Drop ${mmss(choice.dropS)} · an earlier drop (no later drop fits)`}${FOUND_ON_BASS_STEM}`;
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
export function spanLine(w: SnippetWindow): string {
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
      grid: BarGrid;
      lines: string[];
    }
  | { ok: false; refusal: string; choice: DropChoice; lines: string[] };

export type OperatorMarks = {
  /** A drop the operator set ("Drop set by {first name}"), kept over the Lab's choice. */
  dropS?: number | null;
  dropSetBy?: string | null;
  /** A hook the operator placed or cleared ("Hook set by {first name}"). undefined: the Lab's hook. null: cleared. */
  hookS?: number | null;
  hookSetBy?: string | null;
};

/**
 * TK3 for one track: the drop (the operator's, or the Lab's choice), the
 * hook (the operator's, or found from the file), the window and the row's
 * lines. A refusal carries the record's words with the title.
 */
export function planTrack(input: {
  title: string;
  features: Pick<TrackFeatures, "chroma" | "hopS" | "durationS">;
  kicks: readonly number[];
  drops: readonly Pick<FoundDrop, "tS">[];
  bassStemTop2?: readonly number[] | null;
  marks?: OperatorMarks;
}): TrackPlan {
  const { title, features, kicks } = input;
  const durationS = features.durationS;
  const marks = input.marks ?? {};
  const lab = chooseDrop({ drops: input.drops, durationS, kicks, bassStemTop2: input.bassStemTop2 });
  let choice: DropChoice = lab;
  if (marks.dropS != null) choice = { kind: "last", dropS: marks.dropS, lastThirdFromS: lab.lastThirdFromS, candidates: lab.candidates };
  if (!("dropS" in choice)) {
    const refusal = choice.kind === "none" ? noDropRefusal(title) : roomRefusal(title, choice.side);
    return { ok: false, refusal, choice, lines: [refusal] };
  }
  const dropS = choice.dropS;
  const grid = barGrid(kicks, dropS);
  const dropTimes = input.drops.map((d) => d.tS);
  let hook: HookResult;
  if (marks.hookS === null) hook = { kind: "none" };
  else if (marks.hookS !== undefined) hook = { kind: "hook", hookS: marks.hookS, phrase: { bars: 0, places: [marks.hookS] } };
  else hook = findHook(features, dropS, grid, dropTimes);
  const hookS = hook.kind === "hook" ? hook.hookS : null;
  const w = snippetWindow({ dropS, durationS, grid, hookS });
  const lines: string[] = [];
  lines.push(marks.dropS != null && marks.dropSetBy ? `Drop ${mmss(dropS)} · ${dropSetBy(marks.dropSetBy)}` : dropRowText(choice));
  if (hook.kind === "hook") lines.push(marks.hookS != null && marks.hookSetBy ? `${hookMarker(hook.hookS)} · ${hookSetBy(marks.hookSetBy)}` : hookMarker(hook.hookS));
  else if (hook.kind === "too_far") lines.push(hookTooFar(hook.hookS));
  else if (marks.hookS === null && marks.hookSetBy) lines.push(hookSetBy(marks.hookSetBy));
  else lines.push(NO_PHRASE);
  if (!grid.steady) lines.push(NO_STEADY_BEAT);
  if (!isWindow(w)) {
    const refusal = w.refused === "over_20" ? over20Refusal(title) : roomRefusal(title, w.side);
    return { ok: false, refusal, choice, lines: [...lines, refusal] };
  }
  lines.push(spanLine(w));
  return { ok: true, choice, window: w, hook, grid, lines };
}
