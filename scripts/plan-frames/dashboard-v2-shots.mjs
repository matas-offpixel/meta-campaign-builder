/**
 * DV shots at 1280 and 393. The runner opens /frames/{frame}, so the frame
 * is "sales/DV1": the nested route app/(dev)/frames/sales/[id], which does
 * not import the shared frames page.
 */
export const DASHBOARD_V2_FRAME_IDS = ["DV1", "DV2", "DV3", "NV1", "NV2", "NV5", "NV6"];
export const DASHBOARD_V2_WIDTHS = [1280, 393];

/**
 * MB1 (dashboard v2 on a phone): the live-like fixture on the share link
 * (MBS) at 375, 430 and 1280, and the internal page (MBO) at 375. The
 * overflow guard (overflow-guard.mjs) checks MBO and MBS at 320–430 px.
 */
export const MB_OVERFLOW_SHOTS = [
  { id: "MB-375-overflow", frame: "sales/MBS", width: 375 },
  { id: "MB-430-overflow", frame: "sales/MBS", width: 430 },
  { id: "MB-1280-overflow", frame: "sales/MBS", width: 1280 },
  { id: "MB-375-overflow-internal", frame: "sales/MBO", width: 375 },
].map((shot) => ({ ...shot, lab: false, before: null }));

export const DASHBOARD_V2_SHOTS = [
  ...DASHBOARD_V2_FRAME_IDS.flatMap((frame) =>
    DASHBOARD_V2_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame: `sales/${frame}`, width, lab: false, before: null })),
  ),
  ...MB_OVERFLOW_SHOTS,
];
