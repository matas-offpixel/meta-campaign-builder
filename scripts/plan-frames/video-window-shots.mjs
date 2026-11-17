/**
 * VW shots (docs/design-record/2026-11-17-creative-lab-video-window.html):
 * VW-A at 1280 and 393, VW-B at 393. Ids match video-window-fixtures.ts.
 * The runner opens /frames/video-window/{id}, a nested route under the
 * shared /frames/ prefix. Listed through event-config-shots.mjs while
 * run.mjs sits in an open PR. No baselines until design passes.
 */

export const VIDEO_WINDOW_SHOTS = [
  { id: "VW-A-1280", frame: "video-window/VW-A", width: 1280, lab: false, before: null },
  { id: "VW-A-393", frame: "video-window/VW-A", width: 393, lab: false, before: null },
  { id: "VW-B-393", frame: "video-window/VW-B", width: 393, lab: false, before: null },
];
