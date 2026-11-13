/**
 * OR shots. Ids match scripts/plan-frames/refresh-fixtures.ts. The runner
 * opens /frames/{frame}, so the frame is "onsale/OR1": the nested route
 * app/(dev)/frames/onsale/[id] under the shared /frames/ prefix, while
 * app/(dev)/frames/[id]/page.tsx sits in an open Cursor PR.
 */

export const REFRESH_FRAME_IDS = ["OR1", "OR2", "OR3", "OR4"];
export const REFRESH_WIDTHS = [1280, 393];

export const REFRESH_SHOTS = REFRESH_FRAME_IDS.flatMap((frame) =>
  REFRESH_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame: `onsale/${frame}`, width, lab: false, before: null })),
);
