/**
 * HE2 panel frames at /frames/page-audience/{id}, from fixtures only
 * (lib/dashboard/page-audience-panel/fixture.ts, Electric's real counts):
 *   SC1 / SC1S  Signups & communities, Electric Brixton (all shows, the umbrella apart), internal / share link
 *   SC2 / SC2S  Signups & communities, Sheffield Fever 105 (a shared invite code, a partner box), internal / share link
 *   WR2 / WR2S  Who we reached with CIRQLIN's signup geography beside Meta's, NX26-LOCKLEAD, internal / share link
 * Widths live in page-audience-shots.mjs.
 */
export const PAGE_AUDIENCE_FRAME_IDS = ["SC1", "SC1S", "SC2", "SC2S", "WR2", "WR2S"] as const;

export type PageAudienceFrameId = (typeof PAGE_AUDIENCE_FRAME_IDS)[number];

export const PAGE_AUDIENCE_FRAMES: Record<PageAudienceFrameId, { panel: "signups" | "reach"; view: string; surface: "internal" | "share" }> = {
  SC1: { panel: "signups", view: "all", surface: "internal" },
  SC1S: { panel: "signups", view: "all", surface: "share" },
  SC2: { panel: "signups", view: "es26-fever105", surface: "internal" },
  SC2S: { panel: "signups", view: "es26-fever105", surface: "share" },
  WR2: { panel: "reach", view: "nx26-locklead", surface: "internal" },
  WR2S: { panel: "reach", view: "nx26-locklead", surface: "share" },
};
