/** OR shots. Ids match scripts/plan-frames/refresh-fixtures.ts. Served from /frames/onsale/{id}?w={width} until the shared registry takes them. */

export const REFRESH_FRAME_IDS = ["OR1"];
export const REFRESH_WIDTHS = [1280, 393];

export const REFRESH_SHOTS = REFRESH_FRAME_IDS.flatMap((frame) =>
  REFRESH_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: false, before: null, path: `/frames/onsale/${frame}?w=${width}` })),
);
