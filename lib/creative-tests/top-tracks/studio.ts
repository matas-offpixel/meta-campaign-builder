/**
 * Top tracks issue 2 (docs/design-record/2026-11-18-creative-lab-top-tracks-2.html):
 * bars and drops on a studio track, from one analysis of the master.
 *
 *   TK13 the grid: Beat This!'s beats and downbeats; a bar runs from one
 *        downbeat to the next (no 4-beats assumption). Bar lengths in the 16
 *        bars around the drop varying by more than 3 %, or no downbeats at
 *        all, cut on seconds.
 *   TK14 the drops: the bass stem's level per beat (RMS beat to beat). R is
 *        the median over the loudest half of the beats. A beat 10 dB or more
 *        under R is out; a break is 4 or more such beats in a row covering at
 *        least one bar (a track that starts with the bass out counts as a
 *        break from the first downbeat). A drop is the first beat after a
 *        break back within 3 dB of R, timed at the downbeat at or nearest it
 *        within half a bar, whose 8 beats from that downbeat average within
 *        3 dB of R. "Average" is read as the level of the 8 beats together
 *        (their RMS: the per-beat powers averaged, then dB), as every span
 *        level in this build is; a mean of the dB values would read a
 *        bassline that drops out on beat 4 as ~3 dB quieter than it plays. Returns under 4 bars apart are one drop, at the first
 *        that passes.
 *
 * Pure: the analysis (beats, downbeats, per-beat bass levels) comes from
 * analysis-source.ts. Live clips keep VW14–VW17 and never come here (TK12).
 */

export type StudioAnalysis = {
  durationS: number;
  beats: number[];
  downbeats: number[];
  /** The bass stem's level from beats[i] to beats[i + 1], dB. */
  bassBeatDb: number[];
};

export const TK14 = {
  /** Out or well down: at least this far under R. */
  outDb: 10,
  /** Back: within this of R. */
  backDb: 3,
  minBreakBeats: 4,
  /** The 8 beats from the downbeat must average within 3 dB of R. */
  testBeats: 8,
  /** Returns closer than this many bars are one drop. */
  mergeBars: 4,
  /** The downbeat the drop is timed at is within half a bar of the return. */
  snapBars: 0.5,
} as const;

export const TK13 = { steadyBars: 16, steadiness: 0.03 } as const;

const EPS = 1e-6;

/** The level of several beats together: their powers averaged, in dB. */
export function powerMeanDb(levels: readonly number[]): number {
  if (!levels.length) return -Infinity;
  return 10 * Math.log10(levels.reduce((s, v) => s + 10 ** (v / 10), 0) / levels.length);
}

/** R: the median per-beat level over the loudest half of the track's beats. */
export function referenceLevel(levels: readonly number[]): number {
  if (!levels.length) return -Infinity;
  const loud = [...levels].sort((a, b) => b - a).slice(0, Math.ceil(levels.length / 2));
  const mid = loud.length >> 1;
  return loud.length % 2 ? loud[mid]! : (loud[mid - 1]! + loud[mid]!) / 2;
}

/** The length of the bar that holds time t (the nearest bar for a time outside the grid). */
export function barLengthAt(downbeats: readonly number[], t: number): number | null {
  if (downbeats.length < 2) return null;
  let i = 0;
  while (i + 1 < downbeats.length && downbeats[i + 1]! <= t + EPS) i += 1;
  const j = Math.min(i, downbeats.length - 2);
  return downbeats[j + 1]! - downbeats[j]!;
}

export type BassDrop = {
  tS: number;
  /** The break's whole bars, at least 1. */
  breakBars: number;
  breakFromS: number;
  breakToS: number;
  /** The break's mean level under R, dB (negative), as data. */
  breakDb: number;
  /** The 8 beats' mean level from the drop's downbeat, against R, dB. */
  testDb: number;
};

export type DropsResult = { R: number; drops: BassDrop[]; breaks: { fromS: number; toS: number; bars: number; levelDb: number }[] };

