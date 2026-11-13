/**
 * DV shots at 1280 and 393. The runner opens /frames/{frame}, so the frame
 * is "sales/DV1": the nested route app/(dev)/frames/sales/[id], which does
 * not import the shared frames page.
 */
export const DASHBOARD_V2_FRAME_IDS = ["DV1", "DV2", "DV3"];
export const DASHBOARD_V2_WIDTHS = [1280, 393];

export const DASHBOARD_V2_SHOTS = DASHBOARD_V2_FRAME_IDS.flatMap((frame) =>
  DASHBOARD_V2_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame: `sales/${frame}`, width, lab: false, before: null })),
);
