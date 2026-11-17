/**
 * HE2 panel shots at 1280 and 393 (SC1, SC1S, SC2, SC2S, WR2, WR2S). The
 * runner opens /frames/{frame}, so the frame is "page-audience/SC1": the
 * nested route app/(dev)/frames/page-audience/[id]. Spread into
 * DASHBOARD_V2_SHOTS (dashboard-v2-shots.mjs) so run.mjs is unchanged.
 */
export const PAGE_AUDIENCE_FRAME_IDS = ["SC1", "SC1S", "SC2", "SC2S", "WR2", "WR2S"];
export const PAGE_AUDIENCE_WIDTHS = [1280, 393];

export const PAGE_AUDIENCE_SHOTS = PAGE_AUDIENCE_FRAME_IDS.flatMap((frame) =>
  PAGE_AUDIENCE_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame: `page-audience/${frame}`, width, lab: false, before: null })),
);

/** The overflow guard opens these at 320–430 (MB1). */
export const PAGE_AUDIENCE_OVERFLOW_FRAMES = PAGE_AUDIENCE_FRAME_IDS.map((id) => `page-audience/${id}`);
