/** CLS shots. Static plates: no video settle. */
export const SELECTION_FRAME_IDS = ["CLS1", "CLS2", "CLS3", "CLS4"];
export const SELECTION_WIDTHS = [1280, 393];

export const SELECTION_SHOTS = SELECTION_FRAME_IDS.flatMap((frame) =>
  SELECTION_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: false, before: null })),
);
