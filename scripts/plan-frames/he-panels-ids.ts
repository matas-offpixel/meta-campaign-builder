/**
 * HE4 and HE6 frames. Electric Brixton, D.O.D, read 15 Nov 2026
 * (lib/dashboard/he-panels/fixture.ts). Widths live in he-panels-shots.mjs.
 */
export const HE_FRAME_IDS = ["PS1", "PS1S", "OB1", "OB1S", "OB2", "OB2S"] as const;

export type HeFrameId = (typeof HE_FRAME_IDS)[number];

export const HE_FRAMES: Record<HeFrameId, { surface: "internal" | "share"; kind: "presale" | "client" | "show"; route: "presale" | "objective" }> = {
  PS1: { surface: "internal", kind: "presale", route: "presale" },
  PS1S: { surface: "share", kind: "presale", route: "presale" },
  OB1: { surface: "internal", kind: "client", route: "objective" },
  OB1S: { surface: "share", kind: "client", route: "objective" },
  OB2: { surface: "internal", kind: "show", route: "objective" },
  OB2S: { surface: "share", kind: "show", route: "objective" },
};
