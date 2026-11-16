/**
 * DV shots at 1280 and 393. The runner opens /frames/{frame}, so the frame
 * is "sales/DV1": the nested route app/(dev)/frames/sales/[id], which does
 * not import the shared frames page.
 */
import { AUDIENCE_PANEL_SHOTS } from "./audience-panels-shots.mjs";
import { CREATIVE_SHOTS } from "./creative-section-shots.mjs";
import { PAGE_AUDIENCE_SHOTS } from "./page-audience-shots.mjs";

/** NC1 / NC1S (#1271): a venue with no Internal Counts, internal and share. */
export const DASHBOARD_V2_FRAME_IDS = ["DV1", "DV2", "DV3", "NV1", "NV2", "NV5", "NV6", "NC1", "NC1S"];
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

/** HMB2 / HMB3 (dashboard v2 on a phone): the phone layout on the live-like share link. */
export const MB_PHONE_SHOTS = [
  { id: "MB-375-first", frame: "sales/MBF375", width: 375 },
  { id: "MB-390-first", frame: "sales/MBF390", width: 390 },
  { id: "MB-430-first", frame: "sales/MBF430", width: 430 },
  { id: "MB-375-more", frame: "sales/MBM", width: 375 },
  { id: "MB-375-allvenues", frame: "sales/MBA", width: 375 },
  { id: "MB-375-chart", frame: "sales/MBC", width: 375 },
  { id: "MB-375-chart-swiped", frame: "sales/MBH1", width: 375 },
  { id: "MB-375-chart-swiped-estimate", frame: "sales/MBH2", width: 375 },
  { id: "MB-375-chart-14d", frame: "sales/MB14", width: 375 },
].map((shot) => ({ ...shot, lab: false, before: null }));

export const DASHBOARD_V2_SHOTS = [
  ...DASHBOARD_V2_FRAME_IDS.flatMap((frame) =>
    DASHBOARD_V2_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame: `sales/${frame}`, width, lab: false, before: null })),
  ),
  ...MB_OVERFLOW_SHOTS,
  ...MB_PHONE_SHOTS,
  // HE1 + HE3 panels (WR1, DF1), here so run.mjs is unchanged.
  ...AUDIENCE_PANEL_SHOTS,
  // HE5 creative section (CR1), here so run.mjs is unchanged.
  ...CREATIVE_SHOTS,
  // HE2 panel (SC1, SC2, WR2), here so run.mjs is unchanged.
  ...PAGE_AUDIENCE_SHOTS,
];
