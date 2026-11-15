/**
 * HE1 + HE3 panel frames at /frames/audience/{id}, from fixtures only
 * (lib/dashboard/audience-panels-fixture.ts):
 *   WR1 / WR1S  Who we reached, NX26-LOCKLEAD, internal / share link
 *   DF1 / DF1S  Direct-to-fan, Electric, internal / share link
 * Widths live in audience-panels-shots.mjs.
 */
export const AUDIENCE_PANEL_FRAME_IDS = ["WR1", "WR1S", "DF1", "DF1S"] as const;

export type AudiencePanelFrameId = (typeof AUDIENCE_PANEL_FRAME_IDS)[number];

export const AUDIENCE_PANEL_FRAMES: Record<AudiencePanelFrameId, { panel: "reach" | "d2c"; surface: "internal" | "share" }> = {
  WR1: { panel: "reach", surface: "internal" },
  WR1S: { panel: "reach", surface: "share" },
  DF1: { panel: "d2c", surface: "internal" },
  DF1S: { panel: "d2c", surface: "share" },
};
