/** CLW shots. Static plates. */
export const FOOTAGE_FRAME_IDS = ["CLW1", "CLW2", "CLW3"];
export const FOOTAGE_WIDTHS = [1280, 393];

export const FOOTAGE_SHOTS = FOOTAGE_FRAME_IDS.flatMap((frame) =>
  FOOTAGE_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: false, before: null })),
);
