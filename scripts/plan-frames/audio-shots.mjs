/** CLA shots. The toggle is painted; the video stays on its poster. */
export const AUDIO_FRAME_IDS = ["CLA1", "CLA2"];
export const AUDIO_WIDTHS = [1280, 393];

export const AUDIO_SHOTS = AUDIO_FRAME_IDS.flatMap((frame) =>
  AUDIO_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: false, before: null })),
);
