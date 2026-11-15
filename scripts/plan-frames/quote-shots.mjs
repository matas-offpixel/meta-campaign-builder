/** CLQ shots. Static plates: no video settle. */
export const QUOTE_FRAME_IDS = ["CLQ1", "CLQ2", "CLQ4"];
export const QUOTE_WIDTHS = [1280, 393];

export const QUOTE_SHOTS = QUOTE_FRAME_IDS.flatMap((frame) =>
  QUOTE_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: false, before: null })),
);
