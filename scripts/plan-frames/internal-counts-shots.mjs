/**
 * IC shots: the Internal Counts review list (HD1), at 1280 and 393. Ids
 * match scripts/plan-frames/internal-counts-fixtures.ts. The runner opens
 * /frames/{frame}, so the frame is "internal-counts/IC1": the nested route
 * app/(dev)/frames/internal-counts/[id], because app/(dev)/frames/[id]/page.tsx
 * sits in an open Cursor PR. No baselines are committed until design passes.
 */

export const INTERNAL_COUNTS_FRAME_IDS = ["IC1", "IC2"];
export const INTERNAL_COUNTS_WIDTHS = [1280, 393];

export const INTERNAL_COUNTS_SHOTS = INTERNAL_COUNTS_FRAME_IDS.flatMap((frame) =>
  INTERNAL_COUNTS_WIDTHS.map((width) => ({
    id: `${frame}-${width}`,
    frame: `internal-counts/${frame}`,
    width,
    lab: false,
    before: null,
  })),
);
