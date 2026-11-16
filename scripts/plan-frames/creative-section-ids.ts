/**
 * HE5 creative frames at /frames/creative/{id}, from the IRW0001 fixture
 * (lib/dashboard/creative-section-fixture.ts). CR1 / CR1S are Charlotte de Witte.
 * CR2 is Jamie Jones, internal, with the TikTok snapshot.
 * Widths live in creative-section-shots.mjs.
 */
export const CREATIVE_FRAME_IDS = ["CR1", "CR1S", "CR2"] as const;

export type CreativeFrameId = (typeof CREATIVE_FRAME_IDS)[number];

export const CREATIVE_FRAMES: Record<CreativeFrameId, { surface: "internal" | "share" }> = {
  CR1: { surface: "internal" },
  CR1S: { surface: "share" },
  CR2: { surface: "internal" },
};
