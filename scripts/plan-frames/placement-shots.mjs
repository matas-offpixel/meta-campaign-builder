/**
 * CLP shots. CLP6 and CLP7 are the face-check states, added beside CLP1–CLP5.
 * CLP8 is CLP7 once the render tick has failed the render (#1303): the failed
 * row, whose "try again" is the retry link.
 */
export const PLACEMENT_FRAME_IDS = ["CLP1", "CLP2", "CLP3", "CLP4", "CLP5", "CLP6", "CLP7", "CLP8"];
export const PLACEMENT_WIDTHS = [1280, 393];

export const PLACEMENT_SHOTS = PLACEMENT_FRAME_IDS.flatMap((frame) =>
  PLACEMENT_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: false, before: null })),
);
