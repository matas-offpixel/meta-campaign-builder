/** ACG shots. The photo gate, not a rendered card. */
export const ARTIST_CARD_FRAME_IDS = ["ACG1"];
export const ARTIST_CARD_WIDTHS = [1280, 393];

export const ARTIST_CARD_SHOTS = ARTIST_CARD_FRAME_IDS.flatMap((frame) =>
  ARTIST_CARD_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: false, before: null })),
);
