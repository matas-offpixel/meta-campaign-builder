/**
 * HE4 and HE6 shots at 1280 and 393. The runner opens /frames/{frame}.
 */
export const HE_FRAME_IDS = ["PS1", "PS1S", "OB1", "OB1S", "OB2", "OB2S"];
export const HE_WIDTHS = [1280, 393];

const route = (id) => (id.startsWith("PS") ? "presale" : "objective");

export const HE_PANEL_SHOTS = HE_FRAME_IDS.flatMap((frame) =>
  HE_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame: `${route(frame)}/${frame}`, width, lab: false, before: null })),
);
