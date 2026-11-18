/**
 * Top tracks: the per-frame rules the composition needs (TK3's joins, TK4's
 * reveal and playing row, TK9's ends), with no imports, so the Remotion
 * bundle carries nothing from the Node side. reel.ts re-exports all of it.
 */

/** TK3's join and TK9's ends. */
export const JOIN = { overlapS: 0.75, endCardS: 3.0, endCardNoCtaS: 2.5 } as const;

export type Framing = "ranked" | "level" | "forever" | "cant-live";
export type TrackCount = 3 | 4 | 5;
export type RowsAppear = "start" | "drop";
export type Ladder = "joke" | "plain";
export type EndKind = "date" | "nocta";

// ── TK3 → the reel's timeline ───────────────────────────────────────────────

export type TimedSnippet = { lengthS: number; /** The drop's offset inside the snippet. */ dropInS: number };

export type ReelTimeline = {
  /** Play order. */
  startsS: number[];
  dropsS: number[];
  totalS: number;
  /** The end card covers the last snippet's last 3.0 s (2.5 s with no CTA). */
  endFromS: number;
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** TK3: each snippet starts 0.75 s before the one before it ends; the reel ends with the last fade. */
export function reelTimeline(snippets: readonly TimedSnippet[], end: EndKind): ReelTimeline {
  const startsS: number[] = [];
  let t = 0;
  for (const s of snippets) {
    startsS.push(r3(t));
    t += s.lengthS - JOIN.overlapS;
  }
  const totalS = snippets.length ? r3(t + JOIN.overlapS) : 0;
  return { startsS, dropsS: snippets.map((s, i) => r3(startsS[i]! + s.dropInS)), totalS, endFromS: r3(totalS - (end === "date" ? JOIN.endCardS : JOIN.endCardNoCtaS)) };
}

// ── TK4: order, reveal and the playing row ──────────────────────────────────

/** Ranked's rows are ranks 1–n top-down; Level's are rungs; the other two have none. */
export function rungs(n: TrackCount, ladder: Ladder): string[] {
  if (ladder === "plain") return { 5: ["20%", "40%", "60%", "80%", "100%"], 4: ["25%", "50%", "75%", "100%"], 3: ["33%", "67%", "100%"] }[n];
  return { 5: ["10%", "50%", "100%", "500%", "1000%"], 4: ["10%", "50%", "100%", "1000%"], 3: ["10%", "100%", "1000%"] }[n];
}

/** The marker on each row, top-down: ranks, rungs, or none. */
export function rowMarkers(framing: Framing, n: TrackCount, ladder: Ladder): (string | null)[] {
  if (framing === "ranked") return Array.from({ length: n }, (_, i) => String(i + 1));
  if (framing === "level") return rungs(n, ladder);
  return Array.from({ length: n }, () => null);
}

/**
 * Which row (top-down) each snippet fills, in play order. Ranked counts
 * down: #n plays first and #1 last, so the list fills from the bottom. The
 * rest fill top-down.
 */
export function rowForPlay(framing: Framing, n: number): number[] {
  return Array.from({ length: n }, (_, k) => (framing === "ranked" ? n - 1 - k : k));
}

/**
 * The play order of the picked tracks. `rows` is the list top-down: under
 * Ranked and Level that is Spotify's order (never re-sorted, CT3), under the
 * other two the operator's. Ranked plays it bottom-up.
 */
export function playOrder<T>(framing: Framing, rows: readonly T[]): T[] {
  return framing === "ranked" ? [...rows].reverse() : [...rows];
}

export type RowState = {
  /** 0 before its reveal, 1 once shown; the 0.25 s fade between. */
  titleOpacity: number;
  /** The title slides in 24 px from the list's outer side over the fade. */
  slidePx: number;
  /** The number or rung (or empty rule): 0.4 unplayed, 1 playing, 0.7 played. */
  markerOpacity: number;
  /** The marker turns the kit accent while its row plays, with the 6 px bar. */
  playing: boolean;
  /** The title's opacity factor once shown: 1 playing, 0.7 played. */
  titleLevel: number;
};

export const REVEAL = { fadeS: 0.25, slidePx: 24, unplayed: 0.4, played: 0.7, playing: 1, endFadeS: 0.4 } as const;

/**
 * TK4 at time t for the row that the snippet at play index k fills. The
 * playing row is the row whose snippet started last. "At track start" shows
 * the title as its snippet starts; "On the drop" lights the marker as the
 * snippet starts and shows the title on the drop.
 */
export function rowState(tS: number, k: number, timeline: ReelTimeline, rowsAppear: RowsAppear): RowState {
  const start = timeline.startsS[k]!;
  const reveal = rowsAppear === "start" ? start : timeline.dropsS[k]!;
  const started = tS + 1e-9 >= start;
  let current = -1;
  for (let j = 0; j < timeline.startsS.length; j += 1) if (tS + 1e-9 >= timeline.startsS[j]!) current = j;
  const playing = started && current === k;
  const x = (tS - reveal) / REVEAL.fadeS;
  const shown = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return {
    titleOpacity: shown,
    slidePx: Math.round((1 - shown) * REVEAL.slidePx * 100) / 100,
    markerOpacity: playing ? REVEAL.playing : started ? REVEAL.played : REVEAL.unplayed,
    playing,
    titleLevel: playing ? REVEAL.playing : REVEAL.played,
  };
}

/** TK9: the headline and list fade out over 0.4 s at the date end; the no-CTA end holds them at 100 % with no highlight. */
export function endState(tS: number, timeline: ReelTimeline, end: EndKind): { listOpacity: number; endCardOpacity: number; hold: boolean } {
  if (tS + 1e-9 < timeline.endFromS) return { listOpacity: 1, endCardOpacity: 0, hold: false };
  if (end === "nocta") return { listOpacity: 1, endCardOpacity: 0, hold: true };
  const x = Math.min(1, Math.max(0, (tS - timeline.endFromS) / REVEAL.endFadeS));
  return { listOpacity: 1 - x, endCardOpacity: x, hold: false };
}

