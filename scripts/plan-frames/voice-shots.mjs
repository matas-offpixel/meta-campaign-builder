/** CLV shots. Static plates: no video settle. */
export const VOICE_FRAME_IDS = ["CLV1", "CLV2", "CLV3", "CLV4"];
export const VOICE_WIDTHS = [1280, 393];

export const VOICE_SHOTS = VOICE_FRAME_IDS.flatMap((frame) =>
  VOICE_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: false, before: null })),
);
