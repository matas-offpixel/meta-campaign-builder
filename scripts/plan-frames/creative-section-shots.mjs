/**
 * HE5 creative shots at 1280 and 393 (CR1, CR1S, CR2). The runner opens
 * /frames/{frame}, so the frame is "creative/CR1". Spread into
 * DASHBOARD_V2_SHOTS so run.mjs is unchanged.
 */
export const CREATIVE_FRAME_IDS = ["CR1", "CR1S", "CR2"];
export const CREATIVE_WIDTHS = [1280, 393];

export const CREATIVE_SHOTS = CREATIVE_FRAME_IDS.flatMap((frame) =>
  CREATIVE_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame: `creative/${frame}`, width, lab: false, before: null })),
);
