/**
 * TK shots: Top tracks (docs/design-record/2026-11-18-creative-lab-top-tracks.html).
 * The composition stills at 1080 (the shot is the 1080 × 1920 frame element),
 * TK-F2 / TK-F3 at 1280, and the Lab tab TK-G at 1280 and 393. Ids match
 * scripts/plan-frames/top-tracks-ids.ts; the runner opens
 * /frames/top-tracks/{id}. No baselines are committed until design passes.
 */

export const TOP_TRACKS_STILL_IDS = ["TK-A", "TK-B1", "TK-B2", "TK-B3", "TK-B4", "TK-C1", "TK-C2", "TK-C3", "TK-D", "TK-E"];

export const TOP_TRACKS_SHOTS = [
  ...TOP_TRACKS_STILL_IDS.map((frame) => ({ id: `${frame}-1080`, frame: `top-tracks/${frame}`, width: 1080, lab: false, before: null })),
  ...["TK-F2", "TK-F3"].map((frame) => ({ id: `${frame}-1280`, frame: `top-tracks/${frame}`, width: 1280, lab: false, before: null })),
  ...[1280, 393].map((width) => ({ id: `TK-G-${width}`, frame: "top-tracks/TK-G", width, lab: false, before: null })),
];