/** TK14's drops, in time order. */
export function findBassDrops(a: StudioAnalysis): DropsResult {
  const { beats, downbeats, bassBeatDb: lv } = a;
  const R = referenceLevel(lv);
  const result: DropsResult = { R: Math.round(R * 10) / 10, drops: [], breaks: [] };
  if (beats.length < TK14.testBeats || downbeats.length < 2) return result;
  const out = lv.map((v) => v <= R - TK14.outDb + EPS);
  type Cand = { tS: number; beatIndex: number; passes: boolean; breakFrom: number; breakTo: number; breakDb: number; testDb: number };
  const cands: Cand[] = [];
  let i = 0;
  while (i < beats.length) {
    if (!out[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < beats.length && out[j + 1]) j += 1;
    const from = beats[i]!;
    const to = j + 1 < beats.length ? beats[j + 1]! : a.durationS;
    const bar = barLengthAt(downbeats, from) ?? Infinity;
    const atStart = i === 0 || from <= downbeats[0]! + EPS;
    const isBreak = atStart ? true : j - i + 1 >= TK14.minBreakBeats && to - from >= bar - EPS;
    // The first beat after the break back within 3 dB of R.
    let k = j + 1;
    while (k < beats.length && lv[k]! < R - TK14.backDb - EPS) k += 1;
    if (isBreak) {
      const levelDb = lv.slice(i, j + 1).reduce((s, v) => s + v, 0) / (j - i + 1) - R;
      const breakFrom = atStart ? Math.min(from, downbeats[0]!) : from;
      result.breaks.push({ fromS: breakFrom, toS: to, bars: Math.max(1, Math.floor((to - breakFrom) / bar + EPS)), levelDb: Math.round(levelDb * 10) / 10 });
      if (k < beats.length) {
        const ret = beats[k]!;
        const half = (barLengthAt(downbeats, ret) ?? 0) * TK14.snapBars;
        let best: number | null = null;
        for (const d of downbeats) if (Math.abs(d - ret) <= half + EPS && (best === null || Math.abs(d - ret) < Math.abs(best - ret) - EPS || (Math.abs(Math.abs(d - ret) - Math.abs(best - ret)) <= EPS && d <= ret))) best = d;
        if (best !== null) {
          // The 8 beats from that downbeat.
          let b0 = 0;
          while (b0 + 1 < beats.length && beats[b0]! < best - EPS) b0 += 1;
          if (Math.abs(beats[b0]! - best) > half && b0 > 0 && Math.abs(beats[b0 - 1]! - best) < Math.abs(beats[b0]! - best)) b0 -= 1;
          const slice = lv.slice(b0, b0 + TK14.testBeats);
          const testDb = slice.length === TK14.testBeats ? powerMeanDb(slice) - R : -Infinity;
          cands.push({ tS: best, beatIndex: b0, passes: testDb >= -TK14.backDb - EPS, breakFrom, breakTo: to, breakDb: levelDb, testDb });
        }
      }
    }
    i = Math.max(j + 1, k);
  }
  // Returns under 4 bars apart are one drop, timed at the first of them that passes.
  const barsBetween = (x: number, y: number) => downbeats.filter((d) => d > x + EPS && d <= y + EPS).length;
  let group: Cand[] = [];
  const flush = () => {
    const pass = group.find((c) => c.passes);
    if (pass) {
      const first = group[0]!;
      const bar = barLengthAt(downbeats, first.breakFrom) ?? 1;
      result.drops.push({ tS: Math.round(pass.tS * 1000) / 1000, breakBars: Math.max(1, Math.floor((pass.breakTo - pass.breakFrom) / bar + EPS)), breakFromS: Math.round(pass.breakFrom * 1000) / 1000, breakToS: Math.round(pass.breakTo * 1000) / 1000, breakDb: Math.round(pass.breakDb * 10) / 10, testDb: Math.round(pass.testDb * 10) / 10 });
    }
    group = [];
  };
  for (const c of cands) {
    if (group.length && barsBetween(group[0]!.tS, c.tS) >= TK14.mergeBars) flush();
    group.push(c);
  }
  flush();
  return result;
}

/** TK14's picker line: "{m:ss.s} · bass returns after {n} bars" ("1 bar" for one). */
export function dropPickerLine(d: Pick<BassDrop, "tS" | "breakBars">): string {
  const s = Math.max(0, d.tS);
  const m = Math.floor(s / 60);
  const sec = (Math.floor((s - m * 60) * 10) / 10).toFixed(1).padStart(4, "0");
  return `${m}:${sec} · bass returns after ${d.breakBars} ${d.breakBars === 1 ? "bar" : "bars"}`;
}

/** TK14: a dragged marker snaps to the nearest downbeat. */
export function snapToDownbeat(t: number, downbeats: readonly number[]): number {
  if (!downbeats.length) return t;
  return downbeats.reduce((best, d) => (Math.abs(d - t) < Math.abs(best - t) ? d : best), downbeats[0]!);
}

export type StudioGrid =
  | { steady: true; downbeats: number[]; barS: number }
  | { steady: false; reason: "no_grid" | "unsteady"; spread: number | null };

/** TK13: the grid around a drop. The 16 bars around it (8 each side, as many as exist) within ±3 % of their median, else seconds. */
export function studioGrid(downbeats: readonly number[], dropS: number): StudioGrid {
  if (downbeats.length < 2) return { steady: false, reason: "no_grid", spread: null };
  let at = 0;
  for (let i = 0; i < downbeats.length; i += 1) if (Math.abs(downbeats[i]! - dropS) < Math.abs(downbeats[at]! - dropS)) at = i;
  const half = TK13.steadyBars / 2;
  const lens: number[] = [];
  for (let i = Math.max(0, at - half); i < Math.min(downbeats.length - 1, at + half); i += 1) lens.push(downbeats[i + 1]! - downbeats[i]!);
  if (!lens.length) return { steady: false, reason: "no_grid", spread: null };
  const sorted = [...lens].sort((x, y) => x - y);
  const med = sorted[sorted.length >> 1]!;
  const spread = Math.max(...lens.map((l) => Math.abs(l - med) / med));
  if (spread > TK13.steadiness + EPS) return { steady: false, reason: "unsteady", spread: Math.round(spread * 1000) / 1000 };
  return { steady: true, downbeats: [...downbeats], barS: med };
}

/** TK18's words. */
export const FINDING_DROPS = "Finding the drops…";
export const BEAT_UNREAD = "Couldn't read this track's beat — drag the drop marker to it.";
