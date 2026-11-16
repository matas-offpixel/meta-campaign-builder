/**
 * OR shots. Ids match scripts/plan-frames/refresh-fixtures.ts. The runner
 * opens /frames/{frame}, so the frame is "onsale/OR1": the nested route
 * app/(dev)/frames/onsale/[id] under the shared /frames/ prefix, while
 * app/(dev)/frames/[id]/page.tsx sits in an open Cursor PR.
 */

export const REFRESH_FRAME_IDS = ["OR1", "OR2", "OR3", "OR4", "OR5", "OR6", "OR7", "OR8", "OR9", "OR10"];
export const REFRESH_WIDTHS = [1280, 393];

/**
 * P4's PF frames (docs/design-record/2026-11-14-purchase-campaigns.html):
 * PF1 and PF2 at 1280; PF3a and PF3b are the same two at 393.
 */
export const PURCHASE_CAMPAIGN_SHOTS = [
  { id: "PF1-1280", frame: "onsale/PF1", width: 1280, lab: false, before: null },
  { id: "PF2-1280", frame: "onsale/PF2", width: 1280, lab: false, before: null },
  { id: "PF3a-393", frame: "onsale/PF1", width: 393, lab: false, before: null },
  { id: "PF3b-393", frame: "onsale/PF2", width: 393, lab: false, before: null },
  { id: "PF4-1280", frame: "onsale/PF4", width: 1280, lab: false, before: null },
];

/**
 * Creative testing's CT-A (picker) and CT-B (drop marker and preview) at 1280
 * and 393 (docs/design-record/2026-11-16-creative-testing.html), at
 * /frames/creative-tests/{id}. Listed here, not in run.mjs, while run.mjs
 * sits in open PRs.
 */
export const SNIPPET_SHOTS = ["CTA", "CTB"].flatMap((frame) => REFRESH_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame: `creative-tests/${frame}`, width, lab: false, before: null })));

export const REFRESH_SHOTS = [
  ...REFRESH_FRAME_IDS.flatMap((frame) => REFRESH_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame: `onsale/${frame}`, width, lab: false, before: null }))),
  ...PURCHASE_CAMPAIGN_SHOTS,
  ...SNIPPET_SHOTS,
];
