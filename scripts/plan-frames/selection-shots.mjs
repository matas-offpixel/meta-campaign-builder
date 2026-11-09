/** CLS shots. Static plates: no video settle. */
export const SELECTION_FRAME_IDS = ["CLS1", "CLS2", "CLS2b", "CLS3", "CLS4", "CLS5", "CLS5b", "CLS6", "CLS7", "CLS8", "CLS9"];
export const SELECTION_WIDTHS = [1280, 393];

export const SELECTION_SHOTS = SELECTION_FRAME_IDS.flatMap((frame) =>
  SELECTION_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: false, before: null })),
);
