/**
 * Top tracks fixture (docs/design-record/2026-11-18-creative-lab-top-tracks.html,
 * HK8): Luke Dean on P26-BDAY, AU-A's five invented tracks, every one at
 * 124 BPM. Track one is 3:12 with drops at 1:02, 1:47 and 2:24 and a 2-bar
 * phrase 5 bars before each; track three is 3:05 with drops at 0:58 and
 * 1:46, no phrase, and a guest; the other three have their last drop in
 * their last third and no phrase. The drops sit on one bar grid per track,
 * so the phrase's places are on the chosen drop's grid (the record's
 * 0:52.3 / 1:37.3 read as 0:53.0 / 1:37.6 on it; 2:14.3 is exact).
 *
 * Used by the unit tests and by the TK frames. Every name, time, date and
 * claim here is invented, as the record's are.
 */

import type { TrackFeatures } from "../../lib/creative-tests/top-tracks/analysis.ts";

export const BPM = 124;
export const BEAT_S = 60 / BPM;
export const BAR_S = 4 * BEAT_S;

export type FixtureTrack = {
  id: string;
  title: string;
  spotifyRank: number | null;
  artists: string[];
  durationS: number;
  drops: number[];
  /** The 2-bar phrase's places (track one only). */
  phrase: number[] | null;
};

const onGrid = (anchor: number, bars: number) => Math.round((anchor - bars * BAR_S) * 1000) / 1000;

export const FIXTURE_ARTIST = "Luke Dean";
export const FIXTURE_EVENT = { code: "P26-BDAY", kitCase: "upper" as const, date: "SAT 28 NOV", claim: "GENERAL SALE LIVE" };

export const FIXTURE_TRACKS: FixtureTrack[] = [
  { id: "t1", title: "Track one", spotifyRank: 1, artists: ["Luke Dean"], durationS: 192, drops: [onGrid(144, 42), onGrid(144, 19), 144], phrase: [onGrid(144, 47), onGrid(144, 24), onGrid(144, 5)] },
  { id: "t2", title: "Track two", spotifyRank: 2, artists: ["Luke Dean"], durationS: 210, drops: [onGrid(160, 47), 160], phrase: null },
  { id: "t3", title: "Track three", spotifyRank: 3, artists: ["Luke Dean", "Guest Artist"], durationS: 185, drops: [onGrid(106, 25), 106], phrase: null },
  { id: "t4", title: "Track four (Club Mix)", spotifyRank: 4, artists: ["Luke Dean"], durationS: 180, drops: [onGrid(130, 36), 130], phrase: null },
  { id: "t5", title: "Track five", spotifyRank: 5, artists: ["Luke Dean"], durationS: 200, drops: [onGrid(150, 43), 150], phrase: null },
];

/** A steady kick on every beat, on the grid of the track's last drop. */
export function fixtureKicks(track: FixtureTrack): number[] {
  const anchor = track.drops[track.drops.length - 1]!;
  const out: number[] = [];
  const first = anchor - Math.floor(anchor / BEAT_S) * BEAT_S;
  for (let k = 0; first + k * BEAT_S < track.durationS; k += 1) out.push(first + k * BEAT_S);
  return out;
}

/** Deterministic PRNG (mulberry32), so the fixture's chroma is the same every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Features with pitch content per bar: every bar its own random chord,
 * except the phrase's two bars, which repeat at each place. Only the chroma,
 * hop and length are filled (the hook reads only those).
 */
export function fixtureFeatures(track: FixtureTrack, seed = 7): Pick<TrackFeatures, "chroma" | "hopS" | "durationS"> {
  const hopS = 0.01;
  const frames = Math.floor(track.durationS / hopS);
  const chroma = new Float32Array(frames * 12);
  const rand = rng(seed + track.id.charCodeAt(1));
  const anchor = track.drops[track.drops.length - 1]!;
  const first = anchor - Math.floor(anchor / BAR_S) * BAR_S;
  const phraseA = Array.from({ length: 12 }, () => rand());
  const phraseB = Array.from({ length: 12 }, () => rand());
  for (let bar = 0; first + bar * BAR_S < track.durationS; bar += 1) {
    const t0 = first + bar * BAR_S;
    let vec = Array.from({ length: 12 }, () => rand());
    for (const p of track.phrase ?? []) {
      if (Math.abs(t0 - p) < 1e-3) vec = phraseA;
      if (Math.abs(t0 - (p + BAR_S)) < 1e-3) vec = phraseB;
    }
    const a = Math.max(0, Math.round(t0 / hopS));
    const b = Math.min(frames, Math.round((t0 + BAR_S) / hopS));
    for (let f = a; f < b; f += 1) for (let c = 0; c < 12; c += 1) chroma[f * 12 + c] = vec[c]! * 1000;
  }
  // The stretch before the first bar line gets its own chord.
  const pre = Array.from({ length: 12 }, () => rand());
  for (let f = 0; f < Math.round(first / hopS); f += 1) for (let c = 0; c < 12; c += 1) chroma[f * 12 + c] = pre[c]! * 1000;
  return { chroma, hopS, durationS: track.durationS };
}

/** The tracks as the frames show them: TK-B's reel (Ranked, 5, rows at track start, the date end). */
export const FIXTURE_SNIPPETS_5 = [
  // Play order for Ranked: #5, #4, #3, #2, #1. #1 has the hook (5 bars before), the rest 3 bars before; all 4 bars after.
  { lengthS: 7 * BAR_S, dropInS: 3 * BAR_S },
  { lengthS: 7 * BAR_S, dropInS: 3 * BAR_S },
  { lengthS: 7 * BAR_S, dropInS: 3 * BAR_S },
  { lengthS: 7 * BAR_S, dropInS: 3 * BAR_S },
  { lengthS: 9 * BAR_S, dropInS: 5 * BAR_S },
];

export const FIXTURE_SNIPPETS_3 = [
  { lengthS: 7 * BAR_S, dropInS: 3 * BAR_S },
  { lengthS: 7 * BAR_S, dropInS: 3 * BAR_S },
  { lengthS: 9 * BAR_S, dropInS: 5 * BAR_S },
];
