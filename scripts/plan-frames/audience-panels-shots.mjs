/**
 * HE1 + HE3 panel shots at 1280 and 393 (WR1, WR1S, DF1, DF1S). The runner
 * opens /frames/{frame}, so the frame is "audience/WR1": the nested route
 * app/(dev)/frames/audience/[id]. Spread into DASHBOARD_V2_SHOTS
 * (dashboard-v2-shots.mjs) so run.mjs is unchanged.
 */
export const AUDIENCE_PANEL_FRAME_IDS = ["WR1", "WR1S", "DF1", "DF1S"];
export const AUDIENCE_PANEL_WIDTHS = [1280, 393];

export const AUDIENCE_PANEL_SHOTS = AUDIENCE_PANEL_FRAME_IDS.flatMap((frame) =>
  AUDIENCE_PANEL_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame: `audience/${frame}`, width, lab: false, before: null })),
);
