/**
 * The Lab video window frames (docs/design-record/2026-11-17-creative-lab-video-window.html):
 * VW-A, the window picker on XMPL clip 07 at its detected window (1280 and
 * 393), and VW-B, one clip per VW3 refusal (393). The figures are the
 * record's invented ones, under "Expected figures". The drops are what
 * detection would store; the window, the lines and the refusals come from
 * the real rules in lib/creative-lab/edit-window.ts.
 */

import type { StoredDrops, WindowChoice } from "../../lib/creative-lab/edit-window.ts";

export const VIDEO_WINDOW_FRAME_IDS = ["VW-A", "VW-B"] as const;

type OkDrops = Extract<StoredDrops, { status: "ok" }>;

/** A waveform for a clip that's quiet until each drop and loud after it (240 peaks, 0..1). */
function peaksFor(durationS: number, drops: readonly { tS: number; level: number }[], base = 0.22): number[] {
  const n = 240;
  return Array.from({ length: n }, (_, i) => {
    const t = ((i + 0.5) / n) * durationS;
    const level = drops.filter((d) => d.tS <= t).at(-1)?.level ?? base;
    // A steady ripple so it reads as sound, not a block.
    const ripple = 0.82 + 0.18 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.37));
    return Math.round(level * ripple * 100) / 100;
  });
}

function okDrops(durationS: number, candidates: [number, number][], mainS: number | null, peaks: number[]): OkDrops {
  return { v: 1, status: "ok", assetId: "xmpl", durationS, hasSound: true, lufs: -14.2, candidates: candidates.map(([tS, riseDb]) => ({ tS, riseDb })), mainS, peaks };
}

export const DETECTED: WindowChoice = { dropS: null, byHand: false, inS: 12.4, outS: 28.4 };

/** VW-A: XMPL clip 07, 42.0 s; main drop 16.4 s rising 11 dB; another at 31.2 s rising 8 dB. */
export const XMPL_CLIP_07 = {
  name: "XMPL clip 07",
  drops: okDrops(42, [[16.4, 11], [31.2, 8]], 16.4, peaksFor(42, [{ tS: 16.4, level: 0.78 }, { tS: 26, level: 0.36 }, { tS: 31.2, level: 1 }])),
  choice: DETECTED,
};

const NONE: WindowChoice = { dropS: null, byHand: false, inS: null, outS: null };

/** VW-B: one clip per VW3 refusal, in VW3's order. */
export const VW_B_CLIPS: { name: string; drops: StoredDrops; choice: WindowChoice }[] = [
  { name: "XMPL clip 11", drops: { v: 1, status: "ok", assetId: "xmpl", durationS: 22, hasSound: false, lufs: null, candidates: [], mainS: null, peaks: [] }, choice: NONE },
  { name: "XMPL clip 12", drops: okDrops(12.6, [[5.2, 9]], 5.2, []), choice: NONE },
  { name: "XMPL clip 13", drops: okDrops(28, [], null, []), choice: NONE },
  { name: "XMPL clip 14", drops: okDrops(30, [[1.8, 12], [9, 8]], 1.8, []), choice: NONE },
  { name: "XMPL clip 15", drops: okDrops(31, [[24.8, 10]], 24.8, []), choice: NONE },
];
