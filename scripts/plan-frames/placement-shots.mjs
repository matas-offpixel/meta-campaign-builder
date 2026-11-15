/** CLP shots. CLP6 and CLP7 are the face-check states, added beside CLP1–CLP5. */
export const PLACEMENT_FRAME_IDS = ["CLP1", "CLP2", "CLP3", "CLP4", "CLP5", "CLP6", "CLP7"];
export const PLACEMENT_WIDTHS = [1280, 393];

export const PLACEMENT_SHOTS = PLACEMENT_FRAME_IDS.flatMap((frame) =>
  PLACEMENT_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: false, before: null })),
);
