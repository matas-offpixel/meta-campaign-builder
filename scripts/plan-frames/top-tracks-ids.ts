/**
 * Top tracks frames (docs/design-record/2026-11-18-creative-lab-top-tracks.html, HK8),
 * at /frames/top-tracks/{id} (app/(dev)/frames/top-tracks/[id]).
 *
 * TK-A, TK-B1–B4, TK-C1–C3, TK-D and TK-E are the TopTracks composition at
 * the record's times, drawn as an HTML replica from the same rules
 * (frame.ts, reel.ts, layout.ts) in a stand-in condensed face, at 1080 × 1920.
 * TK-F2 (the reel's timeline) and TK-F3 (which drop and which hook) use the
 * tab's own waveform. TK-G is the Lab tab at 1280 and 393.
 */
export const TOP_TRACKS_STILL_IDS = ["TK-A", "TK-B1", "TK-B2", "TK-B3", "TK-B4", "TK-C1", "TK-C2", "TK-C3", "TK-D", "TK-E"] as const;
export const TOP_TRACKS_DIAGRAM_IDS = ["TK-F2", "TK-F3"] as const;
export const TOP_TRACKS_TAB_IDS = ["TK-G"] as const;
export const TOP_TRACKS_FRAME_IDS = [...TOP_TRACKS_STILL_IDS, ...TOP_TRACKS_DIAGRAM_IDS, ...TOP_TRACKS_TAB_IDS] as const;
export type TopTracksFrameId = (typeof TOP_TRACKS_FRAME_IDS)[number];
