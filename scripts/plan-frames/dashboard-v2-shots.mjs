/**
 * Dashboard v2 layout shots (DV1–DV3) at 1280 and 393.
 * Not imported by run.mjs yet — that registration waits until Claude Code's
 * edit of run.mjs has landed.
 */
export const DASHBOARD_V2_FRAME_IDS = ["DV1", "DV2", "DV3"];
export const DASHBOARD_V2_WIDTHS = [1280, 393];

export const DASHBOARD_V2_SHOTS = DASHBOARD_V2_FRAME_IDS.flatMap((frame) =>
  DASHBOARD_V2_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: false, before: null })),
);
